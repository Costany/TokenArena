import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { aggregateToBuckets } from "../domain/aggregator";
import { extractSessions } from "../domain/session-extractor";
import type {
  ParseResult,
  SessionEvent,
  TokenUsageEntry,
} from "../domain/types";
import { readFileSafe } from "../infrastructure/fs/utils";
import { logger } from "../utils/logger";
import { registerParser } from "./registry";
import type { IParser, ToolDefinition } from "./types";

const DEFAULT_SNOW_DIR = join(homedir(), ".snow");
const USAGE_DIR_NAME = "usage";
const SESSIONS_DIR_NAME = "sessions";

/**
 * Directories under `sessions/` that never hold transcripts. `subagent/` keeps
 * `SubAgentSessionRecord` arrays for sub-agent runs, whose usage is already in
 * the global usage log, and `compressed/` keeps page images archived by image
 * compression.
 */
const NON_TRANSCRIPT_DIRS = new Set(["subagent", "compressed"]);

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

/**
 * Snow rewrites a transcript in place on every message, so a read can land in
 * the middle of a write. A damaged file modified this recently is most likely
 * such a write and is skipped quietly; older damage is reported.
 */
const DAMAGED_TRANSCRIPT_SETTLE_MS = 60 * 1000;

/**
 * Snow stamps messages with `Date.now()` and usage with ISO strings, so anything
 * outside this window is corrupt. Letting it through would produce timestamps
 * outside RFC 3339 or session durations beyond the server's 32-bit column, and
 * the server rejects the whole upload batch for either.
 */
const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
const MAX_TIMESTAMP_MS = Date.UTC(2080, 0, 1);

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
  createdAt?: unknown;
  updatedAt?: unknown;
  compressedFrom?: unknown;
  compressedAt?: unknown;
  branchedFrom?: unknown;
}

/** The parts of a transcript the parser needs; the document itself is dropped. */
interface SnowTranscript {
  filePath: string;
  sessionId: string;
  project: string;
  /** Last save time, used to pick the current copy of a duplicated session. */
  updatedAt: number;
  compressedFrom?: string;
  messages: { role: "user" | "assistant"; time: number }[];
}

/**
 * `damaged` is an unreadable file or one that is not JSON, left by a write that
 * is still in progress or was cut short. `foreign` is well-formed JSON that is
 * not a transcript.
 */
type TranscriptRead =
  | { status: "ok"; transcript: SnowTranscript }
  | { status: "damaged" }
  | { status: "foreign" };

interface SnowSessionWindow {
  sessionId: string;
  /**
   * Sorted timestamps of assistant messages in this transcript. A usage record
   * is written after the response stream closes, so the assistant reply that
   * caused it is the closest one in time.
   */
  assistantTimes: number[];
  /** Padded match window around the whole message range. */
  start: number;
  /** Padded match window around the whole message range. */
  end: number;
}

function toNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function toTime(value: unknown): number | null {
  const time =
    typeof value === "string"
      ? Date.parse(value)
      : typeof value === "number"
        ? value
        : Number.NaN;
  return time >= MIN_TIMESTAMP_MS && time < MAX_TIMESTAMP_MS ? time : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively collect Snow usage or session files.
 *
 * A directory that does not exist has nothing to read: Snow may never have run
 * here, or its cleanup may remove a folder while the walk is under way. Any
 * other read error propagates, so the sync layer defers the source instead of
 * treating a partial scan as complete.
 */
function findSourceFiles(
  dir: string,
  extension: ".json" | ".jsonl",
  results: string[] = [],
): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    // `~/.snow` can be a plain file on a machine that never ran Snow. POSIX
    // reports ENOTDIR for a path below it, Windows ENOENT.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return results;
    throw error;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (extension === ".json" && NON_TRANSCRIPT_DIRS.has(entry.name)) {
        continue;
      }
      findSourceFiles(fullPath, extension, results);
    } else if (entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }

  return results;
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

function readTranscript(filePath: string): TranscriptRead {
  const content = readFileSafe(filePath);
  if (content === null) return { status: "damaged" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { status: "damaged" };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    return { status: "foreign" };
  }

  const session: SnowSessionFile = parsed;
  const compressedFrom =
    typeof session.compressedFrom === "string" && session.compressedFrom
      ? session.compressedFrom
      : undefined;

  // `/compact` and `/branch` both start a new transcript from copies of earlier
  // messages. Compaction rewrites the copies' timestamps to the compaction
  // moment and a branch keeps the originals, but either way the copies are no
  // later than the new transcript's `compressedAt` or `createdAt`. They are
  // already counted in the transcript they came from.
  const copiedUntil =
    compressedFrom !== undefined || typeof session.branchedFrom === "string"
      ? Math.max(
          toTime(session.compressedAt) ?? Number.NEGATIVE_INFINITY,
          toTime(session.createdAt) ?? Number.NEGATIVE_INFINITY,
        )
      : Number.NEGATIVE_INFINITY;

  const messages: SnowTranscript["messages"] = [];
  let lastMessageAt = 0;
  for (const message of parsed.messages as SnowSessionMessage[]) {
    if (!isRecord(message)) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;

    const time = toTime(message.timestamp);
    if (time === null) continue;
    if (time > lastMessageAt) lastMessageAt = time;
    if (time <= copiedUntil) continue;

    messages.push({ role: message.role, time });
  }

  return {
    status: "ok",
    transcript: {
      filePath,
      sessionId:
        typeof session.id === "string" && session.id
          ? session.id
          : basename(filePath, ".json"),
      project: resolveProject(session),
      updatedAt: toTime(session.updatedAt) ?? lastMessageAt,
      ...(compressedFrom !== undefined ? { compressedFrom } : {}),
      messages,
    },
  };
}

