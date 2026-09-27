import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDirs } from "../testing/temp-dir";
import { SnowParser } from "./snow";

const makeTempDir = useTempDirs("tokenarena-snow-");

/**
 * Fixtures use POSIX paths on purpose: `basename` on a POSIX runner does not
 * treat a backslash as a separator, so a `D:\code\...` fixture would resolve to
 * the whole string and fail on Linux and macOS CI.
 */
function createSnowDir(): string {
  return join(makeTempDir(), ".snow");
}

function writeUsage(snowDir: string, day: string, lines: string[]): void {
  const dayDir = join(snowDir, "usage", day);
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(join(dayDir, "usage-001.jsonl"), lines.join("\n"));
}

function writeSession(
  snowDir: string,
  projectDir: string,
  day: string,
  sessionId: string,
  session: unknown,
): void {
  const dayDir = join(snowDir, "sessions", projectDir, day);
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(join(dayDir, `${sessionId}.json`), JSON.stringify(session));
}

describe("SnowParser", () => {
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
      inputTokens: 100,
      outputTokens: 25,
      cachedTokens: 30,
      totalTokens: 155,
    });
    expect(result.sessions).toEqual([]);
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
    writeSession(snowDir, "demo-project-abc123", "2026-07-11", "session-1", {
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
    writeSession(snowDir, "demo-project-abc123", "2026-07-11", "session-1", {
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
    expect(session.totalTokens).toBe(250);
    expect(session.primaryModel).toBe("gpt-5");
    expect(session.userPromptHours).toHaveLength(24);
  });

  it("resolves the project name from a Windows-style project path", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "demo-abc123", "2026-07-11", "session-win", {
      id: "session-win",
      projectPath: "D:\\code\\demo-project",
      messages: [{ role: "user", timestamp: 1783785917983 }],
    });

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions[0].project).toBe("demo-project");
  });

  it("attributes usage to the transcript with the nearest assistant reply", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "project-a-1", "2026-07-11", "session-a", {
      id: "session-a",
      projectPath: "/code/alpha",
      messages: [
        { role: "user", timestamp: 1783785917983 },
        { role: "assistant", timestamp: 1783785920000 },
      ],
    });
    writeSession(snowDir, "project-b-2", "2026-07-11", "session-b", {
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
    // usage timestamp, so only the session-id tie-break can decide.
    writeSession(snowDir, "z-alpha", "2026-07-11", "zzz-session", {
      id: "zzz-session",
      projectPath: "/code/alpha",
      messages: [
        { role: "user", timestamp: 1783785900000 },
        { role: "assistant", timestamp: 1783785910000 },
      ],
    });
    writeSession(snowDir, "a-beta", "2026-07-11", "aaa-session", {
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

    // Both distances are 15s, so the smaller session id wins regardless of the
    // order the directories happen to be read in.
    const alpha = result.sessions.find((s) => s.project === "alpha");
    const beta = result.sessions.find((s) => s.project === "beta");
    expect(beta?.totalTokens).toBe(1000);
    expect(alpha?.totalTokens).toBe(0);
  });

  it("prefers a transcript with a reply over one without any", async () => {
    const snowDir = createSnowDir();
    // An interrupted prompt leaves a transcript with no assistant reply. It must
    // not outrank the transcript whose reply actually produced the usage.
    writeSession(snowDir, "a-idle", "2026-07-11", "aaa-idle", {
      id: "aaa-idle",
      projectPath: "/code/idle",
      messages: [{ role: "user", timestamp: 1783785920000 }],
    });
    writeSession(snowDir, "b-busy", "2026-07-11", "bbb-busy", {
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
    writeSession(snowDir, "a-idle", "2026-07-11", "aaa-idle", {
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

  it("ignores replayed messages in a compacted session", async () => {
    const snowDir = createSnowDir();
    // `/compact` writes a new session that carries recent turns forward with
    // their timestamps rewritten to the compaction moment. Those turns already
    // exist in the original transcript and must not be counted twice.
    writeSession(snowDir, "demo-abc123", "2026-07-11", "session-new", {
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

    const session = result.sessions[0];
    // Only the two messages after the compaction moment survive.
    expect(session.messageCount).toBe(2);
    expect(session.userMessageCount).toBe(1);
    expect(session.firstMessageAt).toBe(new Date(1783786100000).toISOString());
  });

  it("skips subagent records, whose usage is already in the usage log", async () => {
    const snowDir = createSnowDir();
    writeSession(snowDir, "demo-abc123", "2026-07-11", "session-main", {
      id: "session-main",
      projectPath: "/code/demo",
      messages: [{ role: "user", timestamp: 1783785917983 }],
    });

    // The subagent directory holds a SubAgentSessionRecord array, not a copy
    // of the parent transcript.
    const subagentDir = join(
      snowDir,
      "sessions",
      "demo-abc123",
      "2026-07-11",
      "subagent",
    );
    mkdirSync(subagentDir, { recursive: true });
    writeFileSync(
      join(subagentDir, "session-main.json"),
      JSON.stringify([
        {
          id: "sub-1",
          messages: [{ role: "user", timestamp: 1783785919000 }],
        },
      ]),
    );

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messageCount).toBe(1);
  });

  it("skips session files that are not valid JSON", async () => {
    const snowDir = createSnowDir();
    const dayDir = join(snowDir, "sessions", "demo-abc123", "2026-07-11");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, "broken.json"), "{not json");

    const result = await new SnowParser(snowDir).parse();

    expect(result.sessions).toEqual([]);
    expect(result.buckets).toEqual([]);
  });

  it("lists every file the parser reads", async () => {
    const snowDir = createSnowDir();
    writeUsage(snowDir, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 5,
        outputTokens: 1,
        timestamp: "2026-07-11T13:10:00Z",
      }),
    ]);
    writeSession(snowDir, "demo-abc123", "2026-07-11", "session-1", {
      id: "session-1",
      projectPath: "/code/demo",
      messages: [{ role: "user", timestamp: 1783785917983 }],
    });

    const parser = new SnowParser(snowDir);
    const files = parser.listSourceFiles();

    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("usage-001.jsonl"))).toBe(true);
    expect(files.some((f) => f.endsWith("session-1.json"))).toBe(true);
    expect(parser.isInstalled()).toBe(true);
  });
});
