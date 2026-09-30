import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { logger } from "../utils/logger";

type SqliteDatabaseSync<TRow> = {
  close(): void;
  prepare(sql: string): {
    all(): TRow[];
  };
};

export type SqliteQueryRows = <TRow>(
  dbPath: string,
  query: string,
) => Promise<TRow[]>;

// process.emitWarning is global; serialize callers so overlapping SQLite reads
// cannot restore one another's temporary handler in the wrong order.
let warningScope = Promise.resolve();

export async function withSuppressedSqliteWarning<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const previousScope = warningScope;
  let releaseScope: () => void = () => {};
  warningScope = new Promise<void>((resolve) => {
    releaseScope = resolve;
  });
  await previousScope;
  const originalEmitWarning = process.emitWarning;

  process.emitWarning = ((
    warning: string | Error,
    ...args: unknown[]
  ): void => {
    const warningName =
      typeof warning === "string"
        ? typeof args[0] === "string"
          ? args[0]
          : ""
        : warning.name;
    const warningMessage =
      typeof warning === "string" ? warning : warning.message;

    if (
      warningName === "ExperimentalWarning" &&
      warningMessage.includes("SQLite")
    ) {
      return;
    }

    (
      originalEmitWarning as (
        warning: string | Error,
        ...warningArgs: unknown[]
      ) => void
    ).call(process, warning, ...args);
  }) as typeof process.emitWarning;

  try {
    return await fn();
  } finally {
    process.emitWarning = originalEmitWarning;
    releaseScope();
  }
}

/**
 * The immutable fallback promises SQLite the file cannot change, so SQLite
 * reads the main database alone and skips the write-ahead log. Anything not yet
 * checkpointed is invisible, and SQLite treats that as success rather than an
 * error, so warn instead of letting the usage silently come up short. Reading
 * the WAL would need a writable directory, which is exactly what this fallback
 * exists to work around, so there is nothing to recover here.
 *
 * Exported for tests: forcing the fallback from the outside needs an
 * unwritable database directory, and how SQLite reacts to one differs per
 * platform, so the warning is covered directly instead.
 */
export function warnWhenWalSkipped(dbPath: string): void {
  try {
    const pendingBytes = statSync(`${dbPath}-wal`).size;
    if (pendingBytes > 0) {
      logger.warn(
        `${dbPath} was read without its write-ahead log (${pendingBytes} bytes pending), so the newest records may be missing. This happens when the database directory is not writable.`,
      );
    }
  } catch {
    // No -wal file means nothing was skipped. A stat failure must never turn a
    // successful read into a failed one, so it is swallowed either way.
  }
}

async function readSqliteRowsWithBuiltin<TRow>(
  dbPath: string,
  query: string,
): Promise<TRow[] | null> {
  try {
    return await withSuppressedSqliteWarning(async () => {
      const sqliteModuleId = "node:sqlite";
      const sqlite = (await import(sqliteModuleId)) as {
        DatabaseSync: new (location: string) => SqliteDatabaseSync<TRow>;
      };

      const immutableLocation = `${
        pathToFileURL(dbPath).href
      }?mode=ro&immutable=1`;
      const locations = [dbPath, immutableLocation];
      let lastError: unknown = null;

      for (const location of locations) {
        let db: SqliteDatabaseSync<TRow> | null = null;
        try {
          db = new sqlite.DatabaseSync(location);
          const rows = db.prepare(query).all() as TRow[];
          if (location === immutableLocation) {
            warnWhenWalSkipped(dbPath);
          }
          return rows;
        } catch (err) {
          lastError = err;
          const error = err as NodeJS.ErrnoException;
          const message = (err as Error).message;
          if (
            error.code === "ERR_SQLITE_ERROR" &&
            message.includes("unable to open database file")
          ) {
            continue;
          }

          throw err;
        } finally {
          db?.close();
        }
      }

      throw lastError;
    });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    const message = (err as Error).message;
    if (
      error.code === "ERR_UNKNOWN_BUILTIN_MODULE" ||
      message.includes("node:sqlite")
    ) {
      return null;
    }

    throw err;
  }
}

export function readSqliteRowsWithCli<TRow>(
  dbPath: string,
  query: string,
  readOnly = false,
): TRow[] {
  const candidates = [
    process.env.TOKEN_ARENA_SQLITE3,
    "sqlite3",
    "sqlite3.exe",
  ].filter((value): value is string => Boolean(value));

  let lastError: Error | null = null;

  for (const command of candidates) {
    try {
      const args = [...(readOnly ? ["-readonly"] : []), "-json", dbPath, query];
      const output = execFileSync(command, args, {
        encoding: "utf-8",
        maxBuffer: 100 * 1024 * 1024,
        timeout: 30000,
        windowsHide: true,
      }).trim();

      if (!output || output === "[]") {
        return [];
      }

      return JSON.parse(output) as TRow[];
    } catch (err) {
      lastError = err as Error;
      const nodeError = err as NodeJS.ErrnoException & { status?: number };
      if (nodeError.status === 127 || nodeError.code === "ENOENT") {
        continue;
      }

      throw err;
    }
  }

  throw new Error(
    `sqlite3 CLI not found. Install sqlite3 or set TOKEN_ARENA_SQLITE3 to its full path. Last error: ${
      lastError?.message || "not found"
    }`,
  );
}

/** Read a live database without writes or an immutable fallback that loses WAL. */
export async function readSqliteRowsReadonly<TRow>(
  dbPath: string,
  query: string,
): Promise<TRow[]> {
  return withSuppressedSqliteWarning(async () => {
    const sqliteModuleId = "node:sqlite";
    let sqlite: {
      DatabaseSync: new (
        location: string,
        options: { readOnly: boolean },
      ) => SqliteDatabaseSync<TRow>;
    };
    try {
      sqlite = await import(sqliteModuleId);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ERR_UNKNOWN_BUILTIN_MODULE"
      ) {
        throw error;
      }
      return readSqliteRowsWithCli<TRow>(dbPath, query, true);
    }

    // Early node:sqlite versions (e.g. Node 22.11 with --experimental-sqlite)
    // silently ignore readOnly. Probe option recognition only in memory, never
    // on the user's database. Memory databases themselves are always writable.
    let supportsReadOnly = false;
    const probe = new sqlite.DatabaseSync(":memory:", {
      get readOnly() {
        supportsReadOnly = true;
        return false;
      },
    });
    probe.close();
    if (!supportsReadOnly) {
      return readSqliteRowsWithCli<TRow>(dbPath, query, true);
    }

    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(query).all();
    } finally {
      db.close();
    }
  });
}

export async function readSqliteRows<TRow>(
  dbPath: string,
  query: string,
): Promise<TRow[]> {
  const builtinRows = await readSqliteRowsWithBuiltin<TRow>(dbPath, query);
  return builtinRows ?? readSqliteRowsWithCli<TRow>(dbPath, query);
}
