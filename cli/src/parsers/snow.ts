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

const DEFAULT_SNOW_DIR = join(homedir(), ".snow");
const USAGE_DIR_NAME = "usage";
const SESSIONS_DIR_NAME = "sessions";

/**
 * Snow writes per-request token usage to JSONL records that carry no session
 * id, and keeps transcripts in a separate tree of session files. Usage records
 * are attributed to the transcript that was most likely producing them, which
 * is decided from message timestamps alone.
 *
 * Attribution is deliberately kept off the buckets. Bucket keys include the
 * project, and the server upserts without deleting, so moving a bucket between
 * projects would leave the old rows behind forever and inflate totals on every
 * re-attribution. Sessions are keyed by `sessionHash` and simply overwritten, so
 * they can absorb an approximate project without growing the remote data.
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
  compressedFrom?: unknown;
  compressedAt?: unknown;
}

interface SnowSessionWindow {
  sessionId: string;
  project: string;
  /**
   * Timestamps of assistant messages in this transcript. A usage record is
   * written after the response stream closes, so the assistant reply that
   * caused it is the closest one in time.
   */
  assistantTimes: number[];
  /** Padded match window around the whole message range. */
  start: number;
  /** Padded match window around the whole message range. */
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
 * Recursively collect Snow session files.
 *
 * `subagent/` holds a `SubAgentSessionRecord` array describing sub-agent runs
 * rather than a copy of the parent transcript. Its usage is already recorded in
 * the global usage log, so the directory is skipped to avoid double counting.
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
 * Choose the transcript that most likely produced a usage record.
 *
 * Distance is measured to the nearest assistant message, because Snow stamps a
 * usage record once the response stream closes. Ties fall back to the session id
 * so repeated syncs on different machines agree on the same assignment.
 *
 * A transcript without any assistant reply (for example an interrupted prompt)
 * is the weakest candidate, so it keeps an infinite distance and only wins when
 * no transcript with a reply overlaps the record.
 */
function findClosestWindow(
  windows: SnowSessionWindow[],
  time: number,
): SnowSessionWindow | undefined {
  let best: SnowSessionWindow | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const window of windows) {
    if (time < window.start || time > window.end) continue;

    let distance = Number.POSITIVE_INFINITY;
    for (const assistantTime of window.assistantTimes) {
      const delta = Math.abs(time - assistantTime);
      if (delta < distance) distance = delta;
    }

    if (
      best === undefined ||
      distance < bestDistance ||
      (distance === bestDistance &&
        best !== undefined &&
        window.sessionId < best.sessionId)
    ) {
      best = window;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * `basename` on POSIX does not treat a backslash as a separator, so a Windows
 * path would be returned whole. Snow always records native paths, so normalise
 * both separators before taking the last segment.
 */
function resolveProject(session: SnowSessionFile): string {
  if (typeof session.projectPath === "string" && session.projectPath) {
    const segments = session.projectPath.split(/[\\/]+/).filter(Boolean);
    return segments.at(-1) || "unknown";
  }
  return "unknown";
}

export class SnowParser implements IParser {
  readonly tool: ToolDefinition;

  constructor(private readonly snowDir = DEFAULT_SNOW_DIR) {
    this.tool = {
      id: "snow",
      name: "Snow CLI",
      dataDir: join(snowDir, USAGE_DIR_NAME),
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
      ...findJsonlFiles(join(this.snowDir, USAGE_DIR_NAME)),
      ...findSessionFiles(join(this.snowDir, SESSIONS_DIR_NAME)),
    ];
  }

  /**
   * Build session timing events plus the windows used to attribute usage
   * records. Message timestamps drive turn boundaries, so active time, session
   * duration, and message counts all come from real transcripts.
   */
  private parseSessions(): {
    events: SessionEvent[];
    windows: SnowSessionWindow[];
  } {
    const events: SessionEvent[] = [];
    const windows: SnowSessionWindow[] = [];

    for (const filePath of findSessionFiles(
      join(this.snowDir, SESSIONS_DIR_NAME),
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

      // `/compact` creates a new session that replays recent turns with their
      // timestamps rewritten to the compaction moment. Those replayed messages
      // already exist in the original transcript, so counting them again would
      // inflate message counts, active time, and user prompt hours.
      const compactedAt =
        typeof session.compressedAt === "number" ? session.compressedAt : null;
      const isCompacted = typeof session.compressedFrom === "string";

      let start = Number.POSITIVE_INFINITY;
      let end = Number.NEGATIVE_INFINITY;
      const assistantTimes: number[] = [];

      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        if (message.role !== "user" && message.role !== "assistant") continue;

        const timestamp = toTimestamp(message.timestamp);
        if (!timestamp) continue;

        const time = timestamp.getTime();
        if (isCompacted && compactedAt !== null && time <= compactedAt)
          continue;

        events.push({
          sessionId,
          source: "snow",
          project,
          timestamp,
          role: message.role,
        });

        if (message.role === "assistant") assistantTimes.push(time);
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
        assistantTimes,
        start: start - SESSION_MATCH_WINDOW_MS,
        end: end + SESSION_MATCH_WINDOW_MS,
      });
    }

    return { events, windows };
  }

  /**
   * Parse usage JSONL and attach each record to the session that was active at
   * that moment, so session rows report real token totals instead of zeros.
   *
   * The bucket project stays `unknown` on purpose; see the note on
   * `SESSION_MATCH_WINDOW_MS`.
   */
  private parseUsage(windows: SnowSessionWindow[]): TokenUsageEntry[] {
    const entries: TokenUsageEntry[] = [];

    for (const filePath of findJsonlFiles(join(this.snowDir, USAGE_DIR_NAME))) {
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

        const window = findClosestWindow(windows, timestamp.getTime());

        entries.push({
          sessionId: window?.sessionId,
          source: "snow",
          model:
            typeof record.model === "string" && record.model
              ? record.model
              : "unknown",
          project: "unknown",
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
    return existsSync(join(this.snowDir, USAGE_DIR_NAME));
  }
}

registerParser(new SnowParser());
