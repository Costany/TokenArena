import "server-only";

import { getPricingCatalog } from "@/lib/pricing/catalog";
import {
  estimateCostUsd,
  resolveOfficialPricingMatch,
} from "@/lib/pricing/resolve";
import { prisma } from "@/lib/prisma";
import type { FollowTagFilter } from "@/lib/social/follow-tags";
import { tokenCountToBigInt, tokenCountToNumber } from "@/lib/token-counts";
import { Prisma } from "../../generated/prisma/client";
import { resolveLeaderboardWindow, sameLeaderboardWindow } from "./date";
import { finalizePendingLeaderboardPeriods } from "./finalize";
import { LEADERBOARD_SNAPSHOT_TTL_MS } from "./snapshot";
import type {
  LeaderboardDataset,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardPageData,
  LeaderboardPeriod,
  LeaderboardWindow,
} from "./types";

const LEADERBOARD_PAGE_LIMIT = 50;
const LEADERBOARD_SNAPSHOT_LIMIT = 100;

/** The board metric and the persisted snapshot metric share their names. */
function toSnapshotMetric(metric: LeaderboardMetric) {
  return metric === "estimated_cost"
    ? ("estimated_cost" as const)
    : ("total_tokens" as const);
}

const leaderboardUserSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  usagePreference: {
    select: {
      bio: true,
      publicProfileEnabled: true,
    },
  },
  _count: {
    select: {
      followers: true,
      following: true,
    },
  },
} as const;

type LeaderboardEntrySummary = {
  rank: number;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  activeSeconds: number;
  sessions: number;
};

type LeaderboardUserUsageAggregate = Omit<
  LeaderboardEntrySummary,
  "rank" | "activeSeconds" | "sessions"
>;

type UsageBucketCostGroupRow = {
  userId: string;
  model: string;
  _sum: {
    inputTokens: number | bigint | null;
    outputTokens: number | bigint | null;
    reasoningTokens: number | bigint | null;
    cachedTokens: number | bigint | null;
    cacheCreationTokens: number | bigint | null;
    totalTokens: number | bigint | null;
  };
};

type RelationFlags = {
  isFollowing: boolean;
  followsYou: boolean;
};

function coerceInt(value: number | null | undefined) {
  return value ?? 0;
}

function buildWindowWhere(window: LeaderboardWindow) {
  if (!window.start || !window.end) {
    return {};
  }

  return {
    statDate: {
      gte: window.start,
      lt: window.end,
    },
  };
}

function buildBucketWindowWhere(window: LeaderboardWindow) {
  if (!window.start || !window.end) {
    return {};
  }

  return {
    bucketStart: {
      gte: window.start,
      lt: window.end,
    },
  };
}

function toDataset(input: {
  scope: LeaderboardDataset["scope"];
  period: LeaderboardPeriod;
  generatedAt: Date | null;
  window: LeaderboardWindow;
  entries: LeaderboardEntry[];
}): LeaderboardDataset {
  return {
    scope: input.scope,
    period: input.period,
    generatedAt: input.generatedAt?.toISOString() ?? null,
    windowStart: input.window.start?.toISOString() ?? null,
    windowEnd: input.window.end?.toISOString() ?? null,
    entries: input.entries,
  };
}

function mapRelationFlags(
  ids: string[],
  direct: Array<{ followingId: string }>,
  reverse: Array<{ followerId: string }>,
) {
  const followingIds = new Set(direct.map((record) => record.followingId));
  const followerIds = new Set(reverse.map((record) => record.followerId));

  return new Map<string, RelationFlags>(
    ids.map((id) => [
      id,
      {
        isFollowing: followingIds.has(id),
        followsYou: followerIds.has(id),
      },
    ]),
  );
}

async function getRelationMap(
  viewerUserId: string | null | undefined,
  ids: string[],
) {
  if (!viewerUserId || ids.length === 0) {
    return new Map<string, RelationFlags>();
  }

  const [following, followers] = await Promise.all([
    prisma.follow.findMany({
      where: {
        followerId: viewerUserId,
        followingId: {
          in: ids,
        },
      },
      select: {
        followingId: true,
      },
    }),
    prisma.follow.findMany({
      where: {
        followerId: {
          in: ids,
        },
        followingId: viewerUserId,
      },
      select: {
        followerId: true,
      },
    }),
  ]);

  return mapRelationFlags(ids, following, followers);
}

