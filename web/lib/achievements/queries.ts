import "server-only";

import { finalizePendingLeaderboardPeriods } from "@/lib/leaderboard/finalize";
import { getUserGlobalLeaderboardRanksByTotalTokens } from "@/lib/leaderboard/rank";
import type { PricingCatalog } from "@/lib/pricing/catalog";
import { getPricingCatalog } from "@/lib/pricing/catalog";
import {
  estimateCostUsd,
  resolveOfficialPricingMatch,
} from "@/lib/pricing/resolve";
import { prisma } from "@/lib/prisma";
import { tokenCountToBigInt, tokenCountToNumber } from "@/lib/token-counts";
import { resolveDashboardRange } from "@/lib/usage/date-range";
import { formatDateInput } from "@/lib/usage/format";
import { getUsagePreference } from "@/lib/usage/preferences";
import type { UsageShareCardPersona } from "@/lib/usage/share-card";
import { normalizeUsageSource } from "@/lib/usage/sources";
import type { AchievementAwardSource } from "../../generated/prisma/client";
import { getArenaLevelFromScore } from "./arena-level";
import { achievementDefinitionMap } from "./catalog";
import {
  type AchievementInputMetrics,
  buildAchievementNotificationData,
  buildAchievementStatuses,
  buildAchievementsPageDataFromStatuses,
} from "./evaluate";
import {
  buildAchievementAwardPlan,
  mergeAchievementRecords,
  type StoredAchievementRecord,
} from "./records";
import {
  addTimelineValue,
  finalizeDistinctTimeline,
  finalizeTimeline,
  recordDistinctTimelineKey,
} from "./timeline";
import type {
  AchievementCode,
  AchievementNotificationData,
  AchievementsPageData,
} from "./types";

function latestIso(values: Array<string | null | undefined>) {
  const timestamps: number[] = [];

  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      timestamps.push(parsed);
    }
  }

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function earliestIso(values: Array<string | null | undefined>) {
  const timestamps: number[] = [];

  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      timestamps.push(parsed);
    }
  }

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.min(...timestamps)).toISOString();
}

function estimateBucketCostUsd(
  bucket: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    cacheCreationTokens: number;
  },
  catalog: PricingCatalog | null,
) {
  if (!catalog) {
    return 0;
  }

  const match = resolveOfficialPricingMatch(catalog, bucket.model);
  const estimate = estimateCostUsd(
    {
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      reasoningTokens: bucket.reasoningTokens,
      cachedTokens: bucket.cachedTokens,
      cacheCreationTokens: bucket.cacheCreationTokens ?? 0,
    },
    match?.cost,
  );

  return estimate?.totalUsd ?? 0;
}

function resolveCurrentPersona(input: {
  totalTokens: number;
  totalSessions: number;
  reasoningShare: number;
  cacheShare: number;
  topProjectShare: number;
  topModelShare: number;
  modelDiversity: number;
}): UsageShareCardPersona | null {
  if (input.totalTokens <= 0 && input.totalSessions <= 0) {
    return null;
  }

  const averageTokensPerSession =
    input.totalSessions > 0 ? input.totalTokens / input.totalSessions : 0;

  if (input.reasoningShare >= 0.28) {
    return "reasoning_master";
  }

  if (input.cacheShare >= 0.18) {
    return "cache_guardian";
  }

  if (input.topProjectShare >= 0.68) {
    return "project_deep_diver";
  }

  if (input.modelDiversity >= 3 && input.topModelShare <= 0.62) {
    return "model_orchestrator";
  }

  if (input.totalSessions >= 10 && averageTokensPerSession <= 120_000) {
    return "rapid_shipper";
  }

  return "steady_builder";
}

