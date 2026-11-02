import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const START_SCRIPT = join(import.meta.dir, "../../../docker/aws/start.sh");
const SYNC_REQUIRES_QUEUE =
  "KEEPER_SYNC_ENABLED=true requires WORKER_JOB_QUEUE_ENABLED=true";
const QUEUE_MUST_BE_BOOLEAN = "WORKER_JOB_QUEUE_ENABLED must be true or false";
const SYNC_MUST_BE_BOOLEAN = "KEEPER_SYNC_ENABLED must be true or false";

const bashVersionProc = Bun.spawn(["bash", "-c", "printf %s $BASH_VERSINFO"], {
  stdout: "pipe",
  stderr: "ignore",
});
const bashVersionText = await new Response(bashVersionProc.stdout).text();
const bashMajor = Number.parseInt(bashVersionText.split(/[ \n]/, 1)[0] ?? "", 10);

const bashSupportsWaitN = Number.isFinite(bashMajor) && bashMajor >= 4;

interface StartResult {
  children: string[];
  code: number;
  queueFlags: Record<string, string>;
  stderr: string;
}

const readChildStatus = async (
  statusDir: string,
): Promise<{ children: string[]; queueFlags: Record<string, string> }> => {
  const entries = await readdir(statusDir);
  const names = entries.toSorted();
  const queueFlags: Record<string, string> = {};
  for (const name of names) {
    const contents = await readFile(join(statusDir, name), "utf8");
    queueFlags[name] = contents.trim();
  }
  return { children: names, queueFlags };
};

const waitForChildren = async (
  statusDir: string,
  expectedCount: number,
  timeoutMs: number,
): Promise<{ children: string[]; queueFlags: Record<string, string> }> => {
  const started = Date.now();
  let latest = { children: [] as string[], queueFlags: {} as Record<string, string> };
  while (Date.now() - started < timeoutMs) {
    latest = await readChildStatus(statusDir);
    if (latest.children.length >= expectedCount) {
      return latest;
    }
    await Bun.sleep(25);
  }
  throw new Error(
    `timed out waiting for ${expectedCount} stub children, started=${latest.children.join(",")}`,
  );
};