async function getFollowingNetworkIds(
  viewerUserId: string,
  followTag: FollowTagFilter,
) {
  const following = await prisma.follow.findMany({
    where: {
      followerId: viewerUserId,
      ...(followTag === "all"
        ? {}
        : {
            tag: followTag,
          }),
    },
    select: {
      followingId: true,
    },
  });

  return Array.from(
    new Set([viewerUserId, ...following.map((row) => row.followingId)]),
  );
}

function estimateGroupedRowCostUsd(
  row: UsageBucketCostGroupRow,
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
) {
  const match = resolveOfficialPricingMatch(catalog, row.model);
  const estimate = estimateCostUsd(
    {
      inputTokens: tokenCountToNumber(row._sum.inputTokens),
      outputTokens: tokenCountToNumber(row._sum.outputTokens),
      reasoningTokens: tokenCountToNumber(row._sum.reasoningTokens),
      cachedTokens: tokenCountToNumber(row._sum.cachedTokens),
      cacheCreationTokens: tokenCountToNumber(row._sum.cacheCreationTokens),
    },
    match?.cost,
  );

  return estimate?.totalUsd ?? 0;
}

function buildUserUsageAggregates(
  rows: UsageBucketCostGroupRow[],
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
) {
  const aggregates = new Map<string, LeaderboardUserUsageAggregate>();

  for (const row of rows) {
    const current = aggregates.get(row.userId) ?? {
      userId: row.userId,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };

    current.inputTokens += tokenCountToNumber(row._sum.inputTokens);
    current.outputTokens += tokenCountToNumber(row._sum.outputTokens);
    current.reasoningTokens += tokenCountToNumber(row._sum.reasoningTokens);
    current.cachedTokens += tokenCountToNumber(row._sum.cachedTokens);
    current.cacheCreationTokens += tokenCountToNumber(
      row._sum.cacheCreationTokens,
    );
    current.totalTokens += tokenCountToNumber(row._sum.totalTokens);
    current.estimatedCostUsd += estimateGroupedRowCostUsd(row, catalog);

    aggregates.set(row.userId, current);
  }

  return aggregates;
}

function hasMetricValue(
  summary: Pick<LeaderboardEntrySummary, "estimatedCostUsd" | "totalTokens">,
  metric: LeaderboardMetric,
) {
  return metric === "estimated_cost"
    ? summary.estimatedCostUsd > 0
    : summary.totalTokens > 0;
}

function compareLeaderboardSummaries(
  left: Pick<
    LeaderboardEntrySummary,
    "estimatedCostUsd" | "totalTokens" | "userId"
  >,
  right: Pick<
    LeaderboardEntrySummary,
    "estimatedCostUsd" | "totalTokens" | "userId"
  >,
  metric: LeaderboardMetric,
) {
  const metricDiff =
    metric === "estimated_cost"
      ? right.estimatedCostUsd - left.estimatedCostUsd
      : right.totalTokens - left.totalTokens;

  if (metricDiff !== 0) {
    return metricDiff;
  }

  if (right.totalTokens !== left.totalTokens) {
    return right.totalTokens - left.totalTokens;
  }

  return left.userId.localeCompare(right.userId);
}

function rankLeaderboardSummaries(
  summaries: LeaderboardEntrySummary[],
  metric: LeaderboardMetric,
  limit: number,
) {
  return summaries
    .filter((summary) => hasMetricValue(summary, metric))
    .sort((left, right) => compareLeaderboardSummaries(left, right, metric))
    .slice(0, limit)
    .map((summary, index) => ({
      ...summary,
      rank: index + 1,
    }));
}

