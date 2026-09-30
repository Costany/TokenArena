import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveFilterChips } from "@/components/usage/filter-state";

const mocks = vi.hoisted(() => ({
  buckets: vi.fn(),
  sessions: vi.fn(),
  devices: vi.fn(),
  keys: vi.fn(),
  groupBy: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    usageBucket: { findMany: mocks.buckets, groupBy: mocks.groupBy },
    usageSession: { findMany: mocks.sessions },
    device: { findMany: mocks.devices },
    usageApiKey: { findMany: mocks.keys },
  },
}));
vi.mock("@/lib/pricing/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pricing/catalog")>()),
  getPricingCatalog: mocks.catalog,
}));

import { dashboardQuerySchema } from "./contracts";
import { getPreviousRange } from "./date-range";
import { getFilterOptions, getUsageDashboardSnapshot } from "./queries";

const range = {
  from: new Date("2026-09-29T00:00:00.000Z"),
  to: new Date("2026-09-30T23:59:59.999Z"),
  granularity: "day" as const,
  preset: "custom" as const,
  timezone: "UTC",
};
function bucket(source: string, multiplier: number) {
  return {
    id: source,
    source,
    deviceId: "device",
    model: "gpt-test",
    projectKey: "project",
    projectLabel: "Project",
    bucketStart: range.from,
    inputTokens: BigInt(10 * multiplier),
    outputTokens: BigInt(20 * multiplier),
    reasoningTokens: BigInt(30 * multiplier),
    cachedTokens: BigInt(40 * multiplier),
    cacheCreationTokens: BigInt(50 * multiplier),
    totalTokens: BigInt(150 * multiplier),
  };
}
function session(source: string, multiplier: number) {
  return {
    ...bucket(source, multiplier),
    sessionHash: "same-hash",
    firstMessageAt: range.from,
    lastMessageAt: range.to,
    durationSeconds: 100 * multiplier,
    activeSeconds: 60 * multiplier,
    messageCount: 4 * multiplier,
    userMessageCount: multiplier,
    primaryModel: "gpt-test",
    estimatedCostUsd: multiplier,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.buckets.mockResolvedValue([]);
  mocks.sessions.mockResolvedValue([]);
  mocks.devices.mockResolvedValue([]);
  mocks.keys.mockResolvedValue([]);
  mocks.groupBy.mockResolvedValue([]);
  mocks.catalog.mockResolvedValue(
    new Map([
      [
        "openai",
        {
          id: "openai",
          name: "OpenAI",
          modelsByLower: new Map([
            [
              "gpt-test",
              {
                id: "gpt-test",
                name: "Test",
                cost: {
                  input: 1,
                  output: 2,
                  reasoning: 3,
                  cache_read: 4,
                  cache_write: 5,
                },
              },
            ],
          ]),
        },
      ],
    ]),
  );
});

