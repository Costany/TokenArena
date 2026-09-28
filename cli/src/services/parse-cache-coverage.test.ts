import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useTempDirs } from "../testing/temp-dir";

const mocks = vi.hoisted(() => ({ home: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mocks.home };
});

const readPaths: string[] = [];

vi.mock("../infrastructure/fs/utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../infrastructure/fs/utils")>();
  return {
    ...actual,
    readFileSafe: (path: string) => {
      readPaths.push(path);
      return actual.readFileSafe(path);
    },
  };
});

const makeTempDir = useTempDirs("tokenarena-scan-");

function writeJsonl(path: string, lines: unknown[]) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n"));
}

/**
 * `listSourceFiles()` is what the parse cache fingerprints. If `parse()` reads a
 * file the list omits, a change to that file leaves the fingerprint unchanged
 * and a stale result gets replayed — and since the upload treats each tool's
 * buckets as a complete snapshot, that silently overwrites correct remote data.
 * So the list has to cover every read.
 */
describe("listSourceFiles covers everything parse reads", () => {
  beforeAll(() => {
    mocks.home = makeTempDir();
  });

  it("claude-code", async () => {
    const root = join(mocks.home, ".claude");
    const message = (id: string) => ({
      type: "assistant",
      uuid: id,
      timestamp: "2026-04-01T12:00:00.000Z",
      requestId: `req-${id}`,
      message: {
        id: `msg-${id}`,
        model: "claude-sonnet-4",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });

    mkdirSync(join(root, "projects", "-home-user-app"), { recursive: true });
    writeJsonl(join(root, "projects", "-home-user-app", "session-a.jsonl"), [
      message("a"),
    ]);
    mkdirSync(join(root, "transcripts"), { recursive: true });
    writeJsonl(join(root, "transcripts", "session-b.jsonl"), [message("b")]);
    mkdirSync(join(root, "sessions"), { recursive: true });
    writeJsonl(join(root, "sessions", "session-c.jsonl"), [message("c")]);

    await import("../parsers/claude-code");
    const { getParser } = await import("../parsers/registry");
    const parser = getParser("claude-code");
    if (!parser?.listSourceFiles) throw new Error("expected listSourceFiles");

    readPaths.length = 0;
    await parser.parse();
    const listed = new Set(parser.listSourceFiles());

    expect(readPaths.length).toBeGreaterThan(0);
    for (const path of readPaths) {
      expect(listed).toContain(path);
    }
  });

  it("codex", async () => {
    const sessions = join(mocks.home, ".codex", "sessions");
    const archived = join(mocks.home, ".codex", "archived_sessions");

    mkdirSync(sessions, { recursive: true });
    writeJsonl(join(sessions, "rollout-1.jsonl"), [
      { type: "session_meta", payload: { id: "t1", cwd: "/home/user/app" } },
    ]);
    mkdirSync(archived, { recursive: true });
    writeJsonl(join(archived, "rollout-2.jsonl"), [
      { type: "session_meta", payload: { id: "t2", cwd: "/home/user/app" } },
    ]);

    const { CodexParser } = await import("../parsers/codex");
    const parser = new CodexParser(sessions, archived);

    readPaths.length = 0;
    await parser.parse();
    const listed = new Set(parser.listSourceFiles());

    expect(readPaths.length).toBeGreaterThan(0);
    for (const path of readPaths) {
      expect(listed).toContain(path);
    }
  });

  it("snow", async () => {
    const usage = join(mocks.home, ".snow", "usage", "2026-07-11");
    const sessions = join(
      mocks.home,
      ".snow",
      "sessions",
      "demo-abc123",
      "20260711",
    );
    const subagents = join(sessions, "subagent");

    mkdirSync(usage, { recursive: true });
    writeJsonl(join(usage, "usage-001.jsonl"), [
      {
        model: "gpt-5",
        inputTokens: 10,
        outputTokens: 2,
        timestamp: "2026-07-11T13:10:00.000Z",
      },
    ]);
    mkdirSync(subagents, { recursive: true });
    writeFileSync(
      join(sessions, "session-1.json"),
      JSON.stringify({
        id: "session-1",
        projectPath: "/code/demo",
        messages: [{ role: "user", timestamp: 1783785917983 }],
      }),
    );
    // The subagent directory is skipped by the parser, so it must not appear in
    // the list either.
    const subagentRecord = join(subagents, "session-1.json");
    writeFileSync(
      subagentRecord,
      JSON.stringify([{ id: "sub-1", messages: [] }]),
    );

    const { SnowParser } = await import("../parsers/snow");
    const parser = new SnowParser(join(mocks.home, ".snow"));

    readPaths.length = 0;
    await parser.parse();
    const listed = new Set(parser.listSourceFiles());

    expect(readPaths.length).toBeGreaterThan(0);
    for (const path of readPaths) {
      expect(listed).toContain(path);
    }
    expect(listed).not.toContain(subagentRecord);
  });
});
