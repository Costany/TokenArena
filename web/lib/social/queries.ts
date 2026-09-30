import "server-only";

import type { ProfileAchievementWallItem } from "@/lib/achievements/profile-wall";
import { getProfileAchievementWall } from "@/lib/achievements/profile-wall";
import { getArenaSummaryForProfile } from "@/lib/achievements/queries";
import { normalizeUsername } from "@/lib/auth-username";
import { getPricingCatalog } from "@/lib/pricing/catalog";
import {
  estimateCostUsd,
  resolveOfficialPricingMatch,
} from "@/lib/pricing/resolve";
import { prisma } from "@/lib/prisma";
import {
  LINKED_PROFILE_PROVIDER_IDS,
  type LinkedProfileProviderId,
  pickLinkedAccount,
  resolveLinkedProfileUrl,
} from "@/lib/social/linked-provider-profile";
import {
  type ProfileRangePreset,
  type ProfileRangeQuery,
  resolveProfileRange,
} from "@/lib/social/profile-range";
import { tokenCountToNumber } from "@/lib/token-counts";
import {
  groupByHourOrDay,
  listRangeBuckets,
  resolveDashboardRange,
} from "@/lib/usage/date-range";
import { formatDateInput } from "@/lib/usage/format";
import { getUsageSourceLabel, normalizeUsageSource } from "@/lib/usage/sources";
import type { DashboardRange } from "@/lib/usage/types";
import { Prisma } from "../../generated/prisma/client";
import type { FollowTag } from "./follow-tags";

const DAY_MS = 24 * 60 * 60 * 1000;

const profileUserSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  createdAt: true,
  usagePreference: {
    select: {
      bio: true,
      timezone: true,
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

export async function getPublicProfileMetadata(input: { username: string }) {
  const user = await prisma.user.findUnique({
    where: {
      username: normalizeUsername(input.username),
    },
    select: {
      usagePreference: {
        select: {
          bio: true,
          publicProfileEnabled: true,
        },
      },
    },
  });

  if (!user?.usagePreference?.publicProfileEnabled) {
    return null;
  }

  return { bio: user.usagePreference.bio };
}

type ProfileUserRecord = Awaited<{
  id: string;
  name: string;
  username: string;
  image: string | null;
  createdAt: Date;
  usagePreference: {
    bio: string | null;
    timezone: string;
    publicProfileEnabled: boolean;
  } | null;
  _count: {
    followers: number;
    following: number;
  };
} | null>;

export type SocialListProfile = {
  id: string;
  name: string;
  username: string;
  image: string | null;
  bio: string | null;
  publicProfileEnabled: boolean;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  followTag: FollowTag | null;
  followsYou: boolean;
  isSelf: boolean;
};

export type ProfileHeatmapDay = {
  date: string;
  activeSeconds: number;
  sessions: number;
  totalTokens: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type PublicProfileActivityShareData = {
  username: string;
  timezone: string;
  heatmap: ProfileHeatmapDay[];
  summary: {
    activeDays: number;
    activeSeconds: number;
  };
};

export type PublicProfilePageData = {
  id: string;
  name: string;
  username: string;
  image: string | null;
  bio: string | null;
  createdAt: Date;
  publicProfileEnabled: boolean;
  timezone: string;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  followTag: FollowTag | null;
  followsYou: boolean;
  isSelf: boolean;
  /**
   * Range the overview and top lists were computed over. `from`/`to` are null
   * for the all-time default; the heatmap always covers the last 365 days.
   */
  range: {
    preset: ProfileRangePreset;
    from: string | null;
    to: string | null;
    timezone: string;
  };
  overview: {
    arenaScore: number;
    arenaLevel: number;
    totalTokens: number;
    estimatedCostUsd: number;
    activeSeconds: number;
    sessions: number;
    activeDays: number;
  };
  heatmap: ProfileHeatmapDay[];
  topTools: Array<{
    name: string;
    totalTokens: number;
    share: number;
  }>;
  topModels: Array<{
    name: string;
    totalTokens: number;
    share: number;
  }>;
  achievementWall: ProfileAchievementWallItem[];
  linkedIdentity: {
    providerId: LinkedProfileProviderId;
    profileUrl: string;
  } | null;
};

type RelationFlags = {
  isFollowing: boolean;
  followTag: FollowTag | null;
  followsYou: boolean;
};

function createDailyRange(timezone: string, days: number) {
  const now = new Date();

  return resolveDashboardRange({
    preset: "custom",
    timezone,
    from: formatDateInput(
      new Date(now.getTime() - (days - 1) * DAY_MS),
      timezone,
    ),
    to: formatDateInput(now, timezone),
  });
}

function mapRelationFlags(
  ids: string[],
  direct: Array<{ followingId: string; tag: FollowTag | null }>,
  reverse: Array<{ followerId: string }>,
) {
  const followingMap = new Map(
    direct.map((record) => [record.followingId, record.tag] as const),
  );
  const followerIds = new Set(reverse.map((record) => record.followerId));

  return new Map<string, RelationFlags>(
    ids.map((id) => [
      id,
      {
        isFollowing: followingMap.has(id),
        followTag: followingMap.get(id) ?? null,
        followsYou: followerIds.has(id),
      },
    ]),
  );
}

function mapUserToListProfile(
  user: NonNullable<ProfileUserRecord>,
  relationFlags: RelationFlags,
  viewerUserId?: string | null,
): SocialListProfile {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    image: user.image,
    bio: user.usagePreference?.bio ?? null,
    publicProfileEnabled: user.usagePreference?.publicProfileEnabled ?? false,
    followerCount: user._count.followers,
    followingCount: user._count.following,
    isFollowing: relationFlags.isFollowing,
    followTag: relationFlags.followTag,
    followsYou: relationFlags.followsYou,
    isSelf: viewerUserId === user.id,
  };
}

async function getRelationFlags(
  viewerUserId: string | null | undefined,
  targetUserId: string,
): Promise<RelationFlags> {
  if (!viewerUserId || viewerUserId === targetUserId) {
    return {
      isFollowing: false,
      followTag: null,
      followsYou: false,
    };
  }

  const [isFollowing, followsYou] = await Promise.all([
    prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: viewerUserId,
          followingId: targetUserId,
        },
      },
      select: { id: true, tag: true },
    }),
    prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: targetUserId,
          followingId: viewerUserId,
        },
      },
      select: { id: true },
    }),
  ]);

  return {
    isFollowing: Boolean(isFollowing),
    followTag: isFollowing?.tag ?? null,
    followsYou: Boolean(followsYou),
  };
}

type DailyHeatmapAggregate = {
  date: string;
  activeSeconds: number;
  sessions: number;
  totalTokens: number | bigint;
};

function buildHeatmapFromDailyAggregates(
  days: Array<{ key: string }>,
  rows: DailyHeatmapAggregate[],
) {
  const seeded = new Map<string, ProfileHeatmapDay>(
    days.map((day) => [
      day.key,
      {
        date: day.key,
        activeSeconds: 0,
        sessions: 0,
        totalTokens: 0,
        level: 0,
      },
    ]),
  );

  for (const row of rows) {
    const day = seeded.get(row.date);

    if (!day) {
      continue;
    }

    day.activeSeconds += row.activeSeconds;
    day.sessions += row.sessions;
    day.totalTokens += tokenCountToNumber(row.totalTokens);
  }

  const values = Array.from(seeded.values());
  const maxValue = Math.max(...values.map((day) => day.activeSeconds), 0);

  for (const day of values) {
    if (day.activeSeconds <= 0 || maxValue <= 0) {
      day.level = 0;
      continue;
    }

    day.level = Math.min(
      4,
      Math.max(1, Math.ceil((day.activeSeconds / maxValue) * 4)),
    ) as ProfileHeatmapDay["level"];
  }

  return values;
}