export function buildAllTimeMetrics(input: {
  timezone: string;
  buckets: Array<{
    bucketStart: Date;
    totalTokens: number | bigint;
    inputTokens: number | bigint;
    outputTokens: number | bigint;
    reasoningTokens: number | bigint;
    cachedTokens: number | bigint;
    cacheCreationTokens: number | bigint;
    model: string;
    source: string;
    projectKey: string;
    deviceId: string;
  }>;
  sessions: Array<{
    firstMessageAt: Date;
    activeSeconds: number;
    deviceId: string;
  }>;
  following: Array<{ followingId: string; createdAt: Date }>;
  followers: Array<{ followerId: string; createdAt: Date }>;
  publicProfileEnabled: boolean;
  publicProfileUpdatedAt: Date | null;
  leaderboardRanks?: {
    day: number | null;
    week: number | null;
    month: number | null;
    all_time: number | null;
  };
  catalog: PricingCatalog | null;
}): AchievementInputMetrics {
  const leaderboardRanks = input.leaderboardRanks ?? {
    day: null,
    week: null,
    month: null,
    all_time: null,
  };
  const tokenValuesByTimestamp = new Map<string, number>();
  const costValuesByTimestamp = new Map<string, number>();
  const sessionValuesByTimestamp = new Map<string, number>();
  const activeSecondsByTimestamp = new Map<string, number>();
  const firstModelTimestamp = new Map<string, string>();
  const firstToolTimestamp = new Map<string, string>();
  const firstProjectTimestamp = new Map<string, string>();
  const firstDeviceTimestamp = new Map<string, string>();
  const activityDayKeys = new Set<string>();
  let totalTokens = 0;
  let totalActiveSeconds = 0;
  let totalEstimatedCostUsd = 0;

  for (const bucket of input.buckets) {
    const at = bucket.bucketStart.toISOString();
    const normalized = {
      totalTokens: tokenCountToNumber(bucket.totalTokens),
      inputTokens: tokenCountToNumber(bucket.inputTokens),
      outputTokens: tokenCountToNumber(bucket.outputTokens),
      reasoningTokens: tokenCountToNumber(bucket.reasoningTokens),
      cachedTokens: tokenCountToNumber(bucket.cachedTokens),
      cacheCreationTokens: tokenCountToNumber(bucket.cacheCreationTokens),
    };
    const estimatedCostUsd = estimateBucketCostUsd(
      {
        model: bucket.model,
        inputTokens: normalized.inputTokens,
        outputTokens: normalized.outputTokens,
        reasoningTokens: normalized.reasoningTokens,
        cachedTokens: normalized.cachedTokens,
        cacheCreationTokens: normalized.cacheCreationTokens ?? 0,
      },
      input.catalog,
    );

    addTimelineValue(tokenValuesByTimestamp, at, normalized.totalTokens);
    addTimelineValue(costValuesByTimestamp, at, estimatedCostUsd);
    recordDistinctTimelineKey(firstModelTimestamp, bucket.model, at);
    recordDistinctTimelineKey(
      firstToolTimestamp,
      normalizeUsageSource(bucket.source),
      at,
    );
    recordDistinctTimelineKey(firstProjectTimestamp, bucket.projectKey, at);
    recordDistinctTimelineKey(firstDeviceTimestamp, bucket.deviceId, at);
    activityDayKeys.add(formatDateInput(bucket.bucketStart, input.timezone));
    totalTokens += normalized.totalTokens;
    totalEstimatedCostUsd += estimatedCostUsd;
  }

  for (const session of input.sessions) {
    const at = session.firstMessageAt.toISOString();
    addTimelineValue(sessionValuesByTimestamp, at, 1);
    addTimelineValue(activeSecondsByTimestamp, at, session.activeSeconds);
    recordDistinctTimelineKey(firstDeviceTimestamp, session.deviceId, at);
    activityDayKeys.add(
      formatDateInput(session.firstMessageAt, input.timezone),
    );
    totalActiveSeconds += session.activeSeconds;
  }

  const tokenTimeline = finalizeTimeline(tokenValuesByTimestamp);
  const costTimeline = finalizeTimeline(costValuesByTimestamp);
  const sessionTimeline = finalizeTimeline(sessionValuesByTimestamp);
  const activeSecondsTimeline = finalizeTimeline(activeSecondsByTimestamp);
  const modelTimeline = finalizeDistinctTimeline(firstModelTimestamp);
  const toolTimeline = finalizeDistinctTimeline(firstToolTimestamp);
  const projectTimeline = finalizeDistinctTimeline(firstProjectTimestamp);
  const deviceTimeline = finalizeDistinctTimeline(firstDeviceTimestamp);

  tokenValuesByTimestamp.clear();
  costValuesByTimestamp.clear();
  sessionValuesByTimestamp.clear();
  activeSecondsByTimestamp.clear();
  firstModelTimestamp.clear();
  firstToolTimestamp.clear();
  firstProjectTimestamp.clear();
  firstDeviceTimestamp.clear();

  const sortedActivityDayKeys = Array.from(activityDayKeys).sort(
    (left, right) => left.localeCompare(right),
  );

  const now = new Date();
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const followingMap = new Map(
    input.following.map(
      (record) => [record.followingId, record.createdAt] as const,
    ),
  );
  const mutualEffectiveDates = input.followers
    .reduce<string[]>((acc, record) => {
      const followingAt = followingMap.get(record.followerId);

      if (followingAt) {
        acc.push(
          new Date(
            Math.max(followingAt.getTime(), record.createdAt.getTime()),
          ).toISOString(),
        );
      }

      return acc;
    }, [])
    .sort((left, right) => Date.parse(left) - Date.parse(right));

  const recentRange = resolveDashboardRange({
    preset: "30d",
    timezone: input.timezone,
    now,
  });
  const recentTotals = {
    totalTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheCreationTokens: 0,
    byProject: new Map<string, number>(),
    byModel: new Map<string, number>(),
  };
  let recentSessionCount = 0;
  let lastRecentBucketAt: string | null = null;
  let lastRecentSessionAt: string | null = null;

  for (const bucket of input.buckets) {
    const timestamp = bucket.bucketStart.getTime();
    if (
      timestamp < recentRange.from.getTime() ||
      timestamp > recentRange.to.getTime()
    ) {
      continue;
    }

    const bucketTotalTokens = tokenCountToNumber(bucket.totalTokens);
    recentTotals.totalTokens += bucketTotalTokens;
    recentTotals.reasoningTokens += tokenCountToNumber(bucket.reasoningTokens);
    recentTotals.cachedTokens += tokenCountToNumber(bucket.cachedTokens);
    recentTotals.cacheCreationTokens += tokenCountToNumber(
      bucket.cacheCreationTokens,
    );
    recentTotals.byProject.set(
      bucket.projectKey,
      (recentTotals.byProject.get(bucket.projectKey) ?? 0) + bucketTotalTokens,
    );
    recentTotals.byModel.set(
      bucket.model,
      (recentTotals.byModel.get(bucket.model) ?? 0) + bucketTotalTokens,
    );
    lastRecentBucketAt = bucket.bucketStart.toISOString();
  }

  for (const session of input.sessions) {
    const timestamp = session.firstMessageAt.getTime();
    if (
      timestamp < recentRange.from.getTime() ||
      timestamp > recentRange.to.getTime()
    ) {
      continue;
    }

    recentSessionCount += 1;
    lastRecentSessionAt = session.firstMessageAt.toISOString();
  }

  const topProjectTokens = Math.max(0, ...recentTotals.byProject.values());
  const topModelTokens = Math.max(0, ...recentTotals.byModel.values());
  const totalTokens30d = recentTotals.totalTokens;
  const reasoningShare30d =
    totalTokens30d > 0 ? recentTotals.reasoningTokens / totalTokens30d : 0;
  const cacheShare30d =
    totalTokens30d > 0 ? recentTotals.cachedTokens / totalTokens30d : 0;
  const topProjectShare30d =
    totalTokens30d > 0 ? topProjectTokens / totalTokens30d : 0;
  const topModelShare30d =
    totalTokens30d > 0 ? topModelTokens / totalTokens30d : 0;
  const currentPersona = resolveCurrentPersona({
    totalTokens: totalTokens30d,
    totalSessions: recentSessionCount,
    reasoningShare: reasoningShare30d,
    cacheShare: cacheShare30d,
    topProjectShare: topProjectShare30d,
    topModelShare: topModelShare30d,
    modelDiversity: recentTotals.byModel.size,
  });

  return {
    timezone: input.timezone,
    firstSyncAt: latestIso([
      tokenTimeline[0]?.at ?? null,
      sessionTimeline[0]?.at ?? null,
    ])
      ? earliestIso([tokenTimeline[0]?.at, sessionTimeline[0]?.at])
      : null,
    publicProfileEnabled: input.publicProfileEnabled,
    publicProfileUpdatedAt: input.publicProfileUpdatedAt?.toISOString() ?? null,
    activeDayKeys: sortedActivityDayKeys,
    todayKey: formatDateInput(now, input.timezone),
    yesterdayKey: formatDateInput(yesterday, input.timezone),
    totalTokens,
    totalSessions: input.sessions.length,
    totalActiveSeconds,
    tokenTimeline,
    costTimeline,
    totalEstimatedCostUsd,
    sessionTimeline,
    activeSecondsTimeline,
    modelTimeline,
    toolTimeline,
    projectTimeline,
    deviceTimeline,
    reasoningShare30d,
    cacheShare30d,
    topProjectShare30d,
    recentWindowUnlockedAt: latestIso([
      lastRecentBucketAt,
      lastRecentSessionAt,
    ]),
    followingCount: input.following.length,
    firstFollowingAt: input.following[0]?.createdAt.toISOString() ?? null,
    followingTimeline: input.following.map((record) =>
      record.createdAt.toISOString(),
    ),
    followerCount: input.followers.length,
    firstFollowerAt: input.followers[0]?.createdAt.toISOString() ?? null,
    followerTimeline: input.followers.map((record) =>
      record.createdAt.toISOString(),
    ),
    mutualCount: mutualEffectiveDates.length,
    mutualReachedAt: mutualEffectiveDates[2] ?? null,
    mutualTimeline: mutualEffectiveDates,
    currentPersona,
    leaderboardDayRank: leaderboardRanks.day,
    leaderboardWeekRank: leaderboardRanks.week,
    leaderboardMonthRank: leaderboardRanks.month,
    leaderboardAllTimeRank: leaderboardRanks.all_time,
  };
}

