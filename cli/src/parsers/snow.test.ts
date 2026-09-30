import {
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSafe } from "../infrastructure/fs/utils";
import { useTempDirs } from "../testing/temp-dir";
import { logger } from "../utils/logger";
import { SnowParser } from "./snow";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});

vi.mock("../infrastructure/fs/utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../infrastructure/fs/utils")>();
  return { ...actual, readFileSafe: vi.fn(actual.readFileSafe) };
});

const makeTempDir = useTempDirs("tokenarena-snow-");

afterEach(() => vi.resetAllMocks());

const T0 = Date.parse("2026-07-11T13:10:00Z");

function createSnowDir(): string {
  return join(makeTempDir(), ".snow");
}

function writeUsage(snowDir: string, day: string, lines: string[]): void {
  const dayDir = join(snowDir, "usage", day);
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(join(dayDir, "usage-001.jsonl"), lines.join("\n"));
}

function usageLine(time: number, record: Record<string, unknown>): string {
  return JSON.stringify({
    model: "gpt-5",
    timestamp: new Date(time).toISOString(),
    ...record,
  });
}

function writeSession(
  snowDir: string,
  projectDir: string,
  day: string,
  sessionId: string,
  session: unknown,
): string {
  const dayDir = join(snowDir, "sessions", projectDir, day);
  mkdirSync(dayDir, { recursive: true });
  const filePath = join(dayDir, `${sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(session));
  return filePath;
}

function silenceWarnings() {
  return vi.spyOn(logger, "warn").mockImplementation(() => undefined);
}

describe("SnowParser", () => {
  it("isolates invalid usage records without losing valid usage", async () => {
    const snowDir = createSnowDir();
    const usage = {
      model: "gpt-5",
      inputTokens: 100,
      outputTokens: 10,
      timestamp: "2026-07-11T13:10:00Z",
    };
    writeUsage(snowDir, "2026-07-11", [
      "null",
      "[]",
      "42",
      '"text"',
      "{partial",
      JSON.stringify({ ...usage, timestamp: 1e20 }),
      JSON.stringify({ ...usage, timestamp: -1e20 }),
      // A microsecond epoch and an expanded-year string would both serialize
      // outside RFC 3339 and make the server reject the whole upload.
      JSON.stringify({ ...usage, timestamp: 1783785917983000 }),
      JSON.stringify({ ...usage, timestamp: "+058495-12-04T08:19:43.000Z" }),
      JSON.stringify({
        ...usage,
        inputTokens: { toString: 0, valueOf: 0 },
        outputTokens: 0,
      }),
      JSON.stringify(usage),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].totalTokens).toBe(110);
    expect(result.incomplete).not.toBe(true);
  });

  it.each([
    null,
    [],
    42,
    {},
    { messages: "broken" },
  ])("ignores a session document that is not a transcript: %j", async (document) => {
    const snowDir = createSnowDir();
    const warn = silenceWarnings();
    writeSession(snowDir, "demo", "20260711", "bad", document);
    writeUsage(snowDir, "2026-07-11", [usageLine(T0, { inputTokens: 100 })]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.incomplete).not.toBe(true);
    expect(result.sessions).toEqual([]);
    expect(result.buckets[0].totalTokens).toBe(100);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores out-of-range message timestamps", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "demo", "20260711", "session", {
      messages: [
        { role: "user", timestamp: 1e20 },
        { role: "assistant", timestamp: -1e20 },
        // Microseconds, seconds, and a date past the plausible window.
        { role: "user", timestamp: 1783785917983000 },
        { role: "assistant", timestamp: 4102444800 },
        { role: "assistant", timestamp: Date.UTC(2100, 0, 1) },
        { role: "user", timestamp: "2026-07-11T13:10:00Z" },
        { role: "assistant", timestamp: "2026-07-11T13:10:10Z" },
      ],
    });

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      messageCount: 2,
      durationSeconds: 10,
    });
  });

  it("skips a transcript caught mid-write without holding back usage", async () => {
    const snowDir = createSnowDir();
    const warn = silenceWarnings();
    const first = {
      id: "a",
      projectPath: "/code/a",
      messages: [
        { role: "user", timestamp: T0 - 1000 },
        { role: "assistant", timestamp: T0 },
      ],
    };
    const firstPath = writeSession(snowDir, "demo", "20260711", "a", first);
    writeSession(snowDir, "demo", "20260711", "b", {
      id: "b",
      projectPath: "/code/b",
      messages: [
        { role: "user", timestamp: T0 + 29_000 },
        { role: "assistant", timestamp: T0 + 30_000 },
      ],
    });
    writeUsage(snowDir, "2026-07-11", [
      usageLine(T0, { inputTokens: 100, outputTokens: 10 }),
    ]);
    const parser = new SnowParser(snowDir);
    const before = await parser.parse();
    expect(before.sessions.find((s) => s.project === "a")?.totalTokens).toBe(
      110,
    );

    writeFileSync(firstPath, "{");
    const during = await parser.parse();
    expect(during.incomplete).not.toBe(true);
    expect(during.buckets).toEqual(before.buckets);
    expect(during.sessions.map((s) => s.project)).toEqual(["b"]);
    // The file was just written, so this is most likely Snow still saving it.
    expect(warn).not.toHaveBeenCalled();

    writeSession(snowDir, "demo", "20260711", "a", first);
    const recovered = await parser.parse();
    expect(recovered.incomplete).not.toBe(true);
    expect(recovered.sessions).toEqual(before.sessions);
  });

  it("reports an old damaged transcript and keeps uploading usage", async () => {
    const snowDir = createSnowDir();
    const warn = silenceWarnings();
    // Snow saves transcripts with a plain writeFile, so a crash can leave one
    // truncated for good. Snow skips such a file and never rewrites it.
    const dayDir = join(snowDir, "sessions", "demo-abc123", "20260601");
    mkdirSync(dayDir, { recursive: true });
    const truncated = join(dayDir, "dead.json");
    const empty = join(dayDir, "empty.json");
    writeFileSync(truncated, '{"id":"dead","messages":[{"role":"us');
    writeFileSync(empty, "");
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(truncated, monthAgo, monthAgo);
    utimesSync(empty, monthAgo, monthAgo);
    writeUsage(snowDir, "2026-07-11", [
      usageLine(T0, { inputTokens: 100, outputTokens: 10 }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.incomplete).not.toBe(true);
    expect(result.buckets[0].totalTokens).toBe(110);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(truncated);
    expect(warn.mock.calls[0][0]).toContain("and 1 more");
  });

  it("skips an unreadable session file", async () => {
    const snowDir = createSnowDir();
    silenceWarnings();
    writeSession(snowDir, "demo", "20260711", "a", {
      messages: [{ role: "user", timestamp: T0 }],
    });
    vi.mocked(readFileSafe).mockReturnValueOnce(null);

    const result = await new SnowParser(snowDir).parse();

    expect(result.incomplete).not.toBe(true);
    expect(result.sessions).toEqual([]);
  });

  it("defers an unreadable usage file", async () => {
    const snowDir = createSnowDir();
    writeUsage(snowDir, "2026-07-11", [usageLine(T0, { inputTokens: 5 })]);
    vi.mocked(readFileSafe).mockReturnValueOnce(null);

    expect((await new SnowParser(snowDir).parse()).incomplete).toBe(true);
  });

  it("treats a usage file removed during the scan as gone", async () => {
    const snowDir = createSnowDir();
    writeUsage(snowDir, "2026-07-11", [usageLine(T0, { inputTokens: 5 })]);
    vi.mocked(readFileSafe).mockImplementationOnce((filePath) => {
      rmSync(filePath);
      return null;
    });

    expect(await new SnowParser(snowDir).parse()).toEqual({
      buckets: [],
      sessions: [],
    });
  });

  it("propagates directory read failures instead of treating them as empty scans", async () => {
    const parser = new SnowParser(createSnowDir());
    const error = Object.assign(new Error("Access denied"), { code: "EACCES" });
    vi.mocked(readdirSync).mockImplementationOnce(() => {
      throw error;
    });
    expect(() => parser.listSourceFiles()).toThrow(error);
    vi.mocked(readdirSync).mockImplementationOnce(() => {
      throw error;
    });
    await expect(parser.parse()).rejects.toThrow(error);
  });

  it("accepts a Snow directory that is a plain file", async () => {
    // POSIX reports ENOTDIR for a path below a regular file, Windows ENOENT.
    const snowDir = createSnowDir();
    mkdirSync(join(snowDir, ".."), { recursive: true });
    writeFileSync(snowDir, "");
    const parser = new SnowParser(snowDir);

    expect(parser.listSourceFiles()).toEqual([]);
    expect(await parser.parse()).toEqual({ buckets: [], sessions: [] });
    expect(parser.isInstalled()).toBe(false);

    const error = Object.assign(new Error("Not a directory"), {
      code: "ENOTDIR",
    });
    vi.mocked(readdirSync).mockImplementation(() => {
      throw error;
    });
    expect(parser.listSourceFiles()).toEqual([]);
  });

  it("skips a folder that disappears while the tree is walked", async () => {
    const snowDir = createSnowDir();
    writeUsage(snowDir, "2026-07-10", [usageLine(T0, { inputTokens: 5 })]);
    writeUsage(snowDir, "2026-07-11", [usageLine(T0, { inputTokens: 7 })]);
    const vanished = join(snowDir, "usage", "2026-07-10");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(readdirSync).mockImplementation(((
      dir: Parameters<typeof actual.readdirSync>[0],
      options: Parameters<typeof actual.readdirSync>[1],
    ) => {
      if (String(dir) === vanished) {
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }
      return actual.readdirSync(dir, options);
    }) as typeof readdirSync);

    const parser = new SnowParser(snowDir);
    const result = await parser.parse();

    expect(result.incomplete).not.toBe(true);
    expect(result.buckets[0].totalTokens).toBe(7);
    expect(parser.listSourceFiles()).toEqual([
      join(snowDir, "usage", "2026-07-11", "usage-001.jsonl"),
    ]);
  });

  it("accepts missing roots and empty usage files", async () => {
    const snowDir = createSnowDir();
    const parser = new SnowParser(snowDir);
    expect(await parser.parse()).toEqual({ buckets: [], sessions: [] });
    writeUsage(snowDir, "2026-07-11", []);
    expect(await parser.parse()).toEqual({ buckets: [], sessions: [] });
  });

  it("parses usage JSONL and ignores malformed records", async () => {
    const snowDir = createSnowDir();
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 30,
        timestamp: "2026-07-11T13:10:00Z",
      }),
      "not-json",
      JSON.stringify({
        model: "gpt-5",
        inputTokens: -1,
        outputTokens: 5,
        timestamp: "2026-07-11T13:15:00Z",
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]).toMatchObject({
      source: "snow",
      model: "gpt-5",
      inputTokens: 70,
      outputTokens: 25,
      cachedTokens: 30,
      totalTokens: 125,
    });
    expect(result.sessions).toEqual([]);
  });

  it("does not count cache reads twice for OpenAI-format usage", async () => {
    const snowDir = createSnowDir();
    // Snow logs the OpenAI `prompt_tokens`, which already includes the cached
    // prompt, next to the cached count itself.
    writeUsage(snowDir, "2026-07-11", [
      usageLine(T0, {
        inputTokens: 1000,
        cacheReadInputTokens: 800,
        outputTokens: 50,
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.buckets[0]).toMatchObject({
      inputTokens: 200,
      cachedTokens: 800,
      outputTokens: 50,
      totalTokens: 1050,
    });
  });

  it.each([
    {
      name: "a cache creation count, even zero",
      record: {
        inputTokens: 900,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 300,
        outputTokens: 10,
      },
      expected: { inputTokens: 900, cachedTokens: 300, totalTokens: 1210 },
    },
    {
      name: "a cache read larger than the input",
      record: {
        inputTokens: 20,
        cacheReadInputTokens: 3000,
        outputTokens: 10,
      },
      expected: { inputTokens: 20, cachedTokens: 3000, totalTokens: 3030 },
    },
  ])("keeps Anthropic-format input identified by $name", async ({
    record,
    expected,
  }) => {
    const snowDir = createSnowDir();
    writeUsage(snowDir, "2026-07-11", [
      usageLine(T0, { model: "claude-opus-4-6", ...record }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.buckets[0]).toMatchObject(expected);
  });

  it("reports cache creation tokens separately from input tokens", async () => {
    const snowDir = createSnowDir();
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 40,
        cacheReadInputTokens: 7,
        timestamp: "2026-07-11T13:10:00Z",
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.buckets[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 7,
      cacheCreationTokens: 40,
      totalTokens: 62,
    });
  });

  it("keeps buckets on an unknown project so bucket keys stay stable", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "demo-project-abc123", "20260711", "session-1", {
      id: "session-1",
      projectPath: "/code/demo-project",
      messages: [
        { role: "user", timestamp: 1783785917983 },
        { role: "assistant", timestamp: 1783785927983 },
      ],
    });
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 10,
        timestamp: new Date(1783785925000).toISOString(),
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    // Buckets must not inherit the guessed project: the bucket key includes it
    // and the server upserts without deleting, so a re-attributed bucket would
    // leave the previous rows on the remote forever.
    expect(result.buckets[0].project).toBe("unknown");
    // The session still reports the real project, because session metadata
    // takes its project from the transcript event rather than the bucket.
    expect(result.sessions[0].project).toBe("demo-project");
  });

  it("extracts session timing, message counts and project from session files", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "demo-project-abc123", "20260711", "session-1", {
      id: "session-1",
      projectPath: "/code/demo-project",
      messages: [
        { role: "user", timestamp: 1783785917983 },
        { role: "assistant", timestamp: 1783785927983 },
        { role: "tool", timestamp: 1783785928983 },
        { role: "assistant", timestamp: 1783785930000 },
        { role: "user", timestamp: 1783786457983 },
        { role: "assistant", timestamp: 1783786459983 },
      ],
    });
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 200,
        outputTokens: 40,
        cacheReadInputTokens: 10,
        timestamp: new Date(1783785925000).toISOString(),
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.source).toBe("snow");
    expect(session.project).toBe("demo-project");
    expect(session.messageCount).toBe(5);
    expect(session.userMessageCount).toBe(2);
    expect(session.firstMessageAt).toBe(new Date(1783785917983).toISOString());
    expect(session.lastMessageAt).toBe(new Date(1783786459983).toISOString());
    expect(session.durationSeconds).toBe(542);
    expect(session.activeSeconds).toBe(2);
    expect(session.totalTokens).toBe(240);
    expect(session.primaryModel).toBe("gpt-5");
    expect(session.userPromptHours).toHaveLength(24);
  });

  it("resolves the project name from a Windows-style project path", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "demo-abc123", "20260711", "session-win", {
      id: "session-win",
      projectPath: "D:\\code\\demo-project",
      messages: [{ role: "user", timestamp: 1783785917983 }],
    });

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions[0].project).toBe("demo-project");
  });

  it("attributes usage to the transcript with the nearest assistant reply", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "project-a-1", "20260711", "session-a", {
      id: "session-a",
      projectPath: "/code/alpha",
      messages: [
        { role: "user", timestamp: 1783785917983 },
        { role: "assistant", timestamp: 1783785920000 },
      ],
    });
    writeSession(snowDir, "project-b-2", "20260711", "session-b", {
      id: "session-b",
      projectPath: "/code/beta",
      messages: [
        { role: "user", timestamp: 1783785929000 },
        { role: "assistant", timestamp: 1783785930000 },
      ],
    });
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 10,
        timestamp: new Date(1783785921000).toISOString(),
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    // Usage is stamped once the response stream closes, so the session whose
    // assistant reply is nearest is the one that produced it: alpha is 1s away,
    // beta 9s away.
    const alpha = result.sessions.find((s) => s.project === "alpha");
    const beta = result.sessions.find((s) => s.project === "beta");
    expect(alpha?.totalTokens).toBe(110);
    expect(beta?.totalTokens).toBe(0);
  });

  it("breaks attribution ties by session id so syncs are reproducible", async () => {
    const snowDir = createSnowDir();
    // Both transcripts have an assistant reply exactly equidistant from the
    // usage timestamp, so only the session-id tie-break can decide. The winner
    // is read last and starts last, so neither the directory order nor the
    // window order can pick it by accident.
    writeSession(snowDir, "a-alpha", "20260711", "zzz-session", {
      id: "zzz-session",
      projectPath: "/code/alpha",
      messages: [
        { role: "user", timestamp: 1783785900000 },
        { role: "assistant", timestamp: 1783785910000 },
      ],
    });
    writeSession(snowDir, "z-beta", "20260711", "aaa-session", {
      id: "aaa-session",
      projectPath: "/code/beta",
      messages: [
        { role: "user", timestamp: 1783785930000 },
        { role: "assistant", timestamp: 1783785940000 },
      ],
    });
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 1000,
        outputTokens: 0,
        timestamp: new Date(1783785925000).toISOString(),
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    const alpha = result.sessions.find((s) => s.project === "alpha");
    const beta = result.sessions.find((s) => s.project === "beta");
    expect(beta?.totalTokens).toBe(1000);
    expect(alpha?.totalTokens).toBe(0);
  });

  it("prefers a transcript with a reply over one without any", async () => {
    const snowDir = createSnowDir();
    // An interrupted prompt leaves a transcript with no assistant reply. It must
    // not outrank the transcript whose reply actually produced the usage.
    writeSession(snowDir, "a-idle", "20260711", "aaa-idle", {
      id: "aaa-idle",
      projectPath: "/code/idle",
      messages: [{ role: "user", timestamp: 1783785920000 }],
    });
    writeSession(snowDir, "b-busy", "20260711", "bbb-busy", {
      id: "bbb-busy",
      projectPath: "/code/busy",
      messages: [
        { role: "user", timestamp: 1783785900000 },
        { role: "assistant", timestamp: 1783785910000 },
      ],
    });
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 10,
        timestamp: new Date(1783785921000).toISOString(),
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    const idle = result.sessions.find((s) => s.project === "idle");
    const busy = result.sessions.find((s) => s.project === "busy");
    expect(busy?.totalTokens).toBe(110);
    expect(idle?.totalTokens).toBe(0);
  });

  it("still attributes usage to a reply-less transcript when it is the only match", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "a-idle", "20260711", "aaa-idle", {
      id: "aaa-idle",
      projectPath: "/code/idle",
      messages: [{ role: "user", timestamp: 1783785920000 }],
    });
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 10,
        timestamp: new Date(1783785921000).toISOString(),
      }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions[0].totalTokens).toBe(110);
  });

  it("leaves usage unattributed outside every transcript window", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "demo-abc123", "20260711", "session-1", {
      id: "session-1",
      projectPath: "/code/demo",
      messages: [
        { role: "user", timestamp: T0 },
        { role: "assistant", timestamp: T0 + 10_000 },
      ],
    });
    writeUsage(snowDir, "2026-07-11", [
      usageLine(T0 + 10_000 + 5 * 60 * 1000, { inputTokens: 3 }),
      usageLine(T0 + 10_000 + 5 * 60 * 1000 + 1, { inputTokens: 7 }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    expect(result.buckets[0].totalTokens).toBe(10);
    expect(result.sessions[0].totalTokens).toBe(3);
  });

  it("merges a compacted transcript into the conversation it continues", async () => {
    const snowDir = createSnowDir();
    // `/compact` writes a new session that carries recent turns forward with
    // their timestamps rewritten to the compaction moment. Those turns already
    // exist in the original transcript and must not be counted twice.
    writeSession(snowDir, "demo-abc123", "20260711", "session-new", {
      id: "session-new",
      projectPath: "/code/demo",
      compressedFrom: "session-old",
      compressedAt: 1783786000000,
      messages: [
        { role: "user", timestamp: 1783785990000 },
        { role: "assistant", timestamp: 1783786000000 },
        { role: "user", timestamp: 1783786100000 },
        { role: "assistant", timestamp: 1783786105000 },
      ],
    });

    const result = await new SnowParser(snowDir).parse();

    // The original transcript was deleted, but its id still names the session.
    const [session, ...rest] = result.sessions;
    expect(rest).toEqual([]);
    expect(session.messageCount).toBe(2);
    expect(session.userMessageCount).toBe(1);
    expect(session.firstMessageAt).toBe(new Date(1783786100000).toISOString());
  });

  it("keeps the active time of a turn that Snow compacts automatically", async () => {
    const snowDir = createSnowDir();
    // Auto-compaction runs between tool rounds. The model keeps working in the
    // new transcript without a new prompt, so the turn started in the original.
    writeSession(snowDir, "demo-abc123", "20260711", "chain-1", {
      id: "chain-1",
      projectPath: "/code/demo",
      createdAt: T0 - 1000,
      messages: [
        { role: "user", timestamp: T0 },
        { role: "assistant", timestamp: T0 + 10_000 },
        { role: "tool", timestamp: T0 + 15_000 },
        { role: "assistant", timestamp: T0 + 20_000 },
      ],
    });
    const compactedAt = T0 + 30_000;
    writeSession(snowDir, "demo-abc123", "20260711", "chain-2", {
      id: "chain-2",
      projectPath: "/code/demo",
      createdAt: compactedAt - 5,
      compressedFrom: "chain-1",
      compressedAt: compactedAt,
      messages: [
        { role: "user", timestamp: compactedAt - 10 },
        { role: "assistant", timestamp: compactedAt - 10 },
        { role: "tool", timestamp: compactedAt - 10 },
        { role: "assistant", timestamp: T0 + 40_000 },
        { role: "assistant", timestamp: T0 + 600_000 },
        { role: "user", timestamp: T0 + 700_000 },
        { role: "assistant", timestamp: T0 + 710_000 },
      ],
    });
    // Compaction chains are merged even when the next link sorts first.
    writeSession(snowDir, "demo-abc123", "20260710", "chain-3", {
      id: "chain-3",
      projectPath: "/code/demo",
      compressedFrom: "chain-2",
      compressedAt: T0 + 800_000,
      messages: [
        { role: "user", timestamp: T0 + 800_000 },
        { role: "user", timestamp: T0 + 900_000 },
        { role: "assistant", timestamp: T0 + 905_000 },
      ],
    });

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      firstMessageAt: new Date(T0).toISOString(),
      lastMessageAt: new Date(T0 + 905_000).toISOString(),
      messageCount: 9,
      userMessageCount: 3,
      // 10s → 600s across the compaction, then two single-reply turns.
      activeSeconds: 590,
    });
  });

  it("counts only the new messages of a branched session", async () => {
    const snowDir = createSnowDir();
    const parentMessages = [
      { role: "user", timestamp: T0 },
      { role: "assistant", timestamp: T0 + 10_000 },
      { role: "user", timestamp: T0 + 60_000 },
      { role: "assistant", timestamp: T0 + 70_000 },
    ];
    writeSession(snowDir, "demo-abc123", "20260711", "ffff-parent", {
      id: "ffff-parent",
      projectPath: "/code/demo",
      createdAt: T0 - 1000,
      messages: parentMessages,
    });
    // `/branch` copies every message with its original timestamp into a new
    // session created at the moment of the branch. The branch id sorts first, so
    // an unfiltered copy would also win every tie for the parent's usage.
    writeSession(snowDir, "demo-abc123", "20260712", "0000-branch", {
      id: "0000-branch",
      projectPath: "/code/demo",
      createdAt: T0 + 100_000,
      branchedFrom: "ffff-parent",
      messages: [
        ...parentMessages,
        { role: "user", timestamp: T0 + 200_000 },
        { role: "assistant", timestamp: T0 + 210_000 },
      ],
    });
    writeUsage(snowDir, "2026-07-11", [
      usageLine(T0 + 10_500, { inputTokens: 1000 }),
      usageLine(T0 + 210_500, { inputTokens: 500 }),
    ]);

    const result = await new SnowParser(snowDir).parse();

    const bySessionStart = [...result.sessions].sort((left, right) =>
      left.firstMessageAt.localeCompare(right.firstMessageAt),
    );
    expect(bySessionStart).toHaveLength(2);
    expect(bySessionStart[0]).toMatchObject({
      firstMessageAt: new Date(T0).toISOString(),
      messageCount: 4,
      userMessageCount: 2,
      totalTokens: 1000,
    });
    expect(bySessionStart[1]).toMatchObject({
      firstMessageAt: new Date(T0 + 200_000).toISOString(),
      messageCount: 2,
      userMessageCount: 1,
      totalTokens: 500,
    });
  });

  it("uses only the latest copy of a session saved in several places", async () => {
    const snowDir = createSnowDir();
    const messages = [
      { role: "user", timestamp: T0 },
      { role: "assistant", timestamp: T0 + 10_000 },
      { role: "user", timestamp: T0 + 20_000 },
      { role: "assistant", timestamp: T0 + 30_000 },
      { role: "user", timestamp: T0 + 40_000 },
      { role: "assistant", timestamp: T0 + 50_000 },
    ];
    // An older copy under the previous project id, the current copy, and a
    // legacy flat copy without a project path. The current one is read second.
    writeSession(snowDir, "demo-111111", "20260711", "sess-1", {
      id: "sess-1",
      projectPath: "/code/old-name",
      updatedAt: T0 + 25_000,
      messages: messages.slice(0, 3),
    });
    writeSession(snowDir, "demo-222222", "20260711", "sess-1", {
      id: "sess-1",
      projectPath: "/code/demo",
      updatedAt: T0 + 55_000,
      messages,
    });
    writeFileSync(
      join(snowDir, "sessions", "sess-1.json"),
      JSON.stringify({
        id: "sess-1",
        updatedAt: T0 + 15_000,
        messages: messages.slice(0, 2),
      }),
    );

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      project: "demo",
      messageCount: 6,
      userMessageCount: 3,
    });
  });

  it("skips sub-agent records and image archives", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "demo-abc123", "20260711", "session-main", {
      id: "session-main",
      projectPath: "/code/demo",
      messages: [{ role: "user", timestamp: 1783785917983 }],
    });

    // `subagent/` holds SubAgentSessionRecord arrays describing sub-agent runs.
    // Their usage is already in the usage log, so even a transcript-shaped file
    // there must not become a session.
    const dayDir = join(snowDir, "sessions", "demo-abc123", "20260711");
    const subagentDir = join(dayDir, "subagent");
    mkdirSync(subagentDir, { recursive: true });
    writeFileSync(
      join(subagentDir, "session-main.json"),
      JSON.stringify([
        {
          key: "sub-1",
          sessionId: "session-main",
          messages: [{ role: "user", timestamp: 1783785919000 }],
        },
      ]),
    );
    writeFileSync(
      join(subagentDir, "sub-2.json"),
      JSON.stringify({
        id: "sub-2",
        messages: [{ role: "user", timestamp: 1783785919000 }],
      }),
    );
    const archiveDir = join(dayDir, "compressed", "session-main", "1-abc");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, "page-01-of-01.webp"), "");

    const parser = new SnowParser(snowDir);
    const result = await parser.parse();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messageCount).toBe(1);
    expect(parser.listSourceFiles()).toEqual([
      join(dayDir, "session-main.json"),
    ]);
    const walked = vi
      .mocked(readdirSync)
      .mock.calls.map(([dir]) => String(dir));
    expect(walked).not.toContain(subagentDir);
    expect(walked).not.toContain(join(dayDir, "compressed"));
  });

  it("lists the usage logs and transcripts it reads", async () => {
    const snowDir = createSnowDir();
    writeUsage(snowDir, "2026-07-11", [usageLine(T0, { inputTokens: 5 })]);
    const sessionPath = writeSession(
      snowDir,
      "demo-abc123",
      "20260711",
      "session-1",
      {
        id: "session-1",
        projectPath: "/code/demo",
        messages: [{ role: "user", timestamp: 1783785917983 }],
      },
    );

    const parser = new SnowParser(snowDir);

    expect(parser.listSourceFiles()).toEqual([
      join(snowDir, "usage", "2026-07-11", "usage-001.jsonl"),
      sessionPath,
    ]);
    expect(parser.isInstalled()).toBe(true);
  });
});