async function getEstimatedCostMapForUsers(
  userIds: string[],
  window: LeaderboardWindow,
) {
  if (userIds.length === 0) {
    return new Map<string, number>();
  }

  const [catalog, rows] = await Promise.all([
    getPricingCatalog(),
    prisma.usageBucket.groupBy({
      by: ["userId", "model"],
      where: {
        userId: {
          in: userIds,
        },
        ...buildBucketWindowWhere(window),
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        cachedTokens: true,
        cacheCreationTokens: true,
        totalTokens: true,
      },
    }),
  ]);

  return new Map(
    Array.from(buildUserUsageAggregates(rows, catalog).values()).map((row) => [
      row.userId,
      row.estimatedCostUsd,
    ]),
  );
}

async function getLeaderboardDayStatsMap(
  userIds: string[],
  window: LeaderboardWindow,
) {
  if (userIds.length === 0) {
    return new Map<
      string,
      Pick<LeaderboardEntrySummary, "activeSeconds" | "sessions">
    >();
  }

  const rows = await prisma.leaderboardUserDay.groupBy({
    by: ["userId"],
    where: {
      userId: {
        in: userIds,
      },
      ...buildWindowWhere(window),
    },
    _sum: {
      activeSeconds: true,
      sessions: true,
    },
  });

  return new Map(
    rows.map((row) => [
      row.userId,
      {
        activeSeconds: coerceInt(row._sum.activeSeconds),
        sessions: coerceInt(row._sum.sessions),
      },
    ]),
  );
}

function rankSummaries(
  aggregates: Iterable<LeaderboardUserUsageAggregate>,
  statsMap: Map<
    string,
    Pick<LeaderboardEntrySummary, "activeSeconds" | "sessions">
  >,
  metric: LeaderboardMetric,
  limit: number,
) {
  const summaries = Array.from(aggregates).map((aggregate) => ({
    rank: 0,
    userId: aggregate.userId,
    inputTokens: aggregate.inputTokens,
    outputTokens: aggregate.outputTokens,
    reasoningTokens: aggregate.reasoningTokens,
    cachedTokens: aggregate.cachedTokens,
    cacheCreationTokens: aggregate.cacheCreationTokens ?? 0,
    totalTokens: aggregate.totalTokens,
    estimatedCostUsd: aggregate.estimatedCostUsd,
    activeSeconds: statsMap.get(aggregate.userId)?.activeSeconds ?? 0,
    sessions: statsMap.get(aggregate.userId)?.sessions ?? 0,
  }));

  return rankLeaderboardSummaries(summaries, metric, limit);
}

async function hydrateEntries(
  summaries: LeaderboardEntrySummary[],
  window: LeaderboardWindow,
  viewerUserId?: string | null,
  scope: LeaderboardDataset["scope"] = "global",
) {
  if (summaries.length === 0) {
    return [];
  }

  const ids = summaries.map((entry) => entry.userId);
  const needsEstimatedCost = summaries.every(
    (summary) => summary.estimatedCostUsd === 0,
  );
  const [users, relationMap, estimatedCostMap] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: leaderboardUserSelect,
    }),
    getRelationMap(viewerUserId, ids),
    needsEstimatedCost
      ? getEstimatedCostMapForUsers(ids, window)
      : Promise.resolve(new Map<string, number>()),
  ]);

  const userMap = new Map(users.map((user) => [user.id, user]));
  const entries: LeaderboardEntry[] = [];
  let hiddenAbove = 0;

  for (const summary of summaries) {
    const user = userMap.get(summary.userId);

    // 快照读出之后用户可能刚关闭公开资料，输出时复核权限。
    // 私密用户仍可在自己的关注榜看到自己。
    // 隐藏的行之后的名次顺延补上，榜单不留空号，第一名也始终存在。
    if (
      !user ||
      (!user.usagePreference?.publicProfileEnabled &&
        !(scope === "following" && user.id === viewerUserId))
    ) {
      hiddenAbove++;
      continue;
    }

    const flags = relationMap.get(summary.userId) ?? {
      isFollowing: false,
      followsYou: false,
    };

    entries.push({
      rank: summary.rank - hiddenAbove,
      userId: user.id,
      name: user.name,
      username: user.username,
      image: user.image,
      bio: user.usagePreference?.bio ?? null,
      estimatedCostUsd:
        summary.estimatedCostUsd > 0
          ? summary.estimatedCostUsd
          : (estimatedCostMap.get(summary.userId) ?? 0),
      totalTokens: summary.totalTokens,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      reasoningTokens: summary.reasoningTokens,
      cachedTokens: summary.cachedTokens,
      cacheCreationTokens: summary.cacheCreationTokens ?? 0,
      activeSeconds: summary.activeSeconds,
      sessions: summary.sessions,
      followerCount: user._count.followers,
      followingCount: user._count.following,
      isSelf: viewerUserId === user.id,
      isFollowing: flags.isFollowing,
      followsYou: flags.followsYou,
    });
  }

  return entries;
}

