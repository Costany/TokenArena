import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiSettings, ParseResult } from "../domain/types";
import {
  buildUploadManifestScope,
  createUploadManifest,
  diffUploadManifest,
} from "../domain/upload-manifest";
import { runAllParsers } from "../services/parser-service";
import { toUploadBuckets, toUploadSessions } from "../services/sync-service";
import { useTempDirs } from "../testing/temp-dir";
import { logger } from "../utils/logger";
import * as registry from "./registry";
import { SnowAppParser } from "./snow-app";

let sqlite: typeof import("node:sqlite") | null = null;
try {
  sqlite = await import("node:sqlite");
} catch {
  /* Node 20: real SQLite tests require node:sqlite. */
}

const temp = useTempDirs("tokenarena-snow-app-safety-");
const directoryId = "local:F:\\ComputerLanguage\\code\\Pisces\\Pisces";
beforeEach(() => vi.stubEnv("TZ", "UTC"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function editFixture(dbPath: string, edit: (db: DatabaseSync) => void) {
  if (!sqlite) throw new Error("node:sqlite unavailable");
  const db = new sqlite.DatabaseSync(dbPath);
  try {
    edit(db);
  } finally {
    db.close();
  }
}

function fixture(edit?: (db: DatabaseSync) => void) {
  const dbPath = join(temp(), "snowapp.db");
  editFixture(dbPath, (db) => {
    // No workspace table: only the immutable ledger and timing metadata matter.
    // No affinity on fork_message_count, so malformed TEXT '0' is not coerced
    // into integer 0 by SQLite before the parser has a chance to validate it.
    db.exec(`
      CREATE TABLE usage_records(id TEXT PRIMARY KEY, conversation_id TEXT,
        directory_id TEXT, model TEXT, created_at TEXT, input_tokens INTEGER,
        output_tokens INTEGER, cache_read_input_tokens INTEGER,
        cache_creation_input_tokens INTEGER);
      CREATE TABLE chat_conversations(conversation_id TEXT PRIMARY KEY,
        forked_from_conversation_id TEXT, fork_message_count);
      CREATE TABLE chat_messages(id TEXT PRIMARY KEY, conversation_id TEXT,
        role TEXT, created_at TEXT);
      INSERT INTO chat_conversations VALUES ('s1', '', 0);
      INSERT INTO chat_messages VALUES
        ('m1', 's1', 'user', '2026-09-30T10:00:00Z'),
        ('m2', 's1', 'assistant', '2026-09-30T10:00:05Z');
    `);
    db.prepare(
      "INSERT INTO usage_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "u1",
      "s1",
      directoryId,
      "model-a",
      "2026-09-30T10:00:05Z",
      100,
      20,
      70,
      10,
    );
    edit?.(db);
  });
  return { dbPath, parser: new SnowAppParser({ dbPath }) };
}

async function expectDeferred(parser: SnowAppParser, reason: RegExp) {
  await expect(parser.parse()).rejects.toThrow(reason);
  // Isolate discovery only: use the real SQL reader, parser, scheduler and cache
  // bypass (Snow App has no listSourceFiles), never a user's registered parsers.
  vi.spyOn(registry, "getAllParsers").mockReturnValue([parser]);
  const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
  expect(await runAllParsers()).toEqual({
    buckets: [],
    sessions: [],
    parserResults: [],
    failedSources: ["snow-app"],
  });
  expect(warning).toHaveBeenCalledWith(expect.stringMatching(reason));
}

describe.skipIf(!sqlite)("Snow App SQLite safety", () => {
  it.each([
    "raw",
    "hashed",
    "disabled",
  ] as const)("keeps all fields and manifest fingerprints after registration rename/remove (%s)", async (projectMode) => {
    const { dbPath, parser } = fixture((db) => {
      db.exec(
        "CREATE TABLE workspace_directories(directory_id TEXT, path TEXT)",
      );
      db.prepare("INSERT INTO workspace_directories VALUES (?, ?)").run(
        directoryId,
        "F:\\ComputerLanguage\\code\\Pisces\\Pisces",
      );
    });
    const before = await parser.parse();
    expect(before.buckets).toHaveLength(1);
    expect(before.buckets[0]).toMatchObject({
      source: "snow-app",
      project: "Pisces",
      model: "model-a",
      bucketStart: "2026-09-30T10:00:00.000Z",
      inputTokens: 20,
      outputTokens: 20,
      cachedTokens: 70,
      cacheCreationTokens: 10,
      reasoningTokens: 0,
      totalTokens: 120,
    });
    expect(before.sessions).toHaveLength(1);
    const settings: ApiSettings = {
      schemaVersion: 2,
      projectMode,
      projectHashSalt: "fixture-salt",
      timezone: "UTC",
    };
    const device = { deviceId: "fixture-device", hostname: "fixture-host" };
    const payload = (result: ParseResult) => ({
      buckets: toUploadBuckets(result.buckets, settings, device),
      sessions: toUploadSessions(result.sessions, settings, device),
    });
    const scope = buildUploadManifestScope({
      apiKey: "fixture-key",
      apiUrl: "https://example.invalid",
      deviceId: device.deviceId,
      settings,
    });
    const previousPayload = payload(before);
    if (projectMode === "raw")
      expect(previousPayload.buckets[0].projectLabel).toBe("Pisces");
    const previous = createUploadManifest({ ...previousPayload, scope });
    for (const sql of [
      "UPDATE workspace_directories SET path = '/renamed/OtherProject'",
      "DELETE FROM workspace_directories",
      "DROP TABLE workspace_directories",
    ]) {
      editFixture(dbPath, (db) => db.exec(sql));
      const after = await parser.parse();
      expect(after).toEqual(before);
      expect(payload(after)).toEqual(previousPayload);
      // Simulate a repeated sync entirely in memory; never persist or upload.
      expect(
        diffUploadManifest({ ...payload(after), previous, scope }),
      ).toMatchObject({
        bucketsToUpload: [],
        sessionsToUpload: [],
        removedBuckets: 0,
        removedSessions: 0,
        unchangedBuckets: 1,
        unchangedSessions: 1,
        scopeChangedReasons: [],
      });
    }
  });

  it.each([
    ["", "unknown"],
    ["local:/work/Pisces/", "Pisces"],
    ["local:C:/work/Pisces/", "Pisces"],
    [directoryId, "Pisces"],
    ["local:\\\\server\\share\\Pisces\\", "Pisces"],
  ])("accepts ledger identity %s without a workspace registration", async (id, project) => {
    const { parser } = fixture((db) => {
      db.prepare("UPDATE usage_records SET directory_id = ?").run(id);
    });
    const result = await parser.parse();
    expect(result.buckets[0].project).toBe(project);
    expect(result.sessions[0].project).toBe(project);
  });

  it.each([
    "opaque-id",
    "ssh:user@host:/work/Pisces",
    "local:relative/Pisces",
    "local:C:Pisces",
    "local:",
    null,
  ])("defers the entire source for unsupported directory identity %s", async (id) => {
    const { parser } = fixture((db) => {
      db.prepare(`INSERT INTO usage_records SELECT 'u2', '', ?, model,
          created_at, input_tokens, output_tokens, cache_read_input_tokens,
          cache_creation_input_tokens FROM usage_records`).run(id);
    });
    await expectDeferred(parser, /unsupported directory identity/);
  });

  describe.each([
    true,
    false,
  ])("fork metadata with messages=%s", (withMessages) => {
    it.each([
      { parent: "parent", count: 3 },
      { parent: "parent", count: 0 },
      { parent: "", count: 1 },
      { parent: "", count: -1 },
      { parent: "", count: "0" },
      { parent: "", count: "invalid" },
      { parent: "", count: 0.5 },
      { parent: "", count: null },
      { parent: null, count: 0 },
    ])("defers parent=$parent count=$count, including otherwise valid usage", async ({
      parent,
      count,
    }) => {
      const { parser } = fixture((db) => {
        db.prepare("INSERT INTO chat_conversations VALUES ('fork', ?, ?)").run(
          parent,
          count,
        );
        db.exec(`INSERT INTO usage_records SELECT 'u2', 'fork', directory_id,
          model, created_at, input_tokens, output_tokens, cache_read_input_tokens,
          cache_creation_input_tokens FROM usage_records`);
        if (withMessages)
          db.exec(`INSERT INTO chat_messages VALUES
          ('fork-message', 'fork', 'assistant', '2026-09-30T10:00:06Z')`);
      });
      await expectDeferred(parser, /fork metadata.*scan deferred/);
    });
  });

  it("does not let an unrelated fork without usage block ordinary conversations", async () => {
    const { parser } = fixture((db) => {
      db.exec(
        "INSERT INTO chat_conversations VALUES ('unrelated', 'parent', -1)",
      );
    });
    expect((await parser.parse()).buckets[0].totalTokens).toBe(120);
  });

  describe.each(["usage", "message"])("%s timestamps", (kind) => {
    function at(timestamp: string) {
      return fixture((db) => {
        const sql =
          kind === "usage"
            ? "UPDATE usage_records SET created_at = ?"
            : "UPDATE chat_messages SET created_at = ? WHERE id = 'm2'";
        db.prepare(sql).run(timestamp);
      }).parser;
    }

    it.each([
      ["America/New_York", "2026-11-01T01:15:00-05:00", /across DST/],
      ["America/New_York", "2026-11-01 01:15:00", /ambiguous local timestamp/],
      ["America/New_York", "2026-03-08 02:15:00", /invalid local timestamp/],
      ["Australia/Lord_Howe", "2026-04-05T01:30:00+10:30", /across DST/],
      [
        "Australia/Lord_Howe",
        "2026-04-05 01:45:00",
        /ambiguous local timestamp/,
      ],
    ] as const)("defers unsafe DST in %s at %s", async (zone, timestamp, reason) => {
      vi.stubEnv("TZ", zone);
      await expectDeferred(at(timestamp), reason);
    });

    it.each([
      "1000-01-01T00:00:00Z",
      "9999-12-31T23:59:59Z",
      "2019-12-31T23:59:59.999Z",
      "2080-01-01T00:00:00Z",
      "2020-01-01T00:00:00+00:01",
      "2079-12-31T23:59:59-00:01",
    ])("defers out-of-range UTC instant %s", async (timestamp) => {
      await expectDeferred(at(timestamp), /outside the supported range/);
    });
  });

  it.each([
    [
      "America/New_York",
      "2026-11-01T01:15:00-04:00",
      "2026-11-01T05:00:00.000Z",
    ],
    [
      "America/New_York",
      "2026-11-01T02:15:00-05:00",
      "2026-11-01T07:00:00.000Z",
    ],
    [
      "America/New_York",
      "2026-03-08T03:05:00-04:00",
      "2026-03-08T07:00:00.000Z",
    ],
    ["UTC", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00.000Z"],
    ["UTC", "2079-12-31T23:59:59.999Z", "2079-12-31T23:30:00.000Z"],
    ["UTC", "2019-12-31T23:30:00-00:30", "2020-01-01T00:00:00.000Z"],
    ["UTC", "2080-01-01T00:30:00+01:00", "2079-12-31T23:30:00.000Z"],
  ])("keeps safe explicit offset in %s at %s", async (zone, timestamp, bucketStart) => {
    vi.stubEnv("TZ", zone);
    const { parser } = fixture((db) => {
      db.prepare("UPDATE usage_records SET created_at = ?").run(timestamp);
      db.prepare("UPDATE chat_messages SET created_at = ?").run(timestamp);
    });
    const result = await parser.parse();
    expect(result.buckets[0]).toMatchObject({ bucketStart, totalTokens: 120 });
    expect(result.sessions[0]).toMatchObject({
      firstMessageAt: new Date(timestamp).toISOString(),
      lastMessageAt: new Date(timestamp).toISOString(),
      totalTokens: 120,
      durationSeconds: 0,
      activeSeconds: 0,
      messageCount: 2,
    });
  });

  it.each([
    "bucket",
    "session",
  ])("rejects %s total overflow even when every request is safe", async (level) => {
    const { parser } = fixture((db) => {
      db.prepare(`UPDATE usage_records SET input_tokens = ?, output_tokens = 0,
        cache_read_input_tokens = 0, cache_creation_input_tokens = 0`).run(
        2 ** 52,
      );
      db.exec(`INSERT INTO usage_records SELECT 'u2', conversation_id, directory_id,
        model, created_at, input_tokens, output_tokens, cache_read_input_tokens,
        cache_creation_input_tokens FROM usage_records`);
      if (level === "session") {
        // Separate buckets stay safe; only the cross-model session total overflows.
        db.exec("UPDATE usage_records SET model = 'model-b' WHERE id = 'u2'");
      } else {
        db.exec("DELETE FROM chat_messages");
      }
    });
    await expectDeferred(
      parser,
      /aggregate exceeds supported counts or duration/,
    );
  });

  it("keeps the maximum supported era span within int32 session durations", async () => {
    const { parser } = fixture((db) => {
      db.exec(`UPDATE chat_messages SET created_at = '2020-01-01T00:00:00Z' WHERE id = 'm1';
        UPDATE chat_messages SET created_at = '2079-12-31T23:59:59.999Z' WHERE id = 'm2'`);
    });
    const session = (await parser.parse()).sessions[0];
    // A 60-year timestamp range cannot reach the ~68-year int32 limit without
    // mocking production helpers; verify the real reachable boundary instead.
    expect(session.durationSeconds).toBe(
      Math.round((Date.UTC(2080, 0, 1) - Date.UTC(2020, 0, 1) - 1) / 1000),
    );
    expect(session.durationSeconds).toBeLessThanOrEqual(2_147_483_647);
    expect(session.activeSeconds).toBeLessThanOrEqual(2_147_483_647);
  });
});
