import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDirs } from "../testing/temp-dir";
import { readSqliteRowsReadonly } from "./sqlite";

let sqlite: typeof import("node:sqlite") | null = null;
try {
  sqlite = await import("node:sqlite");
} catch {
  // Node 20 uses the external sqlite3 fallback.
}
const temp = useTempDirs("tokenarena-readonly-");

describe.skipIf(!sqlite)("readSqliteRowsReadonly", () => {
  it("includes committed WAL rows without modifying the database", async () => {
    if (!sqlite) return;
    const path = join(temp(), "usage.db");
    const writer = new sqlite.DatabaseSync(path);
    try {
      writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE usage(id TEXT);");
      writer.exec(
        "INSERT INTO usage VALUES ('first'); PRAGMA wal_checkpoint(TRUNCATE);",
      );
      writer.exec("INSERT INTO usage VALUES ('pending');");
      expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
      const before = readFileSync(path);
      const walBefore = readFileSync(`${path}-wal`);
      expect(
        await readSqliteRowsReadonly(path, "SELECT id FROM usage ORDER BY id"),
      ).toEqual([{ id: "first" }, { id: "pending" }]);
      expect(readFileSync(path)).toEqual(before);
      expect(readFileSync(`${path}-wal`)).toEqual(walBefore);
    } finally {
      writer.close();
    }
  });

  it("rejects writes and query errors instead of returning an empty result", async () => {
    if (!sqlite) return;
    const path = join(temp(), "usage.db");
    const writer = new sqlite.DatabaseSync(path);
    writer.exec(
      "CREATE TABLE usage(id TEXT); INSERT INTO usage VALUES ('keep');",
    );
    writer.close();
    await expect(
      readSqliteRowsReadonly(path, "DELETE FROM usage RETURNING id"),
    ).rejects.toThrow(/readonly/i);
    await expect(
      readSqliteRowsReadonly(path, "SELECT * FROM missing"),
    ).rejects.toThrow(/no such table/i);
    expect(await readSqliteRowsReadonly(path, "SELECT id FROM usage")).toEqual([
      { id: "keep" },
    ]);
  });

  it("does not create missing databases", async () => {
    const path = join(temp(), "missing.db");
    await expect(readSqliteRowsReadonly(path, "SELECT 1")).rejects.toThrow();
    expect(existsSync(path)).toBe(false);
  });
});