function isSnapshotFresh(input: {
  generatedAt: Date;
  snapshotWindow: LeaderboardWindow;
  requestedWindow: LeaderboardWindow;
  now: Date;
}) {
  return (
    sameLeaderboardWindow(input.snapshotWindow, input.requestedWindow) &&
    input.now.getTime() - input.generatedAt.getTime() <
      LEADERBOARD_SNAPSHOT_TTL_MS
  );
}

/**
 * Top `limit` entries for a board, computed from scratch.
 *
 * The token board pushes the ordering and the limit into the database. The cost
 * board cannot: ranking needs the pricing catalog to turn per-model tokens into
 * dollars, which only exists in the application, so it aggregates the window
 * and ranks in memory. That is exactly why the cost board must be cached — see
 * `ensureGlobalSnapshot`.
 */
async function computeGlobalSummaries(input: {
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  now: Date;
  limit: number;
}): Promise<{
  window: LeaderboardWindow;
  summaries: LeaderboardEntrySummary[];
}> {
  const window = resolveLeaderboardWindow(input.period, input.now);

  if (input.metric === "estimated_cost") {
    const [catalog, groupedRows] = await Promise.all([
      getPricingCatalog(),
      prisma.usageBucket.groupBy({
        by: ["userId", "model"],
        where: {
          ...buildBucketWindowWhere(window),
          user: {
            usagePreference: {
              is: {
                publicProfileEnabled: true,
              },
            },
          },
        },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          cacheCreationTokens: true,
          totalTokens: true,
        },
      }),
    ]);

    const aggregates = buildUserUsageAggregates(groupedRows, catalog);
    const statsMap = await getLeaderboardDayStatsMap(
      Array.from(aggregates.keys()),
      window,
    );

    return {
      window,
      summaries: rankSummaries(
        aggregates.values(),
        statsMap,
        "estimated_cost",
        input.limit,
      ),
    };
  }

  const rows = await prisma.leaderboardUserDay.groupBy({
    by: ["userId"],
    where: {
      ...buildWindowWhere(window),
      user: {
        usagePreference: {
          is: {
            publicProfileEnabled: true,
          },
        },
      },
    },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      reasoningTokens: true,
      cachedTokens: true,
      cacheCreationTokens: true,
      totalTokens: true,
      activeSeconds: true,
      sessions: true,
    },
    orderBy: [
      {
        _sum: {
          totalTokens: "desc",
        },
      },
      {
        userId: "asc",
      },
    ],
    take: input.limit,
  });

  const summaries = rows.reduce<LeaderboardEntrySummary[]>(
    (acc, row, index) => {
      const totalTokens = tokenCountToNumber(row._sum.totalTokens);
      if (totalTokens > 0) {
        acc.push({
          rank: index + 1,
          userId: row.userId,
          inputTokens: tokenCountToNumber(row._sum.inputTokens),
          outputTokens: tokenCountToNumber(row._sum.outputTokens),
          reasoningTokens: tokenCountToNumber(row._sum.reasoningTokens),
          cachedTokens: tokenCountToNumber(row._sum.cachedTokens),
          cacheCreationTokens: tokenCountToNumber(row._sum.cacheCreationTokens),
          totalTokens,
          estimatedCostUsd: 0,
          activeSeconds: coerceInt(row._sum.activeSeconds),
          sessions: coerceInt(row._sum.sessions),
        });
      }
      return acc;
    },
    [],
  );

  return { window, summaries };
}