function nextDateKey(key: string) {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function firstUtcInstantOfLocalDay(
  range: DashboardRange,
  key: string,
  hint?: number,
) {
  const nominalUtc = Date.parse(`${key}T00:00:00.000Z`);
  if (range.timezone === "UTC") return nominalUtc;

  // listRangeBuckets 给出的 day.start 通常就是首毫秒，两次格式化即可确认；
  // 本地午夜跳时后它可能停在 01:00 之类的时刻，此时才按日期键二分查找。
  if (
    hint !== undefined &&
    groupByHourOrDay(range, new Date(hint)) === key &&
    groupByHourOrDay(range, new Date(hint - 1)) < key
  ) {
    return hint;
  }

  let lower = nominalUtc - 2 * DAY_MS;
  let upper = nominalUtc + 2 * DAY_MS;

  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (groupByHourOrDay(range, new Date(middle)) < key) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }

  return lower;
}

export async function getActivityHeatmap365(input: {
  userId: string;
  timezone: string;
}): Promise<ProfileHeatmapDay[]> {
  const range365 = createDailyRange(input.timezone, 365);
  const days = listRangeBuckets(range365);

  // The leaderboard aggregate is maintained on every ingest and is already
  // keyed by Shanghai calendar day. Use it for the default timezone so a
  // profile request transfers at most 365 rows instead of every raw session
  // and bucket from the last year.
  if (input.timezone === "Asia/Shanghai") {
    const dailyRows = await prisma.leaderboardUserDay.findMany({
      where: {
        userId: input.userId,
        statDate: {
          gte: range365.from,
          lte: range365.to,
        },
      },
      select: {
        statDate: true,
        activeSeconds: true,
        sessions: true,
        totalTokens: true,
      },
      orderBy: { statDate: "asc" },
    });

    return buildHeatmapFromDailyAggregates(
      days,
      dailyRows.map((row) => ({
        ...row,
        date: groupByHourOrDay(range365, row.statDate),
      })),
    );
  }

  const hints = new Map(days.map((day) => [day.key, day.start.getTime()]));
  const boundaries = new Map<string, number>();
  const boundary = (key: string) => {
    const cached = boundaries.get(key);
    if (cached !== undefined) return cached;
    const value = firstUtcInstantOfLocalDay(range365, key, hints.get(key));
    boundaries.set(key, value);
    return value;
  };
  const endExclusive = range365.to.getTime() + 1;
  const dayRanges = Array.from(new Set(days.map((day) => day.key))).flatMap(
    (key) => {
      const start = Math.max(range365.from.getTime(), boundary(key));
      const end = Math.min(endExclusive, boundary(nextDateKey(key)));
      if (start >= end) return [];

      return [
        Prisma.sql`(
          ${key}::text,
          ${new Date(start).toISOString()}::timestamp(3),
          ${new Date(end).toISOString()}::timestamp(3)
        )`,
      ];
    },
  );

  // DateTime 列存放无时区的 UTC 墙钟值。用应用已算好的本地日边界，
  // 避免数据库与 Intl 对时区别名的支持范围不同，也只传输有数据的日汇总。
  const dailyRows = await prisma.$queryRaw<DailyHeatmapAggregate[]>(Prisma.sql`
    WITH day_ranges ("date", "startAt", "endAt") AS (
      VALUES ${Prisma.join(dayRanges)}
    ), day_events AS (
      SELECT
        d."date", s."activeSeconds"::bigint AS "activeSeconds",
        1::bigint AS "sessions", 0::bigint AS "totalTokens"
      FROM day_ranges d
      JOIN "UsageSession" s ON s."userId" = ${input.userId}::text
        AND s."firstMessageAt" >= d."startAt"
        AND s."firstMessageAt" < d."endAt"
      WHERE s."firstMessageAt" >= ${range365.from.toISOString()}::timestamp(3)
        AND s."firstMessageAt" <= ${range365.to.toISOString()}::timestamp(3)

      UNION ALL

      SELECT
        d."date", 0::bigint, 0::bigint, b."totalTokens"
      FROM day_ranges d
      JOIN "UsageBucket" b ON b."userId" = ${input.userId}::text
        AND b."bucketStart" >= d."startAt"
        AND b."bucketStart" < d."endAt"
      WHERE b."bucketStart" >= ${range365.from.toISOString()}::timestamp(3)
        AND b."bucketStart" <= ${range365.to.toISOString()}::timestamp(3)
    )
    SELECT
      "date",
      SUM("activeSeconds")::double precision AS "activeSeconds",
      SUM("sessions")::double precision AS "sessions",
      SUM("totalTokens")::bigint AS "totalTokens"
    FROM day_events
    GROUP BY "date"
    ORDER BY "date"
  `);

  return buildHeatmapFromDailyAggregates(days, dailyRows);
}

