import { describe, expect, it } from "bun:test";
import { run } from "../src/cli";
import { MigrationError } from "../src/errors";

describe("CLI entry", () => {
  it("rejects a connection URL in argv before connecting", async () => {
    await expect(run(["audit", "postgres://local/keeper"], {})).rejects.toThrow(
      MigrationError,
    );
  });

  it("requires DATABASE_URL without opening a connection", async () => {
    await expect(run(["audit"], {})).rejects.toThrow(/DATABASE_URL/);
  });
});