const runStartScript = async (options: {
  env: Record<string, string>;
  expectChildren?: number;
  timeoutMs?: number;
}): Promise<StartResult> => {
  const root = await mkdtemp(join(tmpdir(), "keeper-start-"));
  const appRoot = join(root, "app");
  const stubDir = join(root, "bin");
  const statusDir = join(root, "status");
  const stopPath = join(root, "stop");
  await mkdir(join(appRoot, "applications", "web"), { recursive: true });
  await mkdir(stubDir, { recursive: true });
  await mkdir(statusDir, { recursive: true });

  const original = await readFile(START_SCRIPT, "utf8");
  const cdMatches = original.match(/^cd \/app$/gm) ?? [];
  if (cdMatches.length !== 1) {
    throw new Error("start.sh app root line changed");
  }
  const scriptPath = join(root, "start.sh");
  await writeFile(scriptPath, original.replace("cd /app", `cd "${appRoot}"`));
  await chmod(scriptPath, 0o755);

  const stubBun = join(stubDir, "bun");
  await writeFile(
    stubBun,
    `#!/bin/sh
ident=unknown
case "$*" in
  *services/api/*) ident=api ;;
  *services/cron/*) ident=cron ;;
  *services/worker/*) ident=worker ;;
  *server-entry*) ident=web ;;
esac
printf '%s\\n' "\${WORKER_JOB_QUEUE_ENABLED-<unset>}" > "\${STUB_STATUS_DIR:?}/\${ident}"
while [ ! -f "\${STUB_STOP:?}" ]; do
  sleep 0.05
done
`,
  );
  await chmod(stubBun, 0o755);

  const env = {
    HOME: root,
    PATH: `${stubDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    STUB_STATUS_DIR: statusDir,
    STUB_STOP: stopPath,
    TMPDIR: root,
    ...options.env,
  };
  const proc = Bun.spawn(["bash", scriptPath], {
    cwd: root,
    env,
    stderr: "pipe",
    stdout: "ignore",
  });
  const stderrReader = new Response(proc.stderr).text();

  try {
    if (typeof options.expectChildren === "number") {
      const started = await waitForChildren(
        statusDir,
        options.expectChildren,
        options.timeoutMs ?? 2000,
      );
      await writeFile(stopPath, "stop\n");
      const timer = setTimeout(() => proc.kill("SIGKILL"), 2000);
      const code = await proc.exited;
      clearTimeout(timer);
      const stderr = await stderrReader;
      return { ...started, code, stderr };
    }

    const timeout = options.timeoutMs ?? 3000;
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeout);
    const code = await proc.exited;
    clearTimeout(timer);
    const stderr = await stderrReader;
    const started = await readChildStatus(statusDir);
    return { ...started, code, stderr };
  } finally {
    await writeFile(stopPath, "stop\n").catch(() => {
      /* The process may already have exited. */
    });
    if (proc.exitCode === null) {
      proc.kill("SIGKILL");
      await proc.exited.catch(() => {
        /* SIGKILL already ended the process. */
      });
    }
    await rm(root, { recursive: true, force: true });
  }
};

describe("start.sh sync and worker queue flags", () => {
  it("fail-fasts before starting children when WORKER_JOB_QUEUE_ENABLED is false", async () => {
    const result = await runStartScript({
      env: {
        KEEPER_SYNC_ENABLED: "true",
        WORKER_JOB_QUEUE_ENABLED: "false",
      },
    });
    expect(result.code).toBe(64);
    expect(result.stderr).toContain(SYNC_REQUIRES_QUEUE);
    expect(result.children).toEqual([]);
  });

  it("fail-fasts before starting children when WORKER_JOB_QUEUE_ENABLED is invalid", async () => {
    const result = await runStartScript({
      env: {
        KEEPER_SYNC_ENABLED: "true",
        WORKER_JOB_QUEUE_ENABLED: "maybe",
      },
    });
    expect(result.code).toBe(64);
    expect(result.stderr).toContain(QUEUE_MUST_BE_BOOLEAN);
    expect(result.children).toEqual([]);
  });

  it("fail-fasts before starting children when KEEPER_SYNC_ENABLED is invalid", async () => {
    const result = await runStartScript({
      env: {
        KEEPER_SYNC_ENABLED: "yes",
      },
    });
    expect(result.code).toBe(64);
    expect(result.stderr).toContain(SYNC_MUST_BE_BOOLEAN);
    expect(result.children).toEqual([]);
  });
});

describe.skipIf(!bashSupportsWaitN)("start.sh child processes", () => {
  it("defaults WORKER_JOB_QUEUE_ENABLED=true for cron and worker when unset", async () => {
    const result = await runStartScript({
      env: { KEEPER_SYNC_ENABLED: "true" },
      expectChildren: 4,
    });
    expect(result.children).toEqual(["api", "cron", "web", "worker"]);
    expect(result.queueFlags.cron).toBe("true");
    expect(result.queueFlags.worker).toBe("true");
    expect(result.queueFlags.api).toBe("true");
    expect(result.queueFlags.web).toBe("true");
  });

  it("honors explicit WORKER_JOB_QUEUE_ENABLED=true and starts web, API, cron, and worker", async () => {
    const result = await runStartScript({
      env: {
        KEEPER_SYNC_ENABLED: "true",
        WORKER_JOB_QUEUE_ENABLED: "true",
      },
      expectChildren: 4,
    });
    expect(result.children).toEqual(["api", "cron", "web", "worker"]);
    expect(result.queueFlags.cron).toBe("true");
    expect(result.queueFlags.worker).toBe("true");
  });

  it("starts web and API without cron or worker when sync is disabled", async () => {
    const result = await runStartScript({
      env: { KEEPER_SYNC_ENABLED: "false" },
      expectChildren: 2,
    });
    expect(result.children).toEqual(["api", "web"]);
    expect(result.queueFlags.api).toBe("<unset>");
    expect(result.queueFlags.web).toBe("<unset>");
  });
});
