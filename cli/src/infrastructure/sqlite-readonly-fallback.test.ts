import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSqliteRowsWithCli } from "./sqlite";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

// Exercise the external fallback independently of the Node version running Vitest.
async function readSqliteRowsReadonly(path: string, query: string) {
  return readSqliteRowsWithCli(path, query, true);
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("read-only sqlite3 fallback", () => {
  it("passes -readonly and uses the configured binary", async () => {
    vi.stubEnv("TOKEN_ARENA_SQLITE3", "custom-sqlite3");
    vi.mocked(execFileSync).mockReturnValue('[{"value":42}]');
    expect(
      await readSqliteRowsReadonly("usage.db", "SELECT 42 AS value"),
    ).toEqual([{ value: 42 }]);
    expect(execFileSync).toHaveBeenCalledWith(
      "custom-sqlite3",
      ["-readonly", "-json", "usage.db", "SELECT 42 AS value"],
      expect.any(Object),
    );
  });

  it("tries another binary only when the executable is missing", async () => {
    vi.stubEnv("TOKEN_ARENA_SQLITE3", "missing-sqlite3");
    vi.mocked(execFileSync)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("missing binary"), { code: "ENOENT" });
      })
      .mockReturnValue("[]");
    expect(await readSqliteRowsReadonly("usage.db", "SELECT 1")).toEqual([]);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it("propagates SQL errors without trying an unsafe alternative", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("database is locked");
    });
    await expect(
      readSqliteRowsReadonly("usage.db", "SELECT 1"),
    ).rejects.toThrow("database is locked");
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it("reports missing executables and malformed output", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    await expect(
      readSqliteRowsReadonly("usage.db", "SELECT 1"),
    ).rejects.toThrow("sqlite3 CLI not found");
    vi.mocked(execFileSync).mockReturnValue("not json");
    await expect(
      readSqliteRowsReadonly("usage.db", "SELECT 1"),
    ).rejects.toThrow();
  });
});