/**
 * Snow always saves a session into the current project's folder and never
 * removes older copies, such as the legacy flat layout or a folder named after
 * the previous project id. Only the most recently saved copy is current.
 */
function isNewerCopy(
  candidate: SnowTranscript,
  current: SnowTranscript,
): boolean {
  if (candidate.updatedAt !== current.updatedAt) {
    return candidate.updatedAt > current.updatedAt;
  }
  if (candidate.messages.length !== current.messages.length) {
    return candidate.messages.length > current.messages.length;
  }
  return candidate.filePath < current.filePath;
}

/**
 * Compaction continues the same conversation in a new transcript, and Snow even
 * compacts automatically in the middle of a turn, carrying on without a new
 * prompt. Following `compressedFrom` back to the first transcript keeps one
 * conversation as one session, so a turn that spans a compaction keeps its
 * active time. When the source transcript is gone, its id still names the
 * conversation.
 */
function resolveConversationId(
  transcript: SnowTranscript,
  transcripts: Map<string, SnowTranscript>,
): string {
  let current = transcript;
  const visited = new Set([current.sessionId]);

  while (current.compressedFrom && !visited.has(current.compressedFrom)) {
    visited.add(current.compressedFrom);
    const source = transcripts.get(current.compressedFrom);
    if (!source) return current.compressedFrom;
    current = source;
  }

  return current.sessionId;
}

/** A damaged file that was just written, or is already gone, is not reported. */
function mayStillBeWriting(filePath: string, now: number): boolean {
  try {
    return now - statSync(filePath).mtimeMs < DAMAGED_TRANSCRIPT_SETTLE_MS;
  } catch {
    return true;
  }
}

function distanceToNearest(sortedTimes: number[], time: number): number {
  let low = 0;
  let high = sortedTimes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sortedTimes[middle] < time) low = middle + 1;
    else high = middle;
  }

  let distance = Number.POSITIVE_INFINITY;
  if (low < sortedTimes.length) distance = sortedTimes[low] - time;
  if (low > 0) distance = Math.min(distance, time - sortedTimes[low - 1]);
  return distance;
}

/**
 * Attach each usage record to the transcript that most likely produced it.
 *
 * A record can only belong to a transcript whose padded window covers it.
 * Among those, distance is measured to the nearest assistant message, because
 * Snow stamps a usage record once the response stream closes. Ties fall back to
 * the session id so repeated syncs on different machines agree on the same
 * assignment. A transcript without any assistant reply (for example an
 * interrupted prompt) keeps an infinite distance, so it only wins when no
 * transcript with a reply overlaps the record.
 *
 * Records and windows are swept in time order, so each record only looks at the
 * windows open at that moment instead of every transcript in the history.
 */