describe("Snow dashboard read integration", () => {
  it("adds coincident ledgers without dropping sessions or changing other dimensions", async () => {
    const buckets = [
      bucket("snow", 1),
      bucket("snow-app", 2),
      bucket("codex", 4),
    ];
    const sessions = [
      session("snow", 1),
      session("snow-app", 2),
      session("codex", 4),
    ];
    mocks.buckets.mockResolvedValueOnce(buckets).mockResolvedValueOnce([]);
    mocks.sessions
      .mockResolvedValueOnce(sessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(sessions);
    const result = await getUsageDashboardSnapshot({
      userId: "user",
      range,
      filters: {},
    });
    const snow = result.breakdowns.tools.find((row) => row.key === "snow");
    expect(snow).toMatchObject({
      name: "Snow",
      totalTokens: 450,
      inputTokens: 30,
      outputTokens: 60,
      reasoningTokens: 90,
      cachedTokens: 120,
      cacheCreationTokens: 150,
      sessions: 2,
      totalSeconds: 300,
      activeSeconds: 180,
      messages: 12,
      userMessages: 3,
      share: 3 / 7,
    });
    expect(snow?.estimatedCostUsd).toBeCloseTo(0.00165);
    expect(
      result.breakdowns.tools.find((row) => row.key === "codex"),
    ).toMatchObject({ name: "codex", totalTokens: 600, sessions: 1 });
    expect(
      result.sessions.map((row) => [row.id, row.source, row.sessionHash]),
    ).toEqual(sessions.map((row) => [row.id, row.source, "same-hash"]));
    expect(result.overview.sessions.current).toBe(3);
    expect(result.overview.totalTokens.current).toBe(1050);
    for (const rows of [
      result.breakdowns.devices,
      result.breakdowns.tools,
      result.breakdowns.models,
      result.breakdowns.projects,
    ]) {
      for (const key of [
        "inputTokens",
        "outputTokens",
        "reasoningTokens",
        "cachedTokens",
        "cacheCreationTokens",
        "totalTokens",
      ] as const) {
        expect(rows.reduce((sum, row) => sum + row[key], 0)).toBe(
          result.overview[key].current,
        );
      }
      expect(
        rows.reduce((sum, row) => sum + row.estimatedCostUsd, 0),
      ).toBeCloseTo(result.pricingSummary.currentUsd);
    }
    for (const rows of [
      result.breakdowns.devices,
      result.breakdowns.tools,
      result.breakdowns.projects,
      result.activityTrend,
    ]) {
      expect(rows.reduce((sum, row) => sum + row.totalSeconds, 0)).toBe(700);
      expect(rows.reduce((sum, row) => sum + row.activeSeconds, 0)).toBe(420);
      expect(rows.reduce((sum, row) => sum + row.sessions, 0)).toBe(3);
    }
    expect(
      result.tokenTrend.reduce((sum, row) => sum + row.estimatedCostUsd, 0),
    ).toBeCloseTo(0.00385);
    expect(
      result.tokenTrend.reduce((sum, row) => sum + row.totalSeconds, 0),
    ).toBe(700);
    const pricing = result.modelPricingRows[0];
    expect(
      (pricing.estimatedInputUsd ?? 0) +
        (pricing.estimatedOutputUsd ?? 0) +
        (pricing.estimatedReasoningUsd ?? 0) +
        (pricing.estimatedCacheUsd ?? 0) +
        (pricing.estimatedCacheCreationUsd ?? 0),
    ).toBeCloseTo(result.pricingSummary.currentUsd);
    expect(buckets.map((row) => row.source)).toEqual([
      "snow",
      "snow-app",
      "codex",
    ]);
  });

  it.each([
    "snow",
    "snow-app",
    "codex",
  ])("preserves every constraint for %s across current, previous and recent reads", async (source) => {
    const filters = {
      source,
      apiKeyId: "key",
      deviceId: "device",
      model: "gpt-test",
      projectKey: "project",
    };
    await getUsageDashboardSnapshot({ userId: "user", range, filters });
    const common = {
      userId: "user",
      apiKeyId: "key",
      deviceId: "device",
      projectKey: "project",
      source: source === "codex" ? "codex" : { in: ["snow", "snow-app"] },
    };
    const previous = getPreviousRange(range);
    expect(mocks.buckets).toHaveBeenCalledTimes(2);
    expect(mocks.sessions).toHaveBeenCalledTimes(3);
    for (const [index, window] of [range, previous].entries()) {
      expect(mocks.buckets.mock.calls[index][0].where).toEqual({
        ...common,
        model: "gpt-test",
        bucketStart: { gte: window.from, lte: window.to },
      });
      // Existing contract: sessions have no model column; model only constrains buckets.
      expect(mocks.sessions.mock.calls[index][0].where).toEqual({
        ...common,
        firstMessageAt: { gte: window.from, lte: window.to },
      });
    }
    expect(mocks.sessions.mock.calls[2][0].where).toEqual({
      ...common,
      firstMessageAt: { gte: range.from, lte: range.to },
    });
    expect(filters.source).toBe(source);
  });

  it.each([
    ["snow-app"],
    ["snow", "snow-app"],
  ])("deduplicates filter options and resolves the legacy URL: %j", async (...sources) => {
    mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === "source" ? sources.map((source) => ({ source })) : [],
    );
    const options = await getFilterOptions("user");
    expect(options.sources).toEqual([{ value: "snow", label: "Snow" }]);
    const query = dashboardQuerySchema.parse(
      Object.fromEntries(new URLSearchParams("source=snow-app")),
    );
    expect(getActiveFilterChips(query, options).visible).toEqual([
      { key: "source", value: "snow", label: "Snow" },
    ]);
    for (const [args] of mocks.groupBy.mock.calls)
      expect(args.where).toEqual({ userId: "user" });
  });
});