/**
 * Aggregate the profile overview and top lists for a range.
 *
 * These run as database-side `groupBy`/`aggregate` calls rather than loading
 * raw rows: a public profile is reachable by anyone, and an all-time range on
 * a heavy account would otherwise transfer every bucket the user ever synced.
 * Summing per model before applying the rate is equivalent to per-bucket
 * pricing because `estimateCostUsd` is linear in the token counts.
 */
async function loadPublicProfileUsageSnapshot(input: {
  userId: string;
  timezone: string;
  range: DashboardRange | null;
}) {
  const bucketWhere = {
    userId: input.userId,
    ...(input.range
      ? {
          bucketStart: {
            gte: input.range.from,
            lte: input.range.to,
          },
        }
      : {}),
  };
  const sessionWhere = {
    userId: input.userId,
    ...(input.range
      ? {
          firstMessageAt: {
            gte: input.range.from,
            lte: input.range.to,
          },
        }
      : {}),
  };

  const [activityHeatmap, catalog, modelRows, sourceRows, sessionTotals] =
    await Promise.all([
      getActivityHeatmap365({
        userId: input.userId,
        timezone: input.timezone,
      }),
      getPricingCatalog(),
      prisma.usageBucket.groupBy({
        by: ["model"],
        where: bucketWhere,
        _sum: {
          inputTokens: true,
          outputTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          cacheCreationTokens: true,
          totalTokens: true,
        },
      }),
      prisma.usageBucket.groupBy({
        by: ["source"],
        where: bucketWhere,
        _sum: { totalTokens: true },
      }),
      prisma.usageSession.aggregate({
        where: sessionWhere,
        _sum: { activeSeconds: true },
        _count: { _all: true },
      }),
    ]);

  let totalTokens = 0;
  let estimatedCostUsd = 0;
  const modelTotals = modelRows.map((row) => {
    const tokens = normalizeUsageBucketTokenFields({
      inputTokens: row._sum.inputTokens,
      outputTokens: row._sum.outputTokens,
      reasoningTokens: row._sum.reasoningTokens,
      cachedTokens: row._sum.cachedTokens,
      cacheCreationTokens: row._sum.cacheCreationTokens,
      totalTokens: row._sum.totalTokens,
    });

    totalTokens += tokens.totalTokens;
    estimatedCostUsd +=
      estimateCostUsd(
        tokens,
        resolveOfficialPricingMatch(catalog, row.model)?.cost,
      )?.totalUsd ?? 0;

    return { name: row.model, totalTokens: tokens.totalTokens };
  });
  const toolTotals = new Map<string, number>();
  for (const row of sourceRows) {
    const source = normalizeUsageSource(row.source);
    toolTotals.set(
      source,
      (toolTotals.get(source) ?? 0) + tokenCountToNumber(row._sum.totalTokens),
    );
  }

  return {
    activityHeatmap,
    topTools: buildTopItems(
      Array.from(toolTotals, ([source, totalTokens]) => ({
        name: getUsageSourceLabel(source),
        totalTokens,
      })),
    ),
    topModels: buildTopItems(modelTotals),
    overview: {
      totalTokens,
      estimatedCostUsd,
      activeSeconds: sessionTotals._sum.activeSeconds ?? 0,
      sessions: sessionTotals._count._all,
    },
  };
}