function snapshotEntryToSummary(row: {
  rank: number;
  userId: string;
  inputTokens: bigint;
  outputTokens: bigint;
  reasoningTokens: bigint;
  cachedTokens: bigint;
  cacheCreationTokens: bigint;
  totalTokens: bigint;
  estimatedCostUsd: number;
  activeSeconds: number;
  sessions: number;
}): LeaderboardEntrySummary {
  return {
    rank: row.rank,
    userId: row.userId,
    inputTokens: tokenCountToNumber(row.inputTokens),
    outputTokens: tokenCountToNumber(row.outputTokens),
    reasoningTokens: tokenCountToNumber(row.reasoningTokens),
    cachedTokens: tokenCountToNumber(row.cachedTokens),
    cacheCreationTokens: tokenCountToNumber(row.cacheCreationTokens),
    totalTokens: tokenCountToNumber(row.totalTokens),
    estimatedCostUsd: row.estimatedCostUsd,
    activeSeconds: row.activeSeconds,
    sessions: row.sessions,
  };
}

/**
 * Drop users who made their profile private after the summaries were read, and
 * close the gaps they leave in the ranks.
 *
 * The summaries are computed outside the write transaction, so a visibility
 * change in between would otherwise be written into a fresh snapshot and served
 * until it expires. Locking the preference rows makes `updateUsagePreference`
 * either commit first, so its change is seen here, or wait until this snapshot
 * is written and then expire it. The lock has to come before the transaction
 * touches the snapshot, because the preference update deletes snapshots while
 * holding its row lock; taking them in the other order would deadlock.
 */
