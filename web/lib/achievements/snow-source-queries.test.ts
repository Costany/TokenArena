import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep these tests on the pure metrics path: no real database or synchronization.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/leaderboard/finalize", () => ({
  finalizePendingLeaderboardPeriods: vi.fn(),
}));
vi.mock("@/lib/leaderboard/rank", () => ({
  getUserGlobalLeaderboardRanksByTotalTokens: vi.fn(),
}));
vi.mock("@/lib/pricing/catalog", () => ({ getPricingCatalog: vi.fn() }));
vi.mock("@/lib/usage/preferences", () => ({ getUsagePreference: vi.fn() }));

import { buildAchievementStatuses } from "./evaluate";
import { buildAllTimeMetrics } from "./queries";

type MetricsInput = Parameters<typeof buildAllTimeMetrics>[0];

function bucket(source: string, at: string): MetricsInput["buckets"][number] {
  return {
    source,
    bucketStart: new Date(at),
    totalTokens: BigInt(100),
    inputTokens: BigInt(100),
    outputTokens: BigInt(0),
    reasoningTokens: BigInt(0),
    cachedTokens: BigInt(0),
    cacheCreationTokens: BigInt(0),
    model: source,
    projectKey: source,
    deviceId: source,
  };
}

function metricsFor(buckets: MetricsInput["buckets"]) {
  return buildAllTimeMetrics({
    timezone: "UTC",
    buckets,
    sessions: [],
    following: [],
    followers: [],
    publicProfileEnabled: false,
    publicProfileUpdatedAt: null,
    catalog: null,
  });
}

describe("achievement Snow tool metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["snow", "snow-app"],
    ["snow-app", "snow"],
  ])("uses the earliest %s/%s timestamp even with unsorted buckets", (early, late) => {
    const firstAt = "2026-09-01T00:00:00.000Z";
    const secondAt = "2026-09-02T00:00:00.000Z";
    const thirdAt = "2026-09-03T00:00:00.000Z";
    const buckets = [
      bucket(late, thirdAt),
      bucket("codex", secondAt),
      bucket(early, firstAt),
    ];
    const originalSources = buckets.map((row) => row.source);

    const metrics = metricsFor(buckets);

    expect(metrics.toolTimeline).toEqual([
      { key: "snow", at: firstAt },
      { key: "codex", at: secondAt },
    ]);
    expect(metrics.modelTimeline).toHaveLength(3);
    expect(metrics.projectTimeline).toHaveLength(3);
    expect(metrics.deviceTimeline).toHaveLength(3);
    expect(metrics.totalTokens).toBe(300);
    expect(metrics.tokenTimeline).toEqual([
      { at: firstAt, value: 100 },
      { at: secondAt, value: 100 },
      { at: thirdAt, value: 100 },
    ]);
    expect(buckets.map((row) => row.source)).toEqual(originalSources);
    const toolStatus = buildAchievementStatuses(metrics).find(
      (status) => status.code === "tools_2",
    );
    expect(toolStatus).toMatchObject({
      progress: { current: 2 },
      unlockedAt: null,
    });
  });

  it("does not unlock the three-tool achievement until a third canonical tool appears", () => {
    const thirdToolAt = "2026-09-04T00:00:00.000Z";
    const metrics = metricsFor([
      bucket("snow-app", "2026-09-01T00:00:00.000Z"),
      bucket("snow", "2026-09-02T00:00:00.000Z"),
      bucket("codex", "2026-09-03T00:00:00.000Z"),
      bucket("claude-code", thirdToolAt),
    ]);

    expect(metrics.toolTimeline).toHaveLength(3);
    expect(
      buildAchievementStatuses(metrics).find(
        (status) => status.code === "tools_2",
      ),
    ).toMatchObject({ progress: { current: 3 }, unlockedAt: thirdToolAt });
  });

  it.each(["snow", "snow-app"])("counts repeated %s buckets once", (source) => {
    const at = "2026-09-01T00:00:00.000Z";
    const metrics = metricsFor([bucket(source, at), bucket(source, at)]);

    expect(metrics.toolTimeline).toEqual([{ key: "snow", at }]);
    expect(metrics.totalTokens).toBe(200);
  });

  it("keeps an empty history empty", () => {
    const metrics = metricsFor([]);

    expect(metrics.toolTimeline).toEqual([]);
    expect(metrics.totalTokens).toBe(0);
  });
});