/** Rank pre-aggregated rows and attach each one's share of the total. */
function buildTopItems(rows: Array<{ name: string; totalTokens: number }>) {
  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0);

  return rows
    .reduce<Array<{ name: string; totalTokens: number; share: number }>>(
      (acc, row) => {
        // Dropping the empty rows first means `total` is always positive here.
        if (row.totalTokens > 0) {
          acc.push({
            name: row.name,
            totalTokens: row.totalTokens,
            share: row.totalTokens / total,
          });
        }

        return acc;
      },
      [],
    )
    .sort((left, right) => right.totalTokens - left.totalTokens)
    .slice(0, 5);
}

function normalizeUsageBucketTokenFields<
  T extends {
    totalTokens?: number | bigint | null;
    inputTokens?: number | bigint | null;
    outputTokens?: number | bigint | null;
    reasoningTokens?: number | bigint | null;
    cachedTokens?: number | bigint | null;
    cacheCreationTokens?: number | bigint | null;
  },
>(bucket: T) {
  return {
    ...bucket,
    ...(bucket.totalTokens === undefined
      ? {}
      : { totalTokens: tokenCountToNumber(bucket.totalTokens) }),
    ...(bucket.inputTokens === undefined
      ? {}
      : { inputTokens: tokenCountToNumber(bucket.inputTokens) }),
    ...(bucket.outputTokens === undefined
      ? {}
      : { outputTokens: tokenCountToNumber(bucket.outputTokens) }),
    ...(bucket.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: tokenCountToNumber(bucket.reasoningTokens) }),
    ...(bucket.cachedTokens === undefined
      ? {}
      : { cachedTokens: tokenCountToNumber(bucket.cachedTokens) }),
    ...(bucket.cacheCreationTokens === undefined
      ? {}
      : {
          cacheCreationTokens: tokenCountToNumber(bucket.cacheCreationTokens),
        }),
  };
}

export async function getPublicProfileActivityShareData(input: {
  username: string;
}): Promise<PublicProfileActivityShareData | null> {
  const user = await prisma.user.findUnique({
    where: {
      username: normalizeUsername(input.username),
    },
    select: profileUserSelect,
  });

  if (!user?.usagePreference?.publicProfileEnabled) {
    return null;
  }

  const timezone = user.usagePreference?.timezone ?? "UTC";
  const heatmap = await getActivityHeatmap365({
    userId: user.id,
    timezone,
  });

  return {
    username: user.username,
    timezone,
    heatmap,
    summary: {
      activeDays: heatmap.filter((day) => day.activeSeconds > 0).length,
      activeSeconds: heatmap.reduce((sum, day) => sum + day.activeSeconds, 0),
    },
  };
}

