import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { aggregateToBuckets } from "../domain/aggregator";
import { extractSessions } from "../domain/session-extractor";
import type {
  ParseResult,
  SessionEvent,
  TokenUsageEntry,
} from "../domain/types";
import {
  readSqliteRowsReadonly,
  type SqliteQueryRows,
} from "../infrastructure/sqlite";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const TOOL_ID = "snow-app";
const DEFAULT_DB_PATH = join(homedir(), ".snowapp", "snowapp.db");

// A single SELECT gives usage and timing one SQLite snapshot, including the WAL.
// Never select content, raw_json, prompts, credentials, or conversation totals.
// usage_records is the ONLY token ledger; status (including tool_calls, failed,
// cancelled, compaction) does not determine whether a request consumed tokens.
const SNAPSHOT_QUERY = `WITH message_order AS (
  SELECT m.id, m.conversation_id, m.role, m.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY m.conversation_id ORDER BY m.created_at, m.rowid
    ) AS position
  FROM chat_messages m
)
SELECT 'usage' AS kind, u.id, u.conversation_id AS sessionId,
  COALESCE((SELECT d.path FROM workspace_directories d
    WHERE d.directory_id = u.directory_id LIMIT 1), '') AS projectPath,
  u.model, u.created_at AS timestamp, '' AS role,
  u.input_tokens AS inputTokens, u.output_tokens AS outputTokens,
  u.cache_read_input_tokens AS cacheReadTokens,
  u.cache_creation_input_tokens AS cacheCreationTokens
FROM usage_records u
UNION ALL
SELECT 'message' AS kind, m.id, m.conversation_id AS sessionId,
  COALESCE((SELECT d.path FROM workspace_directories d
    WHERE d.directory_id = (SELECT u.directory_id FROM usage_records u
      WHERE u.conversation_id = m.conversation_id
      ORDER BY u.created_at, u.id LIMIT 1) LIMIT 1), '') AS projectPath,
  '' AS model, m.created_at AS timestamp, m.role,
  0 AS inputTokens, 0 AS outputTokens, 0 AS cacheReadTokens, 0 AS cacheCreationTokens
FROM message_order m
WHERE m.role IN ('user', 'assistant')
  AND EXISTS (SELECT 1 FROM usage_records u WHERE u.conversation_id = m.conversation_id)
  AND m.position > COALESCE((SELECT c.fork_message_count FROM chat_conversations c
    WHERE c.conversation_id = m.conversation_id AND c.forked_from_conversation_id != ''
    LIMIT 1), 0)
ORDER BY timestamp, kind, id`;

interface SnowAppRow {
  kind?: unknown;
  id?: unknown;
  sessionId?: unknown;
  projectPath?: unknown;
  model?: unknown;
  timestamp?: unknown;
  role?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheCreationTokens?: unknown;
}

export interface SnowAppParserOptions {
  dbPath?: string;
  queryRows?: SqliteQueryRows;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Snow App contains invalid token counts; scan deferred.");
  }
  return value;
}

function parseTimestamp(value: unknown): Date {
  const raw = text(value);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(
      raw,
    );
  if (!match)
    throw new Error("Snow App contains an invalid timestamp; scan deferred.");
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const calendar = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second),
  );
  if (
    year < 1000 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error(
      "Snow App contains an invalid calendar date; scan deferred.",
    );
  }
  // Native SQLite timestamps are localtime, NOT UTC. Explicit offsets stay intact.
  const date = new Date(raw.replace(" ", "T"));
  if (
    !Number.isFinite(date.getTime()) ||
    (!match[8] &&
      (date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute))
  ) {
    throw new Error(
      "Snow App contains an invalid local timestamp; scan deferred.",
    );
  }
  return date;
}

function projectName(value: unknown): string {
  return (
    text(value)
      .split(/[\\/]+/)
      .filter(Boolean)
      .at(-1) || "unknown"
  );
}

export class SnowAppParser implements IParser {
  readonly tool: ToolDefinition;
  private readonly dbPath: string;
  private readonly queryRows: SqliteQueryRows;

  constructor(options: SnowAppParserOptions = {}) {
    this.dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    this.queryRows = options.queryRows ?? readSqliteRowsReadonly;
    this.tool = {
      id: TOOL_ID,
      name: "Snow App",
      dataDir: dirname(this.dbPath),
    };
  }

  isInstalled(): boolean {
    try {
      return statSync(this.dbPath).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  // Intentionally no parse cache: DB mtime alone misses uncheckpointed WAL writes.
  async parse(): Promise<ParseResult> {
    if (!this.isInstalled()) return { buckets: [], sessions: [] };
    const rows = await this.queryRows<SnowAppRow>(this.dbPath, SNAPSHOT_QUERY);
    const entries: TokenUsageEntry[] = [];
    const events: SessionEvent[] = [];
    const seen = new Map<string, string>();
    for (const row of rows) {
      const id = text(row.id);
      if (!id || (row.kind !== "usage" && row.kind !== "message")) {
        throw new Error(
          "Snow App contains an invalid record identity; scan deferred.",
        );
      }
      const key = JSON.stringify([row.kind, id]);
      const signature = JSON.stringify(row);
      const previous = seen.get(key);
      if (previous !== undefined) {
        if (previous !== signature)
          throw new Error("Conflicting Snow App record IDs; scan deferred.");
        continue;
      }
      seen.set(key, signature);
      const sessionId = text(row.sessionId);
      const project = projectName(row.projectPath);
      if (row.kind === "message") {
        if (!sessionId || (row.role !== "user" && row.role !== "assistant")) {
          throw new Error(
            "Snow App contains invalid message metadata; scan deferred.",
          );
        }
        events.push({
          sessionId,
          source: TOOL_ID,
          project,
          role: row.role,
          timestamp: parseTimestamp(row.timestamp),
        });
        continue;
      }
      const input = tokenCount(row.inputTokens);
      const outputTokens = tokenCount(row.outputTokens);
      const cachedTokens = Math.min(input, tokenCount(row.cacheReadTokens));
      const cacheCreationTokens = tokenCount(row.cacheCreationTokens);
      // Match Snow App's inclusive input + output total. Cache categories must
      // fit inside input; an unknown/incompatible accounting format fails closed.
      if (
        cacheCreationTokens > input - cachedTokens ||
        !Number.isSafeInteger(input + outputTokens)
      ) {
        throw new Error(
          "Snow App cache counts exceed inclusive input; scan deferred.",
        );
      }
      if (input + outputTokens === 0) continue;
      entries.push({
        sessionId: sessionId || undefined,
        source: TOOL_ID,
        project,
        model: text(row.model) || "unknown",
        timestamp: parseTimestamp(row.timestamp),
        inputTokens: input - cachedTokens - cacheCreationTokens,
        outputTokens,
        cachedTokens,
        cacheCreationTokens,
        reasoningTokens: 0,
      });
    }
    // Missing transcripts do not erase ledger buckets or invent user messages.
    return {
      buckets: aggregateToBuckets(entries),
      sessions: extractSessions(events, entries),
    };
  }
}

registerParser(new SnowAppParser());