function normalizeStoredAchievementRecord(row: {
  code: string;
  awardCount: number;
  firstAwardedAt: Date | null;
  lastAwardedAt: Date | null;
  state: unknown;
}): StoredAchievementRecord | null {
  return {
    code: row.code as StoredAchievementRecord["code"],
    awardCount: row.awardCount,
    firstAwardedAt: row.firstAwardedAt?.toISOString() ?? null,
    lastAwardedAt: row.lastAwardedAt?.toISOString() ?? null,
    state:
      row.state && typeof row.state === "object"
        ? (row.state as StoredAchievementRecord["state"])
        : null,
  };
}

async function loadAchievementMetrics(userId: string) {
  const [preference, user, buckets, sessions, following, followers, catalog] =
    await Promise.all([
      getUsagePreference(userId),
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          usagePreference: {
            select: {
              publicProfileEnabled: true,
              updatedAt: true,
            },
          },
        },
      }),
      prisma.usageBucket.findMany({
        where: { userId },
        select: {
          bucketStart: true,
          totalTokens: true,
          inputTokens: true,
          outputTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          cacheCreationTokens: true,
          model: true,
          source: true,
          projectKey: true,
          deviceId: true,
        },
        orderBy: { bucketStart: "asc" },
      }),
      prisma.usageSession.findMany({
        where: { userId },
        select: {
          firstMessageAt: true,
          activeSeconds: true,
          deviceId: true,
        },
        orderBy: { firstMessageAt: "asc" },
      }),
      prisma.follow.findMany({
        where: { followerId: userId },
        select: {
          followingId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.follow.findMany({
        where: { followingId: userId },
        select: {
          followerId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      getPricingCatalog(),
    ]);
  const publicProfileEnabled =
    user.usagePreference?.publicProfileEnabled ?? false;
  const leaderboardRanks =
    await getUserGlobalLeaderboardRanksByTotalTokens(userId);

  return buildAllTimeMetrics({
    timezone: preference.timezone,
    buckets,
    sessions,
    following,
    followers,
    publicProfileEnabled,
    publicProfileUpdatedAt: user.usagePreference?.updatedAt ?? null,
    leaderboardRanks,
    catalog,
  });
}

async function synchronizeUserAchievements(input: {
  userId: string;
  metrics: AchievementInputMetrics;
  source: AchievementAwardSource;
}) {
  const existingRows = await prisma.userAchievement.findMany({
    where: {
      userId: input.userId,
    },
  });
  const existingRecords = existingRows.reduce<StoredAchievementRecord[]>(
    (acc, row) => {
      const record = normalizeStoredAchievementRecord(row);
      if (record) acc.push(record);
      return acc;
    },
    [],
  );
  const plan = buildAchievementAwardPlan({
    userId: input.userId,
    evaluatedAt: new Date().toISOString(),
    source: input.source,
    statuses: buildAchievementStatuses(input.metrics),
    records: existingRecords,
  });
  const existingCodes = new Set(existingRecords.map((record) => record.code));

  if (plan.awards.length > 0 || plan.records.size > 0) {
    await prisma.$transaction(async (tx) => {
      if (plan.awards.length > 0) {
        await tx.achievementAward.createMany({
          data: plan.awards.map((award) => ({
            userId: award.userId,
            code: award.code,
            awardedAt: new Date(award.awardedAt),
            source: award.source,
            dedupeKey: award.dedupeKey,
            pointsAwarded: award.pointsAwarded,
            progressValue: award.progressValue,
            thresholdValue: award.thresholdValue,
            context: award.context,
          })),
          skipDuplicates: true,
        });
      }

      await Promise.all(
        Array.from(plan.records.values()).map(async (record) => {
          if (record.awardCount === 0 && !existingCodes.has(record.code)) {
            return;
          }

          await tx.userAchievement.upsert({
            where: {
              userId_code: {
                userId: input.userId,
                code: record.code,
              },
            },
            update: {
              awardCount: record.awardCount,
              firstAwardedAt: record.firstAwardedAt
                ? new Date(record.firstAwardedAt)
                : null,
              lastAwardedAt: record.lastAwardedAt
                ? new Date(record.lastAwardedAt)
                : null,
              ...(record.state ? { state: record.state } : {}),
            },
            create: {
              userId: input.userId,
              code: record.code,
              awardCount: record.awardCount,
              firstAwardedAt: record.firstAwardedAt
                ? new Date(record.firstAwardedAt)
                : null,
              lastAwardedAt: record.lastAwardedAt
                ? new Date(record.lastAwardedAt)
                : null,
              ...(record.state ? { state: record.state } : {}),
            },
          });
        }),
      );
    });
  }

  return plan.records;
}

export type ArenaSummary = {
  score: number;
  level: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  totalActiveSeconds: number;
  totalSessions: number;
  totalActiveDays: number;
};

async function persistArenaSummary(userId: string, summary: ArenaSummary) {
  const row = {
    score: summary.score,
    level: summary.level,
    totalTokens: tokenCountToBigInt(summary.totalTokens),
    totalEstimatedCostUsd: summary.totalEstimatedCostUsd,
    totalActiveSeconds: summary.totalActiveSeconds,
    totalSessions: summary.totalSessions,
    totalActiveDays: summary.totalActiveDays,
    computedAt: new Date(),
  };

  await prisma.userArenaSummary.upsert({
    where: { userId },
    update: row,
    create: { userId, ...row },
  });
}

/**
 * Re-evaluate every achievement for a user and persist the results.
 *
 * This is the expensive path: it replays the user's whole bucket and session
 * history and runs four global rank queries, so it only belongs on writes
 * (ingest, follow) and on the owner's own pages — never on a public profile
 * view. It refreshes `UserArenaSummary` so those views can read a row instead.
 */
async function refreshUserAchievements(
  userId: string,
  source: AchievementAwardSource,
) {
  await finalizePendingLeaderboardPeriods();
  const metrics = await loadAchievementMetrics(userId);
  const records = await synchronizeUserAchievements({
    userId,
    metrics,
    source,
  });
  const pageData = buildAchievementsPageDataFromStatuses({
    metrics,
    achievements: mergeAchievementRecords(
      buildAchievementStatuses(metrics),
      records,
    ),
  });
  const summary: ArenaSummary = {
    score: pageData.summary.score,
    level: pageData.summary.level,
    totalTokens: metrics.totalTokens,
    totalEstimatedCostUsd: metrics.totalEstimatedCostUsd,
    totalActiveSeconds: metrics.totalActiveSeconds,
    totalSessions: metrics.totalSessions,
    totalActiveDays: pageData.summary.totalActiveDays,
  };

  await persistArenaSummary(userId, summary);

  return { records, pageData, summary };
}

export async function synchronizeAchievementsForUser(
  userId: string,
  source: AchievementAwardSource = "manual",
) {
  const { records } = await refreshUserAchievements(userId, source);
  return records;
}

export async function getAchievementsPageData(
  userId: string,
): Promise<AchievementsPageData> {
  const { pageData } = await refreshUserAchievements(userId, "manual");
  return pageData;
}

export async function getAchievementArenaSummary(
  userId: string,
): Promise<ArenaSummary> {
  const { summary } = await refreshUserAchievements(userId, "manual");
  return summary;
}

/**
 * Arena score/level for a profile view, read from the materialized row.
 *
 * Falls back to a full recompute only when no row exists yet. An award written
 * after the summary was computed only needs a small score/level correction from
 * stored achievement counts; usage history is not replayed on that path.
 */
export async function getArenaSummaryForProfile(
  userId: string,
): Promise<ArenaSummary> {
  const stored = await prisma.userArenaSummary.findUnique({
    where: { userId },
  });

  if (!stored) {
    return getAchievementArenaSummary(userId);
  }

  let score = stored.score;
  let level = stored.level;
  const hasNewAchievement = await prisma.userAchievement.findFirst({
    where: { userId, updatedAt: { gt: stored.computedAt } },
    select: { code: true },
  });

  if (hasNewAchievement) {
    const achievements = await prisma.userAchievement.findMany({
      where: { userId },
      select: { code: true, awardCount: true, updatedAt: true },
    });
    score = achievements.reduce(
      (sum, achievement) =>
        sum +
        (achievementDefinitionMap.get(achievement.code as AchievementCode)
          ?.points ?? 0) *
          achievement.awardCount,
      0,
    );
    level = getArenaLevelFromScore(score);
    const latestAchievementUpdate = achievements.reduce(
      (latest, achievement) =>
        achievement.updatedAt > latest ? achievement.updatedAt : latest,
      stored.computedAt,
    );

    await prisma.userArenaSummary.update({
      where: { userId },
      data: { score, level, computedAt: latestAchievementUpdate },
    });
  }

  return {
    score,
    level,
    totalTokens: tokenCountToNumber(stored.totalTokens),
    totalEstimatedCostUsd: stored.totalEstimatedCostUsd,
    totalActiveSeconds: stored.totalActiveSeconds,
    totalSessions: stored.totalSessions,
    totalActiveDays: stored.totalActiveDays,
  };
}

export async function getAchievementNotificationData(
  userId: string,
): Promise<AchievementNotificationData> {
  const { pageData } = await refreshUserAchievements(userId, "manual");
  return buildAchievementNotificationData(pageData);
}