export async function getPublicProfilePageData(input: {
  username: string;
  viewerUserId?: string | null;
  range?: ProfileRangeQuery;
}): Promise<PublicProfilePageData | null> {
  const user = await prisma.user.findUnique({
    where: {
      username: normalizeUsername(input.username),
    },
    select: profileUserSelect,
  });

  if (!user) {
    return null;
  }

  const publicProfileEnabled =
    user.usagePreference?.publicProfileEnabled ?? false;
  const isSelf = input.viewerUserId === user.id;

  if (!publicProfileEnabled && !isSelf) {
    return null;
  }

  const timezone = user.usagePreference?.timezone ?? "UTC";
  const selection = resolveProfileRange({ query: input.range, timezone });
  const [relationFlags, linkedAccounts, usageSnapshot] = await Promise.all([
    getRelationFlags(input.viewerUserId, user.id),
    prisma.account.findMany({
      where: {
        userId: user.id,
        providerId: { in: [...LINKED_PROFILE_PROVIDER_IDS] },
      },
      select: { providerId: true, accountId: true, accessToken: true },
    }),
    loadPublicProfileUsageSnapshot({
      userId: user.id,
      timezone,
      range: selection.range,
    }),
  ]);

  // Both of these read materialized rows (`UserArenaSummary`,
  // `UserAchievement`) rather than replaying the user's history: a public
  // profile is reachable by anyone, so nothing on this path may scale with how
  // much the account has ever synced.
  const [arenaSummary, achievementWall] = await Promise.all([
    getArenaSummaryForProfile(user.id),
    getProfileAchievementWall(user.id, 5),
  ]);

  const pickedLinked = pickLinkedAccount(linkedAccounts);
  let linkedIdentity: PublicProfilePageData["linkedIdentity"] = null;
  if (pickedLinked) {
    const profileUrl = await resolveLinkedProfileUrl(
      pickedLinked.providerId,
      pickedLinked.accountId,
      pickedLinked.accessToken,
    );
    if (profileUrl) {
      linkedIdentity = {
        providerId: pickedLinked.providerId,
        profileUrl,
      };
    }
  }

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    image: user.image,
    bio: user.usagePreference?.bio ?? null,
    createdAt: user.createdAt,
    publicProfileEnabled,
    timezone,
    followerCount: user._count.followers,
    followingCount: user._count.following,
    isFollowing: relationFlags.isFollowing,
    followTag: relationFlags.followTag,
    followsYou: relationFlags.followsYou,
    isSelf,
    range: {
      preset: selection.preset,
      from: selection.range?.from.toISOString() ?? null,
      to: selection.range?.to.toISOString() ?? null,
      timezone,
    },
    overview: {
      // The arena score and active-day streak stay lifetime metrics: they back
      // the level badge, which a range filter must not appear to change.
      arenaScore: arenaSummary.score,
      arenaLevel: arenaSummary.level,
      activeDays: arenaSummary.totalActiveDays,
      ...usageSnapshot.overview,
    },
    heatmap: usageSnapshot.activityHeatmap,
    topTools: usageSnapshot.topTools,
    topModels: usageSnapshot.topModels,
    achievementWall,
    linkedIdentity,
  };
}

