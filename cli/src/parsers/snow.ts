import { type Dirent, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { aggregateToBuckets } from "../domain/aggregator";
import { extractSessions } from "../domain/session-extractor";
import type {
  ParseResult,
  SessionEvent,
  TokenUsageEntry,
} from "../domain/types";
import { findJsonlFiles, readFileSafe } from "../infrastructure/fs/utils";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const DEFAULT_HOME_DIR = join(homedir(), ".snow");
const USAGE_DIR_NAME = "usage";
const SESSIONS_DIR_NAME = "sessions";

/**
 * Snow writes per-request token usage to JSONL files without a session id, and
 * keeps transcripts in a separate tree of session JSON files. Usage records are
 * therefore attributed to the session whose transcript was active at that
 * moment, using the closest surrounding transcript.
 */
const SESSION_MATCH_WINDOW_MS = 5 * 60 * 1000;

interface SnowUsageRecord {
  model?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadInputTokens?: unknown;
  cacheCreationInputTokens?: unknown;
  reasoningTokens?: unknown;
  timestamp?: unknown;
}

interface SnowSessionMessage {
  role?: unknown;
  timestamp?: unknown;
}

interface SnowSessionFile {
  id?: unknown;
  projectPath?: unknown;
  messages?: unknown;
}

interface SnowSessionWindow {
  sessionId: string;
  project: string;
  /** First user/assistant message time, used to rank attribution candidates. */
  firstMessage: number;
  /** Last user/assistant message time, used to rank attribution candidates. */
  lastMessage: number;
  /** Padded match window around the message range. */
  start: number;
  /** Padded match window around the message range. */
  end: number;
}

function toNonNegativeNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function toTimestamp(value: unknown): Date | null {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value < 100_000_000_000 ? value * 1000 : value);
}

/**
 * Recursively collect Snow session files, skipping `subagent` mirrors that
 * repeat the parent transcript under the same session id.
 */
function findSessionFiles(dir: string, results: string[] = []): string[] {
  if (!existsSync(dir)) return results;

  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "subagent") continue;
      findSessionFiles(fullPath, results);
    } else if (entry.name.endsWith(".json")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Choose the transcript that best explains a usage timestamp.
 *
 * Several Snow sessions can overlap in time, so the first match would attribute
 * tokens to an arbitrary session. Picking the smallest distance to the session
 * message range keeps attribution deterministic.
 */
function findClosestWindow(
  windows: SnowSessionWindow[],
  time: number,
): SnowSessionWindow | undefined {
  let best: SnowSessionWindow | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const window of windows) {
    if (time < window.start || time > window.end) continue;
    const distance =
      time < window.firstMessage
        ? window.firstMessage - time
        : time > window.lastMessage
          ? time - window.lastMessage
          : 0;
    if (distance < bestDistance) {
      best = window;
      bestDistance = distance;
    }
  }

  return best;
}

function resolveProject(session: SnowSessionFile): string {
  if (typeof session.projectPath === "string" && session.projectPath) {
    return basename(session.projectPath) || "unknown";
  }
  return "unknown";
}

export class SnowParser implements IParser {
  readonly tool: ToolDefinition;

  constructor(private readonly homeDir = DEFAULT_HOME_DIR) {
    this.tool = {
      id: "snow",
      name: "Snow CLI",
      dataDir: join(homeDir, USAGE_DIR_NAME),
    };
  }

  async parse(): Promise<ParseResult> {
    const { events, windows } = this.parseSessions();
    const entries = this.parseUsage(windows);

    return {
      buckets: aggregateToBuckets(entries),
      sessions: extractSessions(events, entries),
    };
  }

  listSourceFiles(): string[] {
    return [
      ...findJsonlFiles(join(this.homeDir, USAGE_DIR_NAME)),
      ...findSessionFiles(join(this.homeDir, SESSIONS_DIR_NAME)),
    ];
  }

  /**
   * Build session timing events plus the windows used to attribute usage
   * records. Message timestamps drive turn boundaries, so active time, session
   * duration, and message counts all come from real Snow transcripts.
   */
  private parseSessions(): {
    events: SessionEvent[];
    windows: SnowSessionWindow[];
  } {
    const events: SessionEvent[] = [];
    const windows: SnowSessionWindow[] = [];

    for (const filePath of findSessionFiles(
      join(this.homeDir, SESSIONS_DIR_NAME),
    )) {
      const content = readFileSafe(filePath);
      if (!content) continue;

      let session: SnowSessionFile;
      try {
        session = JSON.parse(content) as SnowSessionFile;
      } catch {
        continue;
      }

      const sessionId =
        typeof session.id === "string" && session.id
          ? session.id
          : basename(filePath, ".json");
      if (!sessionId) continue;

      const project = resolveProject(session);
      const messages = Array.isArray(session.messages)
        ? (session.messages as SnowSessionMessage[])
        : [];

      let start = Number.POSITIVE_INFINITY;
      let end = Number.NEGATIVE_INFINITY;

      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        if (message.role !== "user" && message.role !== "assistant") continue;

        const timestamp = toTimestamp(message.timestamp);
        if (!timestamp) continue;

        events.push({
          sessionId,
          source: "snow",
          project,
          timestamp,
          role: message.role,
        });

        const time = timestamp.getTime();
        if (time < start) start = time;
        if (time > end) end = time;
      }

      if (
        start === Number.POSITIVE_INFINITY ||
        end === Number.NEGATIVE_INFINITY
      )
        continue;

      windows.push({
        sessionId,
        project,
        firstMessage: start,
        lastMessage: end,
        start: start - SESSION_MATCH_WINDOW_MS,
        end: end + SESSION_MATCH_WINDOW_MS,
      });
    }

    return { events, windows };
  }

  /**
   * Parse usage JSONL and attach each record to the session that was active at
   * that moment, so session rows report real token totals instead of zeros.
   */
  private parseUsage(windows: SnowSessionWindow[]): TokenUsageEntry[] {
    const entries: TokenUsageEntry[] = [];
    const sortedWindows = [...windows];

    for (const filePath of findJsonlFiles(join(this.homeDir, USAGE_DIR_NAME))) {
      const content = readFileSafe(filePath);
      if (!content) continue;

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        let record: SnowUsageRecord;
        try {
          record = JSON.parse(line) as SnowUsageRecord;
        } catch {
          // Ignore malformed or partially written JSONL records.
          continue;
        }

        const timestamp = toTimestamp(record.timestamp);
        if (!timestamp) continue;

        const inputTokens = toNonNegativeNumber(record.inputTokens);
        const outputTokens = toNonNegativeNumber(record.outputTokens);
        const cachedTokens = toNonNegativeNumber(record.cacheReadInputTokens);
        const cacheCreationTokens = toNonNegativeNumber(
          record.cacheCreationInputTokens,
        );
        const reasoningTokens = toNonNegativeNumber(record.reasoningTokens);
        if (
          inputTokens +
            outputTokens +
            cachedTokens +
            cacheCreationTokens +
            reasoningTokens ===
          0
        )
          continue;

        const window = findClosestWindow(sortedWindows, timestamp.getTime());

        entries.push({
          sessionId: window?.sessionId,
          source: "snow",
          model:
            typeof record.model === "string" && record.model
              ? record.model
              : "unknown",
          project: window?.project ?? "unknown",
          timestamp,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedTokens,
          cacheCreationTokens,
        });
      }
    }

    return entries;
  }

  isInstalled(): boolean {
    return existsSync(join(this.homeDir, USAGE_DIR_NAME));
  }
}

registerParser(new SnowParser());