function attributeUsage(
  entries: TokenUsageEntry[],
  windows: SnowSessionWindow[],
): void {
  if (windows.length === 0) return;

  const byStart = [...windows].sort((left, right) => left.start - right.start);
  const byTime = entries
    .map((entry) => ({ entry, time: entry.timestamp.getTime() }))
    .sort((left, right) => left.time - right.time);
  const open: SnowSessionWindow[] = [];
  let nextWindow = 0;

  for (const { entry, time } of byTime) {
    while (nextWindow < byStart.length && byStart[nextWindow].start <= time) {
      open.push(byStart[nextWindow]);
      nextWindow++;
    }

    let kept = 0;
    let best: SnowSessionWindow | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const window of open) {
      if (window.end < time) continue;
      open[kept++] = window;

      const distance = distanceToNearest(window.assistantTimes, time);
      if (
        best === undefined ||
        distance < bestDistance ||
        (distance === bestDistance && window.sessionId < best.sessionId)
      ) {
        best = window;
        bestDistance = distance;
      }
    }
    open.length = kept;

    if (best) entry.sessionId = best.sessionId;
  }
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
    const usage = this.parseUsage();
    const sessions = this.parseSessions();
    attributeUsage(usage.entries, sessions.windows);

    return {
      buckets: aggregateToBuckets(usage.entries),
      sessions: extractSessions(sessions.events, usage.entries),
      ...(usage.incomplete ? { incomplete: true } : {}),
    };
  }

  listSourceFiles(): string[] {
    return [
      ...findSourceFiles(join(this.snowDir, USAGE_DIR_NAME), ".jsonl"),
      ...findSourceFiles(join(this.snowDir, SESSIONS_DIR_NAME), ".json"),
    ];
  }

  /**
   * Build session timing events plus the windows used to attribute usage
   * records. Message timestamps drive turn boundaries, so active time, session
   * duration, and message counts all come from real transcripts.
   *
   * Transcripts only feed sessions, never buckets, so a damaged one is skipped
   * rather than holding back the whole source: Snow cannot open it either and
   * will not rewrite it, so deferring would block Snow uploads for good.
   */
  private parseSessions(): {
    events: SessionEvent[];
    windows: SnowSessionWindow[];
  } {
    const transcripts = new Map<string, SnowTranscript>();
    const damaged: string[] = [];
    const now = Date.now();

    for (const filePath of findSourceFiles(
      join(this.snowDir, SESSIONS_DIR_NAME),
      ".json",
    )) {
      const read = readTranscript(filePath);
      if (read.status === "damaged") {
        if (!mayStillBeWriting(filePath, now)) damaged.push(filePath);
        continue;
      }
      if (read.status === "foreign") continue;

      const current = transcripts.get(read.transcript.sessionId);
      if (!current || isNewerCopy(read.transcript, current)) {
        transcripts.set(read.transcript.sessionId, read.transcript);
      }
    }

    if (damaged.length > 0) {
      const more = damaged.length > 1 ? ` and ${damaged.length - 1} more` : "";
      logger.warn(
        `Skipped damaged Snow session file ${damaged[0]}${more}. Token usage is still counted.`,
      );
    }

    const events: SessionEvent[] = [];
    const windows: SnowSessionWindow[] = [];

    for (const transcript of transcripts.values()) {
      if (transcript.messages.length === 0) continue;

      const sessionId = resolveConversationId(transcript, transcripts);
      const assistantTimes: number[] = [];
      let start = Number.POSITIVE_INFINITY;
      let end = Number.NEGATIVE_INFINITY;

      for (const message of transcript.messages) {
        events.push({
          sessionId,
          source: "snow",
          project: transcript.project,
          timestamp: new Date(message.time),
          role: message.role,
        });

        if (message.role === "assistant") assistantTimes.push(message.time);
        if (message.time < start) start = message.time;
        if (message.time > end) end = message.time;
      }

      windows.push({
        sessionId,
        assistantTimes: assistantTimes.sort((left, right) => left - right),
        start: start - SESSION_MATCH_WINDOW_MS,
        end: end + SESSION_MATCH_WINDOW_MS,
      });
    }

    return { events, windows };
  }

  /**
   * Parse usage JSONL. Session attribution happens afterwards, because it needs
   * the transcripts.
   *
   * The bucket project stays `unknown` on purpose; see the note on
   * `SESSION_MATCH_WINDOW_MS`.
   */
  private parseUsage(): {
    entries: TokenUsageEntry[];
    incomplete: boolean;
  } {
    const entries: TokenUsageEntry[] = [];
    let incomplete = false;

    for (const filePath of findSourceFiles(
      join(this.snowDir, USAGE_DIR_NAME),
      ".jsonl",
    )) {
      const content = readFileSafe(filePath);
      if (content === null) {
        // A log that Snow's cleanup removed after the walk is simply gone.
        // Anything else unreadable would under-count the buckets.
        if (existsSync(filePath)) incomplete = true;
        continue;
      }

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;

        let record: SnowUsageRecord;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isRecord(parsed)) continue;
          record = parsed;
        } catch {
          // Ignore malformed or partially written JSONL records.
          continue;
        }

        const time = toTime(record.timestamp);
        if (time === null) continue;

        const reportedInputTokens = toNonNegativeNumber(record.inputTokens);
        const outputTokens = toNonNegativeNumber(record.outputTokens);
        const cachedTokens = toNonNegativeNumber(record.cacheReadInputTokens);
        const cacheCreationTokens = toNonNegativeNumber(
          record.cacheCreationInputTokens,
        );
        const reasoningTokens = toNonNegativeNumber(record.reasoningTokens);

        // Snow's OpenAI Chat and Responses adapters log `prompt_tokens`, which
        // already includes the cached prompt, and log the cached part again as
        // `cacheReadInputTokens`. Only the Anthropic adapter reports input
        // without the cache, and it is also the only one that writes
        // `cacheCreationInputTokens`, even when it is zero. A cache read larger
        // than the input cannot come from the OpenAI format either.
        const inputTokens =
          record.cacheCreationInputTokens === undefined &&
          cachedTokens <= reportedInputTokens
            ? reportedInputTokens - cachedTokens
            : reportedInputTokens;

        if (
          inputTokens +
            outputTokens +
            cachedTokens +
            cacheCreationTokens +
            reasoningTokens ===
          0
        )
          continue;

        entries.push({
          source: "snow",
          model:
            typeof record.model === "string" && record.model
              ? record.model
              : "unknown",
          project: "unknown",
          timestamp: new Date(time),
          inputTokens,
          outputTokens,
          reasoningTokens,
          cachedTokens,
          cacheCreationTokens,
        });
      }
    }

    return { entries, incomplete };
  }

  isInstalled(): boolean {
    return existsSync(join(this.snowDir, USAGE_DIR_NAME));
  }
}

registerParser(new SnowParser());
