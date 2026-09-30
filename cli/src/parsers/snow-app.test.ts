import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqliteQueryRows } from "../infrastructure/sqlite";
import { useTempDirs } from "../testing/temp-dir";
import { getParser } from "./registry";
import { SnowAppParser } from "./snow-app";

const temp = useTempDirs("tokenarena-snow-app-");
afterEach(() => vi.unstubAllEnvs());

function usage(overrides: Record<string, unknown> = {}) {
  return {
    kind: "usage",
    id: "u1",
    sessionId: "s1",
    model: "model-a",
    directoryId: "local:C:\\work\\Pisces",
    timestamp: "2026-09-30 10:05:00",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 70,
    cacheCreationTokens: 10,
    ...overrides,
  };
}
function message(overrides: Record<string, unknown> = {}) {
  return {
    kind: "message",
    id: "m1",
    sessionId: "s1",
    directoryId: "local:C:\\work\\Pisces",
    timestamp: "2026-09-30 10:05:00",
    role: "assistant",
    ...overrides,
  };
}
function parserFor(rows: Record<string, unknown>[]) {
  const dbPath = join(temp(), "snowapp.db");
  writeFileSync(dbPath, "test double");
  const queryRows = vi.fn(async () => rows);
  const parser = new SnowAppParser({
    dbPath,
    queryRows: async <T>() => (await queryRows()) as T[],
  });
  return { parser, queryRows };
}

describe("SnowAppParser", () => {
  it("registers separately from Snow CLI and splits inclusive input without changing totals", async () => {
    const { parser, queryRows } = parserFor([
      usage(),
      message({ id: "user", role: "user", timestamp: "2026-09-30 10:04:55" }),
      message(),
    ]);
    expect(parser.tool.id).toBe("snow-app");
    expect(parser.tool.name).toBe("Snow App");
    expect(getParser("snow-app")).toBeInstanceOf(SnowAppParser);
    const result = await parser.parse();
    expect(queryRows).toHaveBeenCalledTimes(1);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "snow-app",
      project: "Pisces",
      inputTokens: 20,
      outputTokens: 20,
      cachedTokens: 70,
      cacheCreationTokens: 10,
      reasoningTokens: 0,
      totalTokens: 120,
    });
    expect(result.sessions[0]).toMatchObject({
      totalTokens: 120,
      messageCount: 2,
      userMessageCount: 1,
      durationSeconds: 5,
    });
  });

  it("deduplicates only equal native IDs, never equal counts or empty response IDs", async () => {
    const first = usage({ responseId: "" });
    const { parser } = parserFor([
      first,
      first,
      usage({ id: "u2", responseId: "" }),
      message(),
      message(),
    ]);
    const result = await parser.parse();
    expect(result.buckets[0].totalTokens).toBe(240);
    expect(result.sessions[0].messageCount).toBe(1);
    const conflict = parserFor([
      first,
      usage({ responseId: "", outputTokens: 30 }),
    ]);
    await expect(conflict.parser.parse()).rejects.toThrow(/Conflicting/);
  });

  it("keeps orphan, pure cache, subagent, failed and cancelled usage without fabricating sessions", async () => {
    const { parser } = parserFor([
      usage({
        sessionId: "",
        directoryId: "",
        model: "",
        inputTokens: 70,
        outputTokens: 0,
        cacheReadTokens: 70,
        cacheCreationTokens: 0,
        status: "failed",
      }),
      usage({
        id: "u2",
        sessionId: "child",
        isSubAgent: true,
        status: "tool_calls",
      }),
      usage({ id: "u3", sessionId: "orphan", status: "cancelled" }),
      usage({
        id: "u4",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        timestamp: "",
      }),
    ]);
    const result = await parser.parse();
    expect(result.buckets.reduce((sum, b) => sum + b.totalTokens, 0)).toBe(310);
    expect(result.buckets.find((b) => b.model === "unknown")?.project).toBe(
      "unknown",
    );
    expect(result.sessions).toEqual([]);
  });

  it("clamps excessive cache reads like the App, but defers incompatible cache writes", async () => {
    const { parser } = parserFor([
      usage({ inputTokens: 50, cacheReadTokens: 80, cacheCreationTokens: 0 }),
    ]);
    expect((await parser.parse()).buckets[0]).toMatchObject({
      inputTokens: 0,
      cachedTokens: 50,
      totalTokens: 70,
    });
    await expect(
      parserFor([usage({ cacheCreationTokens: 31 })]).parser.parse(),
    ).rejects.toThrow(/cache counts/);
  });

  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "5",
    null,
  ])("rejects invalid counts (%s) instead of uploading partial buckets", async (value) => {
    const { parser } = parserFor([
      usage(),
      usage({ id: "u2", inputTokens: value }),
    ]);
    await expect(parser.parse()).rejects.toThrow(/invalid token counts/);
  });

  it.each([
    "bad",
    "2026-02-30 12:00:00",
    "2026-13-01 12:00:00",
    "2026-09-30 24:00:00",
    "2026-09-30 12:60:00",
    "2026-09-30T12:00:00+25:00",
    "2026-03-08 02:30:00",
  ])("rejects invalid dates (%s)", async (timestamp) => {
    vi.stubEnv("TZ", "America/New_York");
    await expect(
      parserFor([usage({ timestamp })]).parser.parse(),
    ).rejects.toThrow(/timestamp|calendar date/);
  });

  it("interprets SQLite localtime and explicit offsets correctly", async () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    const local = await parserFor([usage()]).parser.parse();
    const offset = await parserFor([
      usage({
        timestamp: "2026-09-30T10:05:00+08:00",
        directoryId: "local:/work/Pisces/",
      }),
    ]).parser.parse();
    expect(local.buckets[0].bucketStart).toBe("2026-09-30T02:00:00.000Z");
    expect(offset.buckets).toEqual(local.buckets);
  });

  it("keeps an unambiguous local time before the DST overlap", async () => {
    vi.stubEnv("TZ", "America/New_York");
    const { parser } = parserFor([usage({ timestamp: "2026-11-01 00:15:00" })]);
    expect((await parser.parse()).buckets[0].bucketStart).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });

  it("preserves root directory and absent optional text fallbacks", async () => {
    const { parser } = parserFor([
      usage({ directoryId: "local:/", model: null, sessionId: null }),
    ]);
    const result = await parser.parse();
    expect(result.buckets[0]).toMatchObject({
      project: "unknown",
      model: "unknown",
      totalTokens: 120,
    });
    expect(result.sessions).toEqual([]);
  });

  it("propagates non-ENOENT stat errors without querying", async () => {
    const queryRowsMock = vi.fn(async () => [] as unknown[]);
    const queryRows: SqliteQueryRows = async <T>() =>
      (await queryRowsMock()) as T[];
    const parser = new SnowAppParser({
      dbPath: `invalid${String.fromCharCode(0)}.db`,
      queryRows,
    });
    expect(() => parser.isInstalled()).toThrow();
    await expect(parser.parse()).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_VALUE",
    });
    expect(queryRowsMock).not.toHaveBeenCalled();
  });

  it("defers malformed identity and message metadata", async () => {
    for (const row of [
      usage({ id: "" }),
      usage({ kind: "unknown" }),
      message({ sessionId: "" }),
      message({ role: "tool" }),
    ]) {
      await expect(parserFor([row]).parser.parse()).rejects.toThrow(
        /scan deferred/,
      );
    }
  });

  it("does not query a missing database, and propagates read failures", async () => {
    const queryRows = vi.fn(async () => []);
    const missing = new SnowAppParser({
      dbPath: join(temp(), "missing.db"),
      queryRows: async <T>() => (await queryRows()) as T[],
    });
    expect(missing.isInstalled()).toBe(false);
    expect(await missing.parse()).toEqual({ buckets: [], sessions: [] });
    expect(queryRows).not.toHaveBeenCalled();
    const { parser, queryRows: fail } = parserFor([]);
    fail.mockRejectedValue(new Error("database locked"));
    await expect(parser.parse()).rejects.toThrow("database locked");
  });
});

