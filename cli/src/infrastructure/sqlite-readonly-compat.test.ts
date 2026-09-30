import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSqliteRows, readSqliteRowsReadonly } from "./sqlite";

const { DatabaseSync, closeProbe, close, prepare, all } = vi.hoisted(() => ({
  DatabaseSync: vi.fn(),
  closeProbe: vi.fn(),
  close: vi.fn(),
  prepare: vi.fn(),
  all: vi.fn(),
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));
const importFailure = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock("node:sqlite", () => ({
  DatabaseSync,
  // A cached module's then export rejects dynamic import without Vitest wrapping
  // a factory exception. Keep the original error code at the production boundary.
  // biome-ignore lint/suspicious/noThenProperty: Intentional thenable to reject dynamic import in the coverage worker.
  get then() {
    const error = importFailure.error;
    return error
      ? (_resolve: unknown, reject: (reason: Error) => void) => reject(error)
      : undefined;
  },
}));

const originalEmitWarning = process.emitWarning;

beforeEach(() => {
  vi.stubEnv("TOKEN_ARENA_SQLITE3", "");
  DatabaseSync.mockImplementation(function MockDatabase(
    this: unknown,
    path: string,
    options: { readOnly: boolean },
  ) {
    void this; // Keep a constructable function: production invokes it with new.
    const readOnly = options.readOnly;
    if (path === ":memory:") return { close: closeProbe };
    expect(closeProbe).toHaveBeenCalledTimes(1);
    expect(readOnly).toBe(true);
    return { close, prepare };
  });
  prepare.mockReturnValue({ all });
  all.mockReturnValue([{ value: 42 }]);
});

afterEach(() => {
  importFailure.error = null;
  expect(process.emitWarning).toBe(originalEmitWarning);
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("legacy SQLite CLI compatibility", () => {
  it("keeps the existing CLI arguments for callers of readSqliteRows", async () => {
    await import("node:sqlite");
    importFailure.error = Object.assign(new Error("node:sqlite unavailable"), {
      code: "ERR_UNKNOWN_BUILTIN_MODULE",
    });
    vi.mocked(execFileSync).mockReturnValue('[{"value":42}]');

    expect(await readSqliteRows("usage.db", "SELECT 42")).toEqual([
      { value: 42 },
    ]);
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
      "sqlite3",
      ["-json", "usage.db", "SELECT 42"],
      expect.any(Object),
    );
    expect(DatabaseSync).not.toHaveBeenCalled();
  });
});

describe("readSqliteRowsReadonly in-process import rejection", () => {
  it.each([
    "ERR_UNKNOWN_BUILTIN_MODULE",
    "ERR_ACCESS_DENIED",
    undefined,
  ])("handles import error code %s without opening a database", async (code) => {
    // Resolve the factory while then is undefined; subsequent imports exercise
    // Promise assimilation of the cached namespace in the coverage worker.
    await import("node:sqlite");
    const error = Object.assign(new Error("node:sqlite unavailable"), {
      code,
    });
    importFailure.error = error;
    vi.mocked(execFileSync).mockReturnValue('[{"value":42}]');

    if (code === "ERR_UNKNOWN_BUILTIN_MODULE") {
      expect(await readSqliteRowsReadonly("usage.db", "SELECT 42")).toEqual([
        { value: 42 },
      ]);
      expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
        "sqlite3",
        ["-readonly", "-json", "usage.db", "SELECT 42"],
        expect.any(Object),
      );
    } else {
      await expect(
        readSqliteRowsReadonly("usage.db", "SELECT 42"),
      ).rejects.toBe(error);
      expect(execFileSync).not.toHaveBeenCalled();
    }
    expect(DatabaseSync).not.toHaveBeenCalled();
    expect(closeProbe).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("readSqliteRowsReadonly capability checks", () => {
  it.each([
    "22.5.0",
    "22.11.0",
    "23.0.0",
    "23.1.0",
  ])("never opens the file when Node %s ignores readOnly", async (version) => {
    vi.stubGlobal("process", {
      ...process,
      versions: { ...process.versions, node: version },
    });
    DatabaseSync.mockImplementation(function OldDatabase(this: unknown) {
      void this;
      return { close: closeProbe };
    });
    vi.mocked(execFileSync).mockReturnValue('[{"value":42}]');
    expect(await readSqliteRowsReadonly("usage.db", "SELECT 42")).toEqual([
      { value: 42 },
    ]);
    expect(DatabaseSync).toHaveBeenCalledTimes(1);
    expect(DatabaseSync).toHaveBeenCalledWith(":memory:", expect.any(Object));
    expect(closeProbe).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
      "sqlite3",
      ["-readonly", "-json", "usage.db", "SELECT 42"],
      expect.any(Object),
    );
  });

  it.each([
    "22.12.0",
    "23.2.0",
    "24.0.0",
  ])("uses the recognized readOnly option on Node %s", async (version) => {
    vi.stubGlobal("process", {
      ...process,
      versions: { ...process.versions, node: version },
    });
    expect(await readSqliteRowsReadonly("usage.db", "SELECT 42")).toEqual([
      { value: 42 },
    ]);
    expect(DatabaseSync).toHaveBeenCalledTimes(2);
    expect(DatabaseSync).toHaveBeenNthCalledWith(
      1,
      ":memory:",
      expect.any(Object),
    );
    expect(DatabaseSync).toHaveBeenNthCalledWith(2, "usage.db", {
      readOnly: true,
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each([
    "open",
    "prepare",
    "all",
  ])("propagates %s errors without CLI, writable or immutable retries", async (stage) => {
    const error = Object.assign(
      new Error("node:sqlite: unable to open database file"),
      { code: "ERR_SQLITE_ERROR" },
    );
    function fail() {
      throw error;
    }
    if (stage === "open") {
      DatabaseSync.mockImplementationOnce(function Probe(
        this: unknown,
        _path: string,
        options: { readOnly: boolean },
      ) {
        void this;
        expect(options.readOnly).toBe(false);
        return { close: closeProbe };
      }).mockImplementationOnce(fail);
    } else if (stage === "prepare") {
      prepare.mockImplementation(fail);
    } else {
      all.mockImplementation(fail);
    }
    await expect(readSqliteRowsReadonly("usage.db", "SELECT 1")).rejects.toBe(
      error,
    );
    expect(DatabaseSync).toHaveBeenCalledTimes(2);
    expect(DatabaseSync).toHaveBeenLastCalledWith("usage.db", {
      readOnly: true,
    });
    expect(closeProbe).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(stage === "open" ? 0 : 1);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each([
    "open",
    "close",
  ])("fails closed if the memory probe cannot %s", async (stage) => {
    const error = new Error("probe failed");
    function fail() {
      throw error;
    }
    if (stage === "open") DatabaseSync.mockImplementation(fail);
    else closeProbe.mockImplementation(fail);
    await expect(readSqliteRowsReadonly("usage.db", "SELECT 1")).rejects.toBe(
      error,
    );
    expect(DatabaseSync).toHaveBeenCalledTimes(1);
    expect(DatabaseSync).toHaveBeenCalledWith(":memory:", expect.any(Object));
    expect(execFileSync).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

// A real module loader rejects import() with the original error code. Vitest
// wraps errors thrown by mock factories, so test this boundary in a subprocess.
describe("readSqliteRowsReadonly import errors", () => {
  it.each([
    "ERR_UNKNOWN_BUILTIN_MODULE",
    "ERR_ACCESS_DENIED",
  ])("handles %s at the production import boundary", (code) => {
    const loader = `
        export async function resolve(specifier, context, nextResolve) {
          if (specifier === 'node:sqlite') {
            throw Object.assign(new Error('node:sqlite unavailable'), { code: ${JSON.stringify(
              code,
            )} });
          }
          if (specifier === 'node:child_process') {
            return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(
              'export function execFileSync(command, args) {' +
              'globalThis.cliCalls.push([command, args]); return JSON.stringify([{value:42}]); }'
            ) };
          }
          return nextResolve(specifier, context);
        }
      `;
    const script = `
        import { register } from 'node:module';
        register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(
          loader,
        )}), import.meta.url);
        globalThis.cliCalls = [];
        const { readSqliteRowsReadonly } = await import(${JSON.stringify(
          new URL("./sqlite.ts", import.meta.url).href,
        )});
        let result;
        try { result = { rows: await readSqliteRowsReadonly('usage.db', 'SELECT 42') }; }
        catch (error) { result = { code: error.code }; }
        console.log(JSON.stringify({ ...result, calls: globalThis.cliCalls }));
      `;
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: { ...process.env, TOKEN_ARENA_SQLITE3: "" },
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout);
    if (code === "ERR_UNKNOWN_BUILTIN_MODULE") {
      expect(result).toEqual({
        rows: [{ value: 42 }],
        calls: [["sqlite3", ["-readonly", "-json", "usage.db", "SELECT 42"]]],
      });
    } else {
      expect(result).toEqual({ code, calls: [] });
    }
  });
});
