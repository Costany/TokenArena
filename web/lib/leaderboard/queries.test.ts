import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  finalizePendingLeaderboardPeriods: vi.fn().mockResolvedValue(undefined),
  getPricingCatalog: vi.fn().mockResolvedValue(null),
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    leaderboardSnapshot: { findUnique: vi.fn() },
    leaderboardSnapshotEntry: { findMany: vi.fn(), findUnique: vi.fn() },
    leaderboardUserDay: { groupBy: vi.fn() },
    usagePreference: { findUnique: vi.fn() },
    usageBucket: { groupBy: vi.fn() },
    user: { findMany: vi.fn() },
    follow: { findMany: vi.fn() },
  },
}));

vi.mock("./finalize", () => ({
  finalizePendingLeaderboardPeriods: mocks.finalizePendingLeaderboardPeriods,
}));
vi.mock("@/lib/pricing/catalog", () => ({
  getPricingCatalog: mocks.getPricingCatalog,
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { getLeaderboardPageData } from "./queries";

function snapshotEntry(userId: string, rank: number) {
  return {
    userId,
    rank,
    inputTokens: BigInt(100),
    outputTokens: BigInt(0),
    reasoningTokens: BigInt(0),
    cachedTokens: BigInt(0),
    cacheCreationTokens: BigInt(0),
    totalTokens: BigInt(100),
    estimatedCostUsd: 1,
    activeSeconds: 60,
    sessions: 1,
  };
}

describe("cost leaderboard viewer rank", () => {
  const now = new Date("2026-09-23T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.leaderboardSnapshot.findUnique.mockResolvedValue({
      id: "snapshot-1",
      generatedAt: now,
      windowStart: null,
      windowEnd: null,
    });
    mocks.prisma.leaderboardSnapshotEntry.findMany.mockResolvedValue([
      snapshotEntry("leader", 1),
    ]);
    mocks.prisma.usagePreference.findUnique.mockResolvedValue({
      publicProfileEnabled: true,
    });
    mocks.prisma.usageBucket.groupBy.mockResolvedValue([]);
    mocks.prisma.leaderboardUserDay.groupBy.mockResolvedValue([]);
    mocks.prisma.follow.findMany.mockResolvedValue([]);
    mocks.prisma.user.findMany.mockImplementation(async (query) =>
      query.where.id.in.map((id: string) => ({
        id,
        name: id,
        username: id,
        image: null,
        usagePreference: { bio: null, publicProfileEnabled: true },
        _count: { followers: 0, following: 0 },
      })),
    );
  });

  it("shows a viewer at rank 75 from the persisted top 100 snapshot", async () => {
    mocks.prisma.leaderboardSnapshotEntry.findUnique.mockResolvedValue(
      snapshotEntry("viewer", 75),
    );

    const page = await getLeaderboardPageData({
      period: "all_time",
      metric: "estimated_cost",
      viewerUserId: "viewer",
      now,
    });

    expect(page.global.entries.map((entry) => entry.userId)).toEqual([
      "leader",
    ]);
    expect(page.viewerGlobalEntry).toMatchObject({
      userId: "viewer",
      rank: 75,
      estimatedCostUsd: 1,
    });
    expect(
      mocks.prisma.leaderboardSnapshotEntry.findUnique,
    ).toHaveBeenCalledWith({
      where: {
        snapshotId_userId: { snapshotId: "snapshot-1", userId: "viewer" },
      },
    });
  });

  it("omits the standalone row beyond the cached top 100", async () => {
    mocks.prisma.leaderboardSnapshotEntry.findUnique.mockResolvedValue(null);

    const page = await getLeaderboardPageData({
      period: "all_time",
      metric: "estimated_cost",
      viewerUserId: "viewer",
      now,
    });

    expect(page.viewerGlobalEntry).toBeNull();
  });

  it("uses the board row when the viewer is already in the top 50", async () => {
    mocks.prisma.leaderboardSnapshotEntry.findMany.mockResolvedValue([
      snapshotEntry("viewer", 1),
    ]);

    const page = await getLeaderboardPageData({
      period: "all_time",
      metric: "estimated_cost",
      viewerUserId: "viewer",
      now,
    });

    expect(page.global.entries[0]).toMatchObject({
      userId: "viewer",
      isSelf: true,
    });
    expect(page.viewerGlobalEntry).toBeNull();
    expect(
      mocks.prisma.leaderboardSnapshotEntry.findUnique,
    ).not.toHaveBeenCalled();
  });

  it("does not expose a private viewer in the global board", async () => {
    mocks.prisma.usagePreference.findUnique.mockResolvedValue({
      publicProfileEnabled: false,
    });

    const page = await getLeaderboardPageData({
      period: "all_time",
      metric: "estimated_cost",
      viewerUserId: "viewer",
      now,
    });

    expect(page.viewerPublicProfileEnabled).toBe(false);
    expect(page.viewerGlobalEntry).toBeNull();
    expect(
      mocks.prisma.leaderboardSnapshotEntry.findUnique,
    ).not.toHaveBeenCalled();
  });

  it("serves the cached board without viewer-specific reads for guests", async () => {
    const page = await getLeaderboardPageData({
      period: "all_time",
      metric: "estimated_cost",
      now,
    });

    expect(page.following).toBeNull();
    expect(page.viewerGlobalEntry).toBeNull();
    expect(mocks.prisma.usagePreference.findUnique).not.toHaveBeenCalled();
    expect(
      mocks.prisma.leaderboardSnapshotEntry.findUnique,
    ).not.toHaveBeenCalled();
  });

  it.each([
    "total_tokens",
    "estimated_cost",
  ] as const)("filters private users out of a cached %s board", async (metric) => {
    mocks.prisma.leaderboardSnapshotEntry.findMany.mockResolvedValue([
      snapshotEntry("private", 1),
      snapshotEntry("leader", 2),
    ]);
    mocks.prisma.user.findMany.mockResolvedValue([
      {
        id: "private",
        usagePreference: { publicProfileEnabled: false },
      },
      {
        id: "leader",
        name: "Leader",
        username: "leader",
        image: null,
        usagePreference: { bio: null, publicProfileEnabled: true },
        _count: { followers: 0, following: 0 },
      },
    ]);

    const page = await getLeaderboardPageData({
      period: "all_time",
      metric,
      now,
    });

    expect(page.global.entries.map((entry) => entry.userId)).toEqual([
      "leader",
    ]);
    // The hidden row's place is closed up, so the board still has a #1.
    expect(page.global.entries[0]?.rank).toBe(1);
  });

  it("closes the rank gaps left by hidden users in a cached board", async () => {
    mocks.prisma.leaderboardSnapshotEntry.findMany.mockResolvedValue([
      snapshotEntry("first", 1),
      snapshotEntry("private", 2),
      snapshotEntry("third", 3),
      snapshotEntry("fourth", 4),
    ]);
    mocks.prisma.user.findMany.mockImplementation(async (query) =>
      query.where.id.in.map((id: string) => ({
        id,
        name: id,
        username: id,
        image: null,
        usagePreference: { bio: null, publicProfileEnabled: id !== "private" },
        _count: { followers: 0, following: 0 },
      })),
    );

    const page = await getLeaderboardPageData({
      period: "all_time",
      metric: "total_tokens",
      now,
    });

    expect(
      page.global.entries.map((entry) => [entry.userId, entry.rank]),
    ).toEqual([
      ["first", 1],
      ["third", 2],
      ["fourth", 3],
    ]);
  });

  it("keeps a private viewer only on their own following board", async () => {
    mocks.prisma.leaderboardSnapshotEntry.findMany.mockResolvedValue([
      snapshotEntry("viewer", 1),
    ]);
    mocks.prisma.leaderboardUserDay.groupBy.mockResolvedValue([
      { userId: "viewer", _sum: snapshotEntry("viewer", 1) },
    ]);
    mocks.prisma.usagePreference.findUnique.mockResolvedValue({
      publicProfileEnabled: false,
    });
    mocks.prisma.user.findMany.mockResolvedValue([
      {
        id: "viewer",
        name: "Viewer",
        username: "viewer",
        image: null,
        usagePreference: { bio: null, publicProfileEnabled: false },
        _count: { followers: 0, following: 0 },
      },
    ]);

    const page = await getLeaderboardPageData({
      period: "all_time",
      metric: "total_tokens",
      viewerUserId: "viewer",
      now,
    });

    expect(page.global.entries).toEqual([]);
    expect(page.viewerGlobalEntry).toBeNull();
    expect(page.following?.entries).toMatchObject([
      { userId: "viewer", isSelf: true },
    ]);
  });

  it("hides a user when an in-flight rebuild republishes their old summary", async () => {
    const snapshot = {
      id: "rebuilt",
      generatedAt: now,
      windowStart: null,
      windowEnd: null,
    };
    let entries: unknown[] = [];
    mocks.prisma.leaderboardSnapshot.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(snapshot);
    const publicUsers = new Set(["leader", "runner-up"]);
    mocks.prisma.leaderboardUserDay.groupBy.mockImplementation(async () => {
      // 聚合读完后，用户关闭公开资料并清空快照；旧聚合仍可稍后写回。
      publicUsers.delete("leader");
      return [
        { userId: "leader", _sum: snapshotEntry("leader", 1) },
        {
          userId: "runner-up",
          _sum: { ...snapshotEntry("runner-up", 2), totalTokens: BigInt(50) },
        },
      ];
    });
    mocks.prisma.user.findMany.mockImplementation(async (query) =>
      query.where.id.in.map((id: string) => ({
        id,
        name: id,
        username: id,
        image: null,
        usagePreference: {
          bio: null,
          publicProfileEnabled: publicUsers.has(id),
        },
        _count: { followers: 0, following: 0 },
      })),
    );
    const lockedReads: unknown[] = [];
    mocks.prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          // The write transaction rereads visibility under a row lock.
          $queryRaw: async (query: { sql: string; values: unknown[] }) => {
            lockedReads.push(query.sql);
            return query.values.flatMap((userId) =>
              publicUsers.has(userId as string) ? [{ userId }] : [],
            );
          },
          leaderboardSnapshot: { upsert: async () => snapshot },
          leaderboardSnapshotEntry: {
            deleteMany: async () => {
              entries = [];
            },
            createMany: async ({ data }: { data: unknown[] }) => {
              entries = data;
            },
          },
        }),
    );
    mocks.prisma.leaderboardSnapshotEntry.findMany.mockImplementation(
      async () => entries,
    );

    const first = await getLeaderboardPageData({
      period: "all_time",
      metric: "total_tokens",
      now,
    });
    const later = await getLeaderboardPageData({
      period: "all_time",
      metric: "total_tokens",
      now: new Date(now.getTime() + 60_000),
    });

    expect(lockedReads).toHaveLength(1);
    expect(lockedReads[0]).toContain("FOR SHARE");
    // The private user is not written back, and the ranks close up.
    expect(entries).toMatchObject([{ userId: "runner-up", rank: 1 }]);
    expect(
      first.global.entries.map((entry) => [entry.userId, entry.rank]),
    ).toEqual([["runner-up", 1]]);
    expect(
      later.global.entries.map((entry) => [entry.userId, entry.rank]),
    ).toEqual([["runner-up", 1]]);
  });

  it("adds a token viewer outside the cached top 50 using the SQL rank", async () => {
    mocks.prisma.leaderboardSnapshotEntry.findMany.mockResolvedValue([
      { ...snapshotEntry("leader", 1), estimatedCostUsd: 0 },
    ]);
    mocks.prisma.$queryRaw.mockResolvedValue([
      {
        rank: BigInt(75),
        inputTokens: BigInt(100),
        outputTokens: BigInt(0),
        reasoningTokens: BigInt(0),
        cachedTokens: BigInt(0),
        cacheCreationTokens: BigInt(0),
        totalTokens: BigInt(100),
        activeSeconds: BigInt(60),
        sessions: BigInt(1),
      },
    ]);

    const page = await getLeaderboardPageData({
      period: "all_time",
      metric: "total_tokens",
      viewerUserId: "viewer",
      now,
    });

    expect(page.viewerGlobalEntry).toMatchObject({
      userId: "viewer",
      rank: 75,
      totalTokens: 100,
    });
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledOnce();
  });
});