let sqlite: typeof import("node:sqlite") | null = null;
try {
  sqlite = await import("node:sqlite");
} catch {
  /* Node 20 */
}

describe.skipIf(!sqlite)("Snow App SQLite integration", () => {
  it("reads WAL and nonfork timing, excludes tool messages, and never adds message totals", async () => {
    if (!sqlite) return;
    const dbPath = join(temp(), "snowapp.db");
    const db = new sqlite.DatabaseSync(dbPath);
    try {
      db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE usage_records(id TEXT PRIMARY KEY, conversation_id TEXT, directory_id TEXT, model TEXT,
          created_at TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_input_tokens INTEGER,
          cache_creation_input_tokens INTEGER, status TEXT, is_sub_agent INTEGER);
        CREATE TABLE chat_conversations(conversation_id TEXT, forked_from_conversation_id TEXT, fork_message_count INTEGER);
        CREATE TABLE chat_messages(id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, created_at TEXT, input_tokens INTEGER);
        INSERT INTO chat_conversations VALUES ('ordinary', '', 0), ('child', '', 0);
        INSERT INTO chat_messages VALUES
          ('m1','ordinary','user','2026-09-30 10:00:00',999999),
          ('m2','ordinary','assistant','2026-09-30 10:00:05',999999),
          ('m3','ordinary','tool','2026-09-30 10:00:06',999999),
          ('m4','child','assistant','2026-09-30 10:00:07',999999);
        PRAGMA wal_checkpoint(TRUNCATE);
        INSERT INTO usage_records VALUES
          ('u1','ordinary','local:/work/Project','model','2026-09-30 10:00:05',100,20,70,10,'tool_calls',0),
          ('u2','child','local:/work/Project','model','2026-09-30 10:00:07',50,10,0,0,'completed',1),
          ('u3','orphan','','model','2026-09-30 10:00:07',10,5,0,0,'cancelled',0);`);
      const before = readFileSync(dbPath);
      const result = await new SnowAppParser({ dbPath }).parse();
      expect(result.buckets.reduce((sum, b) => sum + b.totalTokens, 0)).toBe(
        195,
      );
      expect(result.sessions).toHaveLength(2);
      expect(
        result.sessions.find((s) => s.userMessageCount === 1),
      ).toMatchObject({
        totalTokens: 120,
        messageCount: 2,
        durationSeconds: 5,
      });
      expect(
        result.sessions.find((s) => s.userMessageCount === 0),
      ).toMatchObject({ totalTokens: 60, messageCount: 1 });
      expect(
        result.buckets.find((b) => b.project === "unknown")?.totalTokens,
      ).toBe(15);
      expect(readFileSync(dbPath)).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("rejects an unsupported schema instead of producing partial usage", async () => {
    if (!sqlite) return;
    const dbPath = join(temp(), "snowapp.db");
    const db = new sqlite.DatabaseSync(dbPath);
    db.exec("CREATE TABLE unrelated(id TEXT)");
    db.close();
    await expect(new SnowAppParser({ dbPath }).parse()).rejects.toThrow(
      /no such table/,
    );
  });
});
