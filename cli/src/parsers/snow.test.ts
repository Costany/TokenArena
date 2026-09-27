import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SnowParser } from "./snow";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), "tokenarena-snow-"));
  dirs.push(home);
  return home;
}

function writeUsage(home: string, day: string, lines: string[]): void {
  const dayDir = join(home, "usage", day);
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(join(dayDir, "usage-001.jsonl"), lines.join("\n"));
}

function writeSession(
  home: string,
  projectDir: string,
  day: string,
  sessionId: string,
  session: unknown,
): void {
  const dayDir = join(home, "sessions", projectDir, day);
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(join(dayDir, `${sessionId}.json`), JSON.stringify(session));
}

describe("SnowParser", () => {
  it("parses usage JSONL and ignores malformed records", async () => {
    const home = createHome();
    writeUsage(home, "2026-07-11", [
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

    const result = await new SnowParser(home).parse();

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
    const home = createHome();
    writeUsage(home, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 40,
        cacheReadInputTokens: 7,
        timestamp: "2026-07-11T13:10:00Z",
      }),
    ]);

    const result = await new SnowParser(home).parse();

    expect(result.buckets[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 7,
      cacheCreationTokens: 40,
      totalTokens: 62,
    });
  });

  it("extracts session timing, message counts and project from session files", async () => {
    const home = createHome();
    writeSession(home, "demo-project-abc123", "20260711", "session-1", {
      id: "session-1",
      projectPath: "D:\\code\\demo-project",
      messages: [
        { role: "user", timestamp: 1783785917983 },
        { role: "assistant", timestamp: 1783785927983 },
        { role: "tool", timestamp: 1783785928983 },
        { role: "assistant", timestamp: 1783785930000 },
        { role: "user", timestamp: 1783786457983 },
        { role: "assistant", timestamp: 1783786459983 },
      ],
    });
    writeUsage(home, "20260711", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 200,
        outputTokens: 40,
        cacheReadInputTokens: 10,
        timestamp: new Date(1783785925000).toISOString(),
      }),
    ]);

    const result = await new SnowParser(home).parse();

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

  it("attributes usage to the closest overlapping session", async () => {
    const home = createHome();
    writeSession(home, "project-a-1", "20260711", "session-a", {
      id: "session-a",
      projectPath: "D:\\code\\alpha",
      messages: [
        { role: "user", timestamp: 1783785917983 },
        { role: "assistant", timestamp: 1783785920000 },
      ],
    });
    writeSession(home, "project-b-2", "20260711", "session-b", {
      id: "session-b",
      projectPath: "D:\\code\\beta",
      messages: [
        { role: "user", timestamp: 1783785929000 },
        { role: "assistant", timestamp: 1783785930000 },
      ],
    });
    writeUsage(home, "20260711", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 10,
        timestamp: new Date(1783785925000).toISOString(),
      }),
    ]);

    const result = await new SnowParser(home).parse();

    // Both transcripts overlap the padded window, so the record must land on
    // whichever message range is nearest: beta is 4s away, alpha 5s away.
    const alpha = result.sessions.find((s) => s.project === "alpha");
    const beta = result.sessions.find((s) => s.project === "beta");
    expect(beta?.totalTokens).toBe(110);
    expect(alpha?.totalTokens).toBe(0);
  });

  it("skips subagent mirrors that duplicate the parent session", async () => {
    const home = createHome();
    const session = {
      id: "session-dup",
      projectPath: "D:\\code\\demo",
      messages: [{ role: "user", timestamp: 1783785917983 }],
    };
    writeSession(home, "demo-abc123", "20260711", "session-dup", session);

    const subagentDir = join(
      home,
      "sessions",
      "demo-abc123",
      "20260711",
      "subagent",
    );
    mkdirSync(subagentDir, { recursive: true });
    writeFileSync(
      join(subagentDir, "session-dup.json"),
      JSON.stringify(session),
    );

    const result = await new SnowParser(home).parse();

    expect(result.sessions).toHaveLength(1);
  });

  it("skips session files that are not valid JSON", async () => {
    const home = createHome();
    const dayDir = join(home, "sessions", "demo-abc123", "20260711");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, "broken.json"), "{not json");

    const result = await new SnowParser(home).parse();

    expect(result.sessions).toEqual([]);
    expect(result.buckets).toEqual([]);
  });

  it("lists every file the parser reads", async () => {
    const home = createHome();
    writeUsage(home, "2026-07-11", [
      JSON.stringify({
        model: "gpt-5",
        inputTokens: 5,
        outputTokens: 1,
        timestamp: "2026-07-11T13:10:00Z",
      }),
    ]);
    writeSession(home, "demo-abc123", "20260711", "session-1", {
      id: "session-1",
      projectPath: "D:\\code\\demo",
      messages: [{ role: "user", timestamp: 1783785917983 }],
    });

    const files = new SnowParser(home).listSourceFiles();

    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("usage-001.jsonl"))).toBe(true);
    expect(files.some((f) => f.endsWith("session-1.json"))).toBe(true);
  });
});