async function keepPublicSummaries(
  tx: Prisma.TransactionClient,
  summaries: LeaderboardEntrySummary[],
) {
  if (summaries.length === 0) {
    return summaries;
  }

  const rows = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    SELECT "userId" FROM "UsagePreference"
    WHERE "userId" IN (${Prisma.join(summaries.map((summary) => summary.userId))})
      AND "publicProfileEnabled" = true
    FOR SHARE
  `);
  const visible = new Set(rows.map((row) => row.userId));

  if (visible.size === summaries.length) {
    return summaries;
  }

  const kept: LeaderboardEntrySummary[] = [];
  for (const summary of summaries) {
    if (visible.has(summary.userId)) {
      kept.push({ ...summary, rank: kept.length + 1 });
    }
  }

  return kept;
}

async function rebuildGlobalSnapshot(
  period: LeaderboardPeriod,
  metric: LeaderboardMetric,
  now: Date,
) {
  const { window, summaries: computed } = await computeGlobalSummaries({
    period,
    metric,
    now,
    limit: LEADERBOARD_SNAPSHOT_LIMIT,
  });
  const snapshotMetric = toSnapshotMetric(metric);

  const { snapshot, summaries } = await prisma.$transaction(async (tx) => {
    // react-doctor-disable-next-line react-doctor/async-parallel -- the preference rows must be locked before the snapshot is touched
    const summaries = await keepPublicSummaries(tx, computed);
    // react-doctor-disable-next-line react-doctor/server-sequential-independent-await -- see keepPublicSummaries for the lock order
    const nextSnapshot = await tx.leaderboardSnapshot.upsert({
      where: {
        period_metric: {
          period,
          metric: snapshotMetric,
        },
      },
      update: {
        windowStart: window.start,
        windowEnd: window.end,
        generatedAt: now,
      },
      create: {
        period,
        metric: snapshotMetric,
        windowStart: window.start,
        windowEnd: window.end,
        generatedAt: now,
      },
    });

    await tx.leaderboardSnapshotEntry.deleteMany({
      where: {
        snapshotId: nextSnapshot.id,
      },
    });

    if (summaries.length > 0) {
      await tx.leaderboardSnapshotEntry.createMany({
        data: summaries.map((row) => ({
          snapshotId: nextSnapshot.id,
          userId: row.userId,
          rank: row.rank,
          inputTokens: tokenCountToBigInt(row.inputTokens),
          outputTokens: tokenCountToBigInt(row.outputTokens),
          reasoningTokens: tokenCountToBigInt(row.reasoningTokens),
          cachedTokens: tokenCountToBigInt(row.cachedTokens),
          cacheCreationTokens: tokenCountToBigInt(row.cacheCreationTokens),
          totalTokens: tokenCountToBigInt(row.totalTokens),
          estimatedCostUsd: row.estimatedCostUsd,
          activeSeconds: row.activeSeconds,
          sessions: row.sessions,
        })),
      });
    }

    return { snapshot: nextSnapshot, summaries };
  });

  return {
    snapshot,
    summaries: summaries.slice(0, LEADERBOARD_PAGE_LIMIT),
    window,
  };
}

/**
 * Cached top of a board, rebuilt when the window rolls over or the TTL lapses.
 *
 * Both metrics go through here. The cost board especially: without it, every
 * request aggregated the whole window per user and model.
 */
async function ensureGlobalSnapshot(
  period: LeaderboardPeriod,
  metric: LeaderboardMetric,
  now: Date,
) {
  const requestedWindow = resolveLeaderboardWindow(period, now);
  const existing = await prisma.leaderboardSnapshot.findUnique({
    where: {
      period_metric: {
        period,
        metric: toSnapshotMetric(metric),
      },
    },
  });

  if (
    existing &&
    isSnapshotFresh({
      generatedAt: existing.generatedAt,
      snapshotWindow: {
        start: existing.windowStart,
        end: existing.windowEnd,
      },
      requestedWindow,
      now,
    })
  ) {
    const rows = await prisma.leaderboardSnapshotEntry.findMany({
      where: {
        snapshotId: existing.id,
      },
      orderBy: {
        rank: "asc",
      },
      take: LEADERBOARD_PAGE_LIMIT,
    });

    return {
      snapshot: existing,
      window: requestedWindow,
      summaries: rows.map(snapshotEntryToSummary),
    };
  }

  return rebuildGlobalSnapshot(period, metric, now);
}

async function getFollowingCostRankedSummaries(input: {
  period: LeaderboardPeriod;
  viewerUserId: string;
  followTag: FollowTagFilter;
  now: Date;
}) {
  const ids = await getFollowingNetworkIds(input.viewerUserId, input.followTag);
  const window = resolveLeaderboardWindow(input.period, input.now);

  if (ids.length === 0) {
    return {
      generatedAt: input.now,
      window,
      summaries: [] as LeaderboardEntrySummary[],
    };
  }

  const [catalog, groupedRows] = await Promise.all([
    getPricingCatalog(),
    prisma.usageBucket.groupBy({
      by: ["userId", "model"],
      where: {
        ...buildBucketWindowWhere(window),
        userId: {
          in: ids,
        },
        OR: [
          {
            userId: input.viewerUserId,
          },
          {
            user: {
              usagePreference: {
                is: {
                  publicProfileEnabled: true,
                },
              },
            },
          },
        ],
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        cachedTokens: true,
        cacheCreationTokens: true,
        totalTokens: true,
      },
    }),
  ]);

  const aggregates = buildUserUsageAggregates(groupedRows, catalog);
  const statsMap = await getLeaderboardDayStatsMap(
    Array.from(aggregates.keys()),
    window,
  );

  return {
    generatedAt: input.now,
    window,
    summaries: rankSummaries(
      aggregates.values(),
      statsMap,
      "estimated_cost",
      LEADERBOARD_PAGE_LIMIT,
    ),
  };
}

type GlobalTokenRankRow = {
  rank: bigint;
  inputTokens: bigint | null;
  outputTokens: bigint | null;
  reasoningTokens: bigint | null;
  cachedTokens: bigint | null;
  cacheCreationTokens: bigint | null;
  totalTokens: bigint | null;
  activeSeconds: bigint | null;
  sessions: bigint | null;
};

/**
 * One viewer's row and rank on the token board, ranked in the database.
 *
 * Ranking in the application would mean aggregating and sorting every user just
 * to read one position off the result.
 */
async function fetchGlobalTokenRankSummary(input: {
  userId: string;
  window: LeaderboardWindow;
}): Promise<LeaderboardEntrySummary | null> {
  const dateFilter =
    input.window.start && input.window.end
      ? Prisma.sql`AND l."statDate" >= ${input.window.start} AND l."statDate" < ${input.window.end}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<GlobalTokenRankRow[]>(Prisma.sql`
    WITH sums AS (
      SELECT
        l."userId",
        SUM(l."inputTokens")::bigint AS "inputTokens",
        SUM(l."outputTokens")::bigint AS "outputTokens",
        SUM(l."reasoningTokens")::bigint AS "reasoningTokens",
        SUM(l."cachedTokens")::bigint AS "cachedTokens",
        SUM(l."cacheCreationTokens")::bigint AS "cacheCreationTokens",
        SUM(l."totalTokens")::bigint AS "totalTokens",
        SUM(l."activeSeconds")::bigint AS "activeSeconds",
        SUM(l."sessions")::bigint AS "sessions"
      FROM leaderboard_user_day l
      INNER JOIN "UsagePreference" up ON up."userId" = l."userId"
      WHERE up."publicProfileEnabled" = true
      ${dateFilter}
      GROUP BY l."userId"
      HAVING SUM(l."totalTokens") > 0
    ),
    ranked AS (
      SELECT
        sums.*,
        ROW_NUMBER() OVER (
          ORDER BY sums."totalTokens" DESC, sums."userId" ASC
        ) AS rank
      FROM sums
    )
    SELECT * FROM ranked WHERE "userId" = ${input.userId}
  `);

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    rank: Number(row.rank),
    userId: input.userId,
    inputTokens: tokenCountToNumber(row.inputTokens),
    outputTokens: tokenCountToNumber(row.outputTokens),
    reasoningTokens: tokenCountToNumber(row.reasoningTokens),
    cachedTokens: tokenCountToNumber(row.cachedTokens),
    cacheCreationTokens: tokenCountToNumber(row.cacheCreationTokens),
    totalTokens: tokenCountToNumber(row.totalTokens),
    estimatedCostUsd: 0,
    activeSeconds: Number(row.activeSeconds ?? 0),
    sessions: Number(row.sessions ?? 0),
  };
}

