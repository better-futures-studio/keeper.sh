import { lstat, readFile } from "node:fs/promises";
import { MigrationError } from "./errors";
import {
  assertKeysDistinct,
  fingerprintKey,
  parseEncryptionKey,
} from "./crypto";
import type { KeyPair } from "./types";

const TARGET_MARKER = "keeper-aws-staging";
const OWNER_READ_WRITE_MODE = "600";
const PERMISSION_MODULUS = 512;
const POSTGRES_URL_PATTERN = /postgres(ql)?:\/\//i;

type CommandName = "audit" | "rotate-target";

interface ParsedArgs {
  command: CommandName;
  confirmTarget: string | null;
  databaseUrlFile: string | null;
  oldKeyFile: string | null;
  newKeyFile: string | null;
}

const usage = (): string =>
  [
    "Usage:",
    "  bun src/cli.ts audit [--database-url-file <path>]",
    "  bun src/cli.ts rotate-target --old-key-file <path> --new-key-file <path>",
    "      [--database-url-file <path>] [--confirm-target keeper-aws-staging]",
    "",
    "DATABASE_URL is read from the environment or from --database-url-file",
    "(file mode must be 0600). Do not pass connection URLs on the command line.",
  ].join("\n");

const rejectCommandLineUrls = (argv: string[]): void => {
  for (const argument of argv) {
    if (POSTGRES_URL_PATTERN.test(argument)) {
      throw new MigrationError(
        "COMMAND_LINE_URL",
        "Database URLs must not be passed on the command line",
      );
    }
  }
};

const readFlagValue = (
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new MigrationError("USAGE", `Missing value for ${flag}`);
  }
  return { value, nextIndex: index + 2 };
};

const parseArgs = (argv: string[]): ParsedArgs => {
  rejectCommandLineUrls(argv);
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    throw new MigrationError("USAGE", usage());
  }
  if (command !== "audit" && command !== "rotate-target") {
    throw new MigrationError("USAGE", usage());
  }

  let confirmTarget: string | null = null;
  let databaseUrlFile: string | null = null;
  let oldKeyFile: string | null = null;
  let newKeyFile: string | null = null;

  for (let index = 0; index < rest.length; ) {
    const flag = rest[index];
    if (flag === "--help" || flag === "-h") {
      throw new MigrationError("USAGE", usage());
    }
    if (flag === "--database-url-file") {
      const parsed = readFlagValue(rest, index, flag);
      databaseUrlFile = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (flag === "--old-key-file") {
      const parsed = readFlagValue(rest, index, flag);
      oldKeyFile = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (flag === "--new-key-file") {
      const parsed = readFlagValue(rest, index, flag);
      newKeyFile = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (flag === "--confirm-target") {
      const parsed = readFlagValue(rest, index, flag);
      confirmTarget = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    throw new MigrationError("USAGE", usage());
  }

  if (command === "audit") {
    if (oldKeyFile || newKeyFile) {
      throw new MigrationError(
        "USAGE",
        "audit does not accept encryption key files",
      );
    }
    if (confirmTarget) {
      throw new MigrationError(
        "USAGE",
        "audit does not accept --confirm-target",
      );
    }
  }

  return {
    command,
    confirmTarget,
    databaseUrlFile,
    oldKeyFile,
    newKeyFile,
  };
};

const permissionMode = (mode: number): string =>
  (mode % PERMISSION_MODULUS).toString(8).padStart(3, "0");

const assertOwnerReadWriteOnly = async (
  filePath: string,
  label: string,
): Promise<void> => {
  const stats = await lstat(filePath).catch(() => null);
  if (!stats) {
    throw new MigrationError("FILE_MISSING", `${label} could not be read`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new MigrationError("FILE_TYPE", `${label} must be a regular file`);
  }
  if (permissionMode(stats.mode) !== OWNER_READ_WRITE_MODE) {
    throw new MigrationError(
      "FILE_MODE",
      `${label} must have mode 0600`,
    );
  }
};

const readRestrictedFile = async (
  filePath: string,
  label: string,
): Promise<string> => {
  await assertOwnerReadWriteOnly(filePath, label);
  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw new MigrationError("FILE_MISSING", `${label} could not be read`);
  }
};

const resolveDatabaseUrl = async (
  env: NodeJS.ProcessEnv,
  databaseUrlFile: string | null,
): Promise<string> => {
  if (databaseUrlFile) {
    const contents = await readRestrictedFile(
      databaseUrlFile,
      "Database URL file",
    );
    const trimmed = contents.trim();
    if (trimmed.length === 0) {
      throw new MigrationError("DATABASE_URL", "Database URL file is empty");
    }
    return trimmed;
  }
  const fromEnv = env.DATABASE_URL?.trim();
  if (!fromEnv) {
    throw new MigrationError(
      "DATABASE_URL",
      "DATABASE_URL must be set in the environment or provided via --database-url-file",
    );
  }
  return fromEnv;
};

const loadKeyPair = async (
  oldKeyFile: string | null,
  newKeyFile: string | null,
): Promise<KeyPair> => {
  if (!oldKeyFile || !newKeyFile) {
    throw new MigrationError(
      "USAGE",
      "rotate-target requires --old-key-file and --new-key-file",
    );
  }
  const oldRaw = await readRestrictedFile(oldKeyFile, "Old encryption key file");
  const newRaw = await readRestrictedFile(newKeyFile, "New encryption key file");
  const oldKey = parseEncryptionKey(oldRaw);
  const newKey = parseEncryptionKey(newRaw);
  assertKeysDistinct(oldKey, newKey);
  return {
    oldKey,
    newKey,
    oldFingerprint: fingerprintKey(oldKey),
    newFingerprint: fingerprintKey(newKey),
  };
};

const applicationNameFromUrl = (databaseUrl: string): string | null => {
  try {
    const parsed = new URL(databaseUrl);
    const fromQuery = parsed.searchParams.get("application_name");
    if (!fromQuery || fromQuery.trim().length === 0) {
      return null;
    }
    return fromQuery;
  } catch {
    return null;
  }
};

const confirmRotationTarget = (
  applicationName: string,
  confirmTarget: string | null = null,
): "application_name" | "confirm-target" => {
  if (confirmTarget && confirmTarget !== TARGET_MARKER) {
    throw new MigrationError(
      "TARGET_CONFIRMATION",
      `Invalid --confirm-target value; expected ${TARGET_MARKER}`,
    );
  }
  if (applicationName === TARGET_MARKER) {
    return "application_name";
  }
  if (confirmTarget === TARGET_MARKER) {
    return "confirm-target";
  }
  throw new MigrationError(
    "TARGET_NOT_CONFIRMED",
    `Rotation requires application_name=${TARGET_MARKER} or --confirm-target ${TARGET_MARKER}`,
  );
};

export {
  TARGET_MARKER,
  applicationNameFromUrl,
  confirmRotationTarget,
  loadKeyPair,
  parseArgs,
  resolveDatabaseUrl,
  usage,
};
