import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSqliteRowsReadonly } from "./sqlite";

const { DatabaseSync, closeProbe } = vi.hoisted(() => ({
  DatabaseSync: vi.fn(),
  closeProbe: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:sqlite", () => ({ DatabaseSync }));

beforeEach(() => {
  vi.stubEnv("TOKEN_ARENA_SQLITE3", "");
  // Model early Node versions that import successfully but ignore readOnly.
  DatabaseSync.mockImplementation(function OldDatabase(this: unknown) {
    void this;
    return { close: closeProbe };
  });
});

afterEach(() => {
  expect(DatabaseSync).toHaveBeenCalledWith(":memory:", expect.any(Object));
  expect(DatabaseSync.mock.calls.every(([path]) => path === ":memory:")).toBe(
    true,
  );
  expect(closeProbe).toHaveBeenCalledTimes(DatabaseSync.mock.calls.length);
  for (const [, args] of vi.mocked(execFileSync).mock.calls) {
    expect(args).toEqual([
      "-readonly",
      "-json",
      "usage.db",
      expect.any(String),
    ]);
  }
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

  it("reports a useful fallback when missing executables have no error message", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error(""), { status: 127 });
    });
    await expect(
      readSqliteRowsReadonly("usage.db", "SELECT 1"),
    ).rejects.toThrow("Last error: not found");
    expect(
      vi.mocked(execFileSync).mock.calls.map(([command]) => command),
    ).toEqual(["sqlite3", "sqlite3.exe"]);
  });

  it("does not mistake ENOENT in a SQL error message for a missing executable", async () => {
    const error = Object.assign(new Error("SQL error near ENOENT"), {
      status: 1,
    });
    vi.mocked(execFileSync).mockImplementation(() => {
      throw error;
    });
    await expect(readSqliteRowsReadonly("usage.db", "SELECT 1")).rejects.toBe(
      error,
    );
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});