async function getGlobalViewerRankSummary(input: {
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  viewerUserId: string;
  now: Date;
}) {
  const window = resolveLeaderboardWindow(input.period, input.now);

  if (input.metric === "estimated_cost") {
    // Cost ordering lives in the cached top 100. Look up the viewer directly so
    // ranks 51–100 remain visible even though the board only renders 50 rows.
    // A viewer outside that depth has no standalone row.
    const { snapshot } = await ensureGlobalSnapshot(
      input.period,
      input.metric,
      input.now,
    );
    const row = await prisma.leaderboardSnapshotEntry.findUnique({
      where: {
        snapshotId_userId: {
          snapshotId: snapshot.id,
          userId: input.viewerUserId,
        },
      },
    });

    return row ? { summary: snapshotEntryToSummary(row), window } : null;
  }

  const summary = await fetchGlobalTokenRankSummary({
    userId: input.viewerUserId,
    window,
  });

  return summary ? { summary, window } : null;
}

async function getGlobalLeaderboard(input: {
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  viewerUserId?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const { snapshot, summaries, window } = await ensureGlobalSnapshot(
    input.period,
    input.metric,
    now,
  );
  const entries = await hydrateEntries(summaries, window, input.viewerUserId);

  return toDataset({
    scope: "global",
    period: input.period,
    generatedAt: snapshot.generatedAt,
    window,
    entries,
  });
}

async function getFollowingLeaderboard(input: {
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  viewerUserId: string;
  followTag?: FollowTagFilter;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const followTag = input.followTag ?? "all";

  if (input.metric === "estimated_cost") {
    const { generatedAt, summaries, window } =
      await getFollowingCostRankedSummaries({
        period: input.period,
        viewerUserId: input.viewerUserId,
        followTag,
        now,
      });
    const entries = await hydrateEntries(
      summaries,
      window,
      input.viewerUserId,
      "following",
    );

    return toDataset({
      scope: "following",
      period: input.period,
      generatedAt,
      window,
      entries,
    });
  }

  const ids = await getFollowingNetworkIds(input.viewerUserId, followTag);
  const window = resolveLeaderboardWindow(input.period, now);

  if (ids.length === 0) {
    return toDataset({
      scope: "following",
      period: input.period,
      generatedAt: null,
      window,
      entries: [],
    });
  }

  const rows = await prisma.leaderboardUserDay.groupBy({
    by: ["userId"],
    where: {
      ...buildWindowWhere(window),
      userId: {
        in: ids,
      },
      OR: [
        {
          userId: input.viewerUserId,
        },
        {
          user: {
            usagePreference: {
              is: {
                publicProfileEnabled: true,
              },
            },
          },
        },
      ],
    },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      reasoningTokens: true,
      cachedTokens: true,
      cacheCreationTokens: true,
      totalTokens: true,
      activeSeconds: true,
      sessions: true,
    },
    orderBy: [
      {
        _sum: {
          totalTokens: "desc",
        },
      },
      {
        userId: "asc",
      },
    ],
    take: LEADERBOARD_PAGE_LIMIT,
  });

  const summaries = rows.reduce<LeaderboardEntrySummary[]>(
    (acc, row, index) => {
      const totalTokens = tokenCountToNumber(row._sum.totalTokens);
      if (totalTokens > 0) {
        acc.push({
          rank: index + 1,
          userId: row.userId,
          inputTokens: tokenCountToNumber(row._sum.inputTokens),
          outputTokens: tokenCountToNumber(row._sum.outputTokens),
          reasoningTokens: tokenCountToNumber(row._sum.reasoningTokens),
          cachedTokens: tokenCountToNumber(row._sum.cachedTokens),
          cacheCreationTokens: tokenCountToNumber(row._sum.cacheCreationTokens),
          totalTokens,
          estimatedCostUsd: 0,
          activeSeconds: coerceInt(row._sum.activeSeconds),
          sessions: coerceInt(row._sum.sessions),
        });
      }
      return acc;
    },
    [],
  );
  const entries = await hydrateEntries(
    summaries,
    window,
    input.viewerUserId,
    "following",
  );

  return toDataset({
    scope: "following",
    period: input.period,
    generatedAt: now,
    window,
    entries,
  });
}

export async function getLeaderboardPageData(input: {
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  viewerUserId?: string | null;
  followTag?: FollowTagFilter;
  now?: Date;
}): Promise<LeaderboardPageData> {
  const now = input.now ?? new Date();
  await finalizePendingLeaderboardPeriods(now);
  const [global, following, viewerPreference] = await Promise.all([
    getGlobalLeaderboard({
      period: input.period,
      metric: input.metric,
      viewerUserId: input.viewerUserId,
      now,
    }),
    input.viewerUserId
      ? getFollowingLeaderboard({
          period: input.period,
          metric: input.metric,
          viewerUserId: input.viewerUserId,
          followTag: input.followTag,
          now,
        })
      : Promise.resolve(null),
    input.viewerUserId
      ? prisma.usagePreference.findUnique({
          where: {
            userId: input.viewerUserId,
          },
          select: {
            publicProfileEnabled: true,
          },
        })
      : Promise.resolve(null),
  ]);
  const viewerUserId = input.viewerUserId ?? null;
  const viewerGlobalEntry =
    viewerUserId &&
    viewerPreference?.publicProfileEnabled &&
    global.entries.every((entry) => entry.userId !== viewerUserId)
      ? await (async () => {
          const rankedViewer = await getGlobalViewerRankSummary({
            period: input.period,
            metric: input.metric,
            viewerUserId,
            now,
          });

          if (!rankedViewer) {
            return null;
          }

          const [entry] = await hydrateEntries(
            [rankedViewer.summary],
            rankedViewer.window,
            viewerUserId,
          );

          return entry ?? null;
        })()
      : null;

  return {
    global,
    following,
    viewerGlobalEntry,
    viewerPublicProfileEnabled: viewerPreference?.publicProfileEnabled ?? null,
  };
}
