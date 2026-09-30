import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  accountFindMany: vi.fn(),
  groupBy: vi.fn(),
  sessionAggregate: vi.fn(),
  queryRaw: vi.fn(),
  getPricingCatalog: vi.fn(),
  getArenaSummaryForProfile: vi.fn(),
  getProfileAchievementWall: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    account: { findMany: mocks.accountFindMany },
    usageBucket: { groupBy: mocks.groupBy },
    usageSession: { aggregate: mocks.sessionAggregate },
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock("@/lib/pricing/catalog", () => ({
  getPricingCatalog: mocks.getPricingCatalog,
}));
vi.mock("@/lib/achievements/queries", () => ({
  getArenaSummaryForProfile: mocks.getArenaSummaryForProfile,
}));
vi.mock("@/lib/achievements/profile-wall", () => ({
  getProfileAchievementWall: mocks.getProfileAchievementWall,
}));

import { getPublicProfilePageData } from "./queries";

function sourceRow(source: string, totalTokens: bigint | null) {
  return { source, _sum: { totalTokens } };
}

function modelRow(model: string, totalTokens: bigint) {
  return {
    model,
    _sum: {
      totalTokens,
      inputTokens: totalTokens,
      outputTokens: BigInt(0),
      reasoningTokens: BigInt(0),
      cachedTokens: BigInt(0),
      cacheCreationTokens: BigInt(0),
    },
  };
}

describe("public profile Snow tool aggregation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Example",
      username: "example",
      image: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      usagePreference: {
        bio: null,
        timezone: "UTC",
        publicProfileEnabled: true,
      },
      _count: { followers: 0, following: 0 },
    });
    mocks.accountFindMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.getPricingCatalog.mockResolvedValue(null);
    mocks.getArenaSummaryForProfile.mockResolvedValue({
      score: 0,
      level: 1,
      totalActiveDays: 0,
    });
    mocks.getProfileAchievementWall.mockResolvedValue([]);
    mocks.sessionAggregate.mockResolvedValue({
      _sum: { activeSeconds: 120 },
      _count: { _all: 2 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges before ranking and taking five, with shares based on every tool", async () => {
    const sources = [
      sourceRow("snow", BigInt(40)),
      sourceRow("snow-app", BigInt(35)),
      sourceRow("codex", BigInt(60)),
      sourceRow("claude-code", BigInt(50)),
      sourceRow("cursor", BigInt(45)),
      sourceRow("gemini", BigInt(30)),
      sourceRow("other-tool", BigInt(10)),
    ];
    mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "source"
        ? sources
        : [modelRow("snow", BigInt(150)), modelRow("snow-app", BigInt(120))],
    );

    const profile = await getPublicProfilePageData({ username: "example" });

    expect(profile?.topTools).toEqual([
      { name: "Snow", totalTokens: 75, share: 75 / 270 },
      { name: "codex", totalTokens: 60, share: 60 / 270 },
      { name: "claude-code", totalTokens: 50, share: 50 / 270 },
      { name: "cursor", totalTokens: 45, share: 45 / 270 },
      { name: "gemini", totalTokens: 30, share: 30 / 270 },
    ]);
    expect(profile?.topModels).toEqual([
      { name: "snow", totalTokens: 150, share: 150 / 270 },
      { name: "snow-app", totalTokens: 120, share: 120 / 270 },
    ]);
    expect(profile?.overview).toMatchObject({
      totalTokens: 270,
      activeSeconds: 120,
      sessions: 2,
    });
    expect(sources.map((row) => row.source)).toEqual([
      "snow",
      "snow-app",
      "codex",
      "claude-code",
      "cursor",
      "gemini",
      "other-tool",
    ]);
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ["source"],
      where: { userId: "user-1" },
      _sum: { totalTokens: true },
    });
  });

  it.each([
    "snow",
    "snow-app",
  ])("labels a lone %s source as Snow within a range", async (source) => {
    mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "source"
        ? [sourceRow(source, BigInt(20))]
        : [modelRow("model", BigInt(20))],
    );

    const profile = await getPublicProfilePageData({
      username: "example",
      range: { preset: "custom", from: "2026-09-01", to: "2026-09-02" },
    });

    expect(profile?.topTools).toEqual([
      { name: "Snow", totalTokens: 20, share: 1 },
    ]);
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ["source"],
      where: {
        userId: "user-1",
        bucketStart: {
          gte: new Date("2026-09-01T00:00:00.000Z"),
          lte: new Date("2026-09-02T23:59:59.999Z"),
        },
      },
      _sum: { totalTokens: true },
    });
  });

  it.each([
    { name: "empty", sources: [] },
    {
      name: "zero",
      sources: [sourceRow("snow", BigInt(0)), sourceRow("snow-app", null)],
    },
  ])("returns no tools for $name totals", async ({ sources }) => {
    mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "source" ? sources : [],
    );

    const profile = await getPublicProfilePageData({ username: "example" });

    expect(profile?.topTools).toEqual([]);
    expect(profile?.topModels).toEqual([]);
    expect(profile?.overview.totalTokens).toBe(0);
  });
});