export async function searchPublicProfiles(input: {
  query?: string;
  viewerUserId?: string | null;
  limit?: number;
  offset?: number;
}) {
  const query = input.query?.trim();
  const users = await prisma.user.findMany({
    where: {
      AND: [
        input.viewerUserId
          ? {
              OR: [
                {
                  usagePreference: {
                    is: {
                      publicProfileEnabled: true,
                    },
                  },
                },
                {
                  id: input.viewerUserId,
                },
              ],
            }
          : {
              usagePreference: {
                is: {
                  publicProfileEnabled: true,
                },
              },
            },
        query
          ? {
              OR: [
                {
                  username: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
                {
                  name: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {},
      ],
    },
    orderBy: query ? { username: "asc" } : { createdAt: "desc" },
    skip: input.offset ?? 0,
    take: input.limit,
    select: profileUserSelect,
  });

  const ids = users.map((user) => user.id);

  if (!input.viewerUserId || ids.length === 0) {
    return users.map((user) =>
      mapUserToListProfile(
        user,
        {
          isFollowing: false,
          followTag: null,
          followsYou: false,
        },
        input.viewerUserId,
      ),
    );
  }

  const [following, followers] = await Promise.all([
    prisma.follow.findMany({
      where: {
        followerId: input.viewerUserId,
        followingId: {
          in: ids,
        },
      },
      select: {
        followingId: true,
        tag: true,
      },
    }),
    prisma.follow.findMany({
      where: {
        followerId: {
          in: ids,
        },
        followingId: input.viewerUserId,
      },
      select: {
        followerId: true,
      },
    }),
  ]);

  const relationMap = mapRelationFlags(ids, following, followers);

  return users.map((user) =>
    mapUserToListProfile(
      user,
      relationMap.get(user.id) ?? {
        isFollowing: false,
        followTag: null,
        followsYou: false,
      },
      input.viewerUserId,
    ),
  );
}

export async function countPublicProfiles(input: {
  query?: string;
  viewerUserId?: string | null;
}) {
  const query = input.query?.trim();

  return prisma.user.count({
    where: {
      AND: [
        input.viewerUserId
          ? {
              OR: [
                {
                  usagePreference: {
                    is: {
                      publicProfileEnabled: true,
                    },
                  },
                },
                {
                  id: input.viewerUserId,
                },
              ],
            }
          : {
              usagePreference: {
                is: {
                  publicProfileEnabled: true,
                },
              },
            },
        query
          ? {
              OR: [
                {
                  username: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
                {
                  name: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {},
      ],
    },
  });
}

type NetworkProfileQuery = {
  viewerUserId: string;
  query?: string;
};

type NetworkProfilePageQuery = NetworkProfileQuery & {
  limit: number;
  offset: number;
};

function buildNetworkProfileSearch(
  query?: string,
): Prisma.UserWhereInput | null {
  const search = query?.trim();
  if (!search) return null;

  return {
    OR: [
      { username: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      {
        usagePreference: {
          is: { bio: { contains: search, mode: "insensitive" } },
        },
      },
    ],
  };
}

function buildFollowingWhere(
  input: NetworkProfileQuery,
): Prisma.FollowWhereInput {
  const search = buildNetworkProfileSearch(input.query);
  return {
    followerId: input.viewerUserId,
    ...(search ? { following: { is: search } } : {}),
  };
}

function buildFollowerWhere(
  input: NetworkProfileQuery,
): Prisma.FollowWhereInput {
  const search = buildNetworkProfileSearch(input.query);
  return {
    followingId: input.viewerUserId,
    ...(search ? { follower: { is: search } } : {}),
  };
}

export async function countFollowingProfiles(input: NetworkProfileQuery) {
  return prisma.follow.count({ where: buildFollowingWhere(input) });
}

export async function listFollowingProfiles(input: NetworkProfilePageQuery) {
  const rows = await prisma.follow.findMany({
    where: buildFollowingWhere(input),
    orderBy: {
      createdAt: "desc",
    },
    skip: input.offset,
    take: input.limit,
    select: {
      tag: true,
      following: {
        select: profileUserSelect,
      },
    },
  });

  const ids = rows.map((row) => row.following.id);
  const reverse = ids.length
    ? await prisma.follow.findMany({
        where: {
          followerId: { in: ids },
          followingId: input.viewerUserId,
        },
        select: { followerId: true },
      })
    : [];
  const reverseSet = new Set(reverse.map((record) => record.followerId));

  return rows.map((row) =>
    mapUserToListProfile(
      row.following,
      {
        isFollowing: true,
        followTag: row.tag,
        followsYou: reverseSet.has(row.following.id),
      },
      input.viewerUserId,
    ),
  );
}

export async function countFollowerProfiles(input: NetworkProfileQuery) {
  return prisma.follow.count({ where: buildFollowerWhere(input) });
}

export async function listFollowerProfiles(input: NetworkProfilePageQuery) {
  const rows = await prisma.follow.findMany({
    where: buildFollowerWhere(input),
    orderBy: {
      createdAt: "desc",
    },
    skip: input.offset,
    take: input.limit,
    select: {
      follower: {
        select: profileUserSelect,
      },
    },
  });

  const ids = rows.map((row) => row.follower.id);
  const direct = ids.length
    ? await prisma.follow.findMany({
        where: {
          followerId: input.viewerUserId,
          followingId: { in: ids },
        },
        select: { followingId: true, tag: true },
      })
    : [];
  const directMap = new Map(
    direct.map((record) => [record.followingId, record.tag] as const),
  );

  return rows.map((row) =>
    mapUserToListProfile(
      row.follower,
      {
        isFollowing: directMap.has(row.follower.id),
        followTag: directMap.get(row.follower.id) ?? null,
        followsYou: true,
      },
      input.viewerUserId,
    ),
  );
}
