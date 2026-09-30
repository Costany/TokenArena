import "server-only";

import { getPricingCatalog } from "@/lib/pricing/catalog";
import {
  estimateCostUsd,
  resolveOfficialPricingMatch,
  resolveOfficialPricingProvider,
} from "@/lib/pricing/resolve";
import { prisma } from "@/lib/prisma";
import { tokenCountToNumber } from "@/lib/token-counts";
import {
  getPreviousRange,
  getZonedWeekdayHour,
  groupByHourOrDay,
  listRangeBuckets,
} from "./date-range";
import {
  getUsageSourceFilter,
  getUsageSourceLabel,
  normalizeUsageSource,
} from "./sources";
import type {
  ActivityTrendPoint,
  BreakdownRow,
  DashboardRange,
  FilterOption,
  HourlyActivityHeatmapCell,
  ModelPricingRow,
  TokenTrendPoint,
  UsageBreakdowns,
  UsageFilterOptions,
  UsageFilters,
  UsageMetricTotals,
  UsageOverviewMetrics,
  UsagePricingSummary,
  UsageSessionRow,
} from "./types";

const USAGE_READ_PAGE_SIZE = 1_000;
/**
 * Ceiling on rows a single dashboard read may pull into memory.
 *
 * The range is already capped (see `MAX_CUSTOM_RANGE_DAYS`), but a heavy account
 * can still exceed that within the window, and every row here is summed
 * in-process. Dashboard callers display a partial-data warning when this limit
 * is reached. Other callers fail rather than return totals that look complete.
 */
export const USAGE_READ_MAX_ROWS = 200_000;

export async function loadUsagePages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<T[]>,
  onTruncated?: () => void,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await fetchPage(cursor);
    rows.push(...page);
    // Read one page past the cap so exactly MAX_ROWS records remain complete.
    if (rows.length > USAGE_READ_MAX_ROWS) {
      if (!onTruncated) {
        throw new Error(
          `Usage range exceeds the ${USAGE_READ_MAX_ROWS}-row read limit; narrow the range or filters.`,
        );
      }
      onTruncated();
      return rows.slice(0, USAGE_READ_MAX_ROWS);
    }
    if (page.length < USAGE_READ_PAGE_SIZE) return rows;
    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor)
      throw new Error("Usage pagination did not advance");
    cursor = nextCursor;
  }
}
const DASHBOARD_SESSION_PAGE_SIZE = 50;

type UsageQueryInput = {
  userId: string;
  range: DashboardRange;
  filters: UsageFilters;
};

function applyBucketFilters<T extends Record<string, unknown>>(
  input: T,
  filters: UsageFilters,
) {
  return {
    ...input,
    ...(filters.apiKeyId ? { apiKeyId: filters.apiKeyId } : {}),
    ...(filters.deviceId ? { deviceId: filters.deviceId } : {}),
    ...(filters.source ? { source: getUsageSourceFilter(filters.source) } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.projectKey ? { projectKey: filters.projectKey } : {}),
  };
}

function applySessionFilters<T extends Record<string, unknown>>(
  input: T,
  filters: UsageFilters,
) {
  // Note: UsageSession doesn't have a `model` field, so we exclude it here
  return {
    ...input,
    ...(filters.apiKeyId ? { apiKeyId: filters.apiKeyId } : {}),
    ...(filters.deviceId ? { deviceId: filters.deviceId } : {}),
    ...(filters.source ? { source: getUsageSourceFilter(filters.source) } : {}),
    ...(filters.projectKey ? { projectKey: filters.projectKey } : {}),
  };
}

async function loadBuckets(
  input: {
    userId: string;
    range: DashboardRange;
    filters: UsageFilters;
  },
  onTruncated?: () => void,
) {
  const rows = await loadUsagePages(
    (cursor) =>
      prisma.usageBucket.findMany({
        where: applyBucketFilters(
          {
            userId: input.userId,
            bucketStart: {
              gte: input.range.from,
              lte: input.range.to,
            },
          },
          input.filters,
        ),
        select: {
          id: true,
          deviceId: true,
          source: true,
          model: true,
          projectKey: true,
          projectLabel: true,
          bucketStart: true,
          totalTokens: true,
          inputTokens: true,
          outputTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          cacheCreationTokens: true,
        },
        orderBy: { id: "asc" },
        take: USAGE_READ_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    onTruncated,
  );

  return rows.map((bucket) => ({
    ...bucket,
    totalTokens: tokenCountToNumber(bucket.totalTokens),
    inputTokens: tokenCountToNumber(bucket.inputTokens),
    outputTokens: tokenCountToNumber(bucket.outputTokens),
    reasoningTokens: tokenCountToNumber(bucket.reasoningTokens),
    cachedTokens: tokenCountToNumber(bucket.cachedTokens),
    cacheCreationTokens: tokenCountToNumber(bucket.cacheCreationTokens),
  }));
}

async function loadSessions(
  input: {
    userId: string;
    range: DashboardRange;
    filters: UsageFilters;
  },
  onTruncated?: () => void,
) {
  return loadUsagePages(
    (cursor) =>
      prisma.usageSession.findMany({
        where: applySessionFilters(
          {
            userId: input.userId,
            firstMessageAt: {
              gte: input.range.from,
              lte: input.range.to,
            },
          },
          input.filters,
        ),
        select: {
          id: true,
          deviceId: true,
          source: true,
          projectKey: true,
          projectLabel: true,
          firstMessageAt: true,
          durationSeconds: true,
          activeSeconds: true,
          messageCount: true,
          userMessageCount: true,
        },
        orderBy: { id: "asc" },
        take: USAGE_READ_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    onTruncated,
  );
}

async function loadRecentSessions(input: UsageQueryInput) {
  return prisma.usageSession.findMany({
    where: applySessionFilters(
      {
        userId: input.userId,
        firstMessageAt: {
          gte: input.range.from,
          lte: input.range.to,
        },
      },
      input.filters,
    ),
    orderBy: [{ firstMessageAt: "desc" }, { lastMessageAt: "desc" }],
    take: DASHBOARD_SESSION_PAGE_SIZE,
    select: {
      id: true,
      sessionHash: true,
      source: true,
      projectKey: true,
      projectLabel: true,
      deviceId: true,
      firstMessageAt: true,
      lastMessageAt: true,
      durationSeconds: true,
      activeSeconds: true,
      inputTokens: true,
      outputTokens: true,
      reasoningTokens: true,
      cachedTokens: true,
      cacheCreationTokens: true,
      totalTokens: true,
      primaryModel: true,
      estimatedCostUsd: true,
      messageCount: true,
      userMessageCount: true,
    },
  });
}

type UsageBucketRecord = Awaited<ReturnType<typeof loadBuckets>>[number];
type UsageSessionRecord = Awaited<ReturnType<typeof loadSessions>>[number];

function estimateBucketCostUsd(
  bucket: Pick<
    UsageBucketRecord,
    | "model"
    | "inputTokens"
    | "outputTokens"
    | "reasoningTokens"
    | "cachedTokens"
    | "cacheCreationTokens"
  >,
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
) {
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

function emptyTotals(): UsageMetricTotals {
  return {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheCreationTokens: 0,
    activeSeconds: 0,
    totalSeconds: 0,
    sessions: 0,
    messages: 0,
    userMessages: 0,
  };
}

function summarizeTotals(input: {
  buckets: UsageBucketRecord[];
  sessions: UsageSessionRecord[];
}): UsageMetricTotals {
  const totals = emptyTotals();

  for (const bucket of input.buckets) {
    totals.totalTokens += bucket.totalTokens;
    totals.inputTokens += bucket.inputTokens;
    totals.outputTokens += bucket.outputTokens;
    totals.reasoningTokens += bucket.reasoningTokens;
    totals.cachedTokens += bucket.cachedTokens;
    totals.cacheCreationTokens += bucket.cacheCreationTokens ?? 0;
  }

  totals.sessions = input.sessions.length;

  for (const session of input.sessions) {
    totals.activeSeconds += session.activeSeconds;
    totals.totalSeconds += session.durationSeconds;
    totals.messages += session.messageCount;
    totals.userMessages += session.userMessageCount;
  }

  return totals;
}

function toOverview(
  current: UsageMetricTotals,
  previous: UsageMetricTotals,
): UsageOverviewMetrics {
  return {
    totalTokens: {
      current: current.totalTokens,
      previous: previous.totalTokens,
      delta: current.totalTokens - previous.totalTokens,
    },
    inputTokens: {
      current: current.inputTokens,
      previous: previous.inputTokens,
      delta: current.inputTokens - previous.inputTokens,
    },
    outputTokens: {
      current: current.outputTokens,
      previous: previous.outputTokens,
      delta: current.outputTokens - previous.outputTokens,
    },
    reasoningTokens: {
      current: current.reasoningTokens,
      previous: previous.reasoningTokens,
      delta: current.reasoningTokens - previous.reasoningTokens,
    },
    cachedTokens: {
      current: current.cachedTokens,
      previous: previous.cachedTokens,
      delta: current.cachedTokens - previous.cachedTokens,
    },
    cacheCreationTokens: {
      current: current.cacheCreationTokens,
      previous: previous.cacheCreationTokens,
      delta: current.cacheCreationTokens - previous.cacheCreationTokens,
    },
    activeSeconds: {
      current: current.activeSeconds,
      previous: previous.activeSeconds,
      delta: current.activeSeconds - previous.activeSeconds,
    },
    totalSeconds: {
      current: current.totalSeconds,
      previous: previous.totalSeconds,
      delta: current.totalSeconds - previous.totalSeconds,
    },
    sessions: {
      current: current.sessions,
      previous: previous.sessions,
      delta: current.sessions - previous.sessions,
    },
    messages: {
      current: current.messages,
      previous: previous.messages,
      delta: current.messages - previous.messages,
    },
    userMessages: {
      current: current.userMessages,
      previous: previous.userMessages,
      delta: current.userMessages - previous.userMessages,
    },
  };
}

export async function getOverviewMetrics(input: {
  userId: string;
  range: DashboardRange;
  filters: UsageFilters;
}) {
  const previousRange = getPreviousRange(input.range);
  const [currentBuckets, currentSessions, previousBuckets, previousSessions] =
    await Promise.all([
      loadBuckets(input),
      loadSessions(input),
      loadBuckets({ ...input, range: previousRange }),
      loadSessions({ ...input, range: previousRange }),
    ]);

  return buildOverviewMetrics({
    currentBuckets,
    currentSessions,
    previousBuckets,
    previousSessions,
  });
}

function buildOverviewMetrics(input: {
  currentBuckets: UsageBucketRecord[];
  currentSessions: UsageSessionRecord[];
  previousBuckets: UsageBucketRecord[];
  previousSessions: UsageSessionRecord[];
}) {
  return toOverview(
    summarizeTotals({
      buckets: input.currentBuckets,
      sessions: input.currentSessions,
    }),
    summarizeTotals({
      buckets: input.previousBuckets,
      sessions: input.previousSessions,
    }),
  );
}

export async function getTokenTrend(input: UsageQueryInput) {
  const [catalog, buckets, sessions] = await Promise.all([
    getPricingCatalog(),
    loadBuckets(input),
    loadSessions(input),
  ]);

  return buildTokenTrend(input, catalog, buckets, sessions);
}

function buildTokenTrend(
  input: UsageQueryInput,
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
  buckets: UsageBucketRecord[],
  sessions: UsageSessionRecord[],
) {
  const seeded = new Map<string, TokenTrendPoint>(
    listRangeBuckets(input.range).map((bucket) => [
      bucket.key,
      {
        label: bucket.label,
        start: bucket.start.toISOString(),
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        estimatedCostUsd: 0,
        totalSeconds: 0,
      },
    ]),
  );

  for (const bucket of buckets) {
    const key = groupByHourOrDay(input.range, bucket.bucketStart);
    const point = seeded.get(key);

    if (!point) {
      continue;
    }

    point.totalTokens += bucket.totalTokens;
    point.inputTokens += bucket.inputTokens;
    point.outputTokens += bucket.outputTokens;
    point.reasoningTokens += bucket.reasoningTokens;
    point.cachedTokens += bucket.cachedTokens;
    point.cacheCreationTokens += bucket.cacheCreationTokens ?? 0;
    point.estimatedCostUsd += estimateBucketCostUsd(bucket, catalog);
  }

  for (const session of sessions) {
    const key = groupByHourOrDay(input.range, session.firstMessageAt);
    const point = seeded.get(key);

    if (!point) {
      continue;
    }

    point.totalSeconds += session.durationSeconds;
  }

  return Array.from(seeded.values());
}

export async function getActivityTrend(input: UsageQueryInput) {
  const sessions = await loadSessions(input);
  return buildActivityTrend(input, sessions);
}

function buildActivityTrend(
  input: UsageQueryInput,
  sessions: UsageSessionRecord[],
) {
  const seeded = new Map<string, ActivityTrendPoint>(
    listRangeBuckets(input.range).map((bucket) => [
      bucket.key,
      {
        label: bucket.label,
        start: bucket.start.toISOString(),
        activeSeconds: 0,
        totalSeconds: 0,
        sessions: 0,
        messages: 0,
        userMessages: 0,
      },
    ]),
  );

  for (const session of sessions) {
    const key = groupByHourOrDay(input.range, session.firstMessageAt);
    const point = seeded.get(key);

    if (!point) {
      continue;
    }

    point.activeSeconds += session.activeSeconds;
    point.totalSeconds += session.durationSeconds;
    point.sessions += 1;
    point.messages += session.messageCount;
    point.userMessages += session.userMessageCount;
  }

  return Array.from(seeded.values());
}

function createHourlyHeatmapCells() {
  const cells: HourlyActivityHeatmapCell[] = [];

  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.push({
        weekday,
        hour,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        activeSeconds: 0,
        sessions: 0,
      });
    }
  }

  return cells;
}

function getHourlyHeatmapCell(
  cells: HourlyActivityHeatmapCell[],
  weekday: number,
  hour: number,
) {
  return cells[weekday * 24 + hour];
}

export async function getHourlyActivityHeatmap(input: UsageQueryInput) {
  const [catalog, buckets, sessions] = await Promise.all([
    getPricingCatalog(),
    loadBuckets(input),
    loadSessions(input),
  ]);
  return buildHourlyActivityHeatmap(input, catalog, buckets, sessions);
}

function buildHourlyActivityHeatmap(
  input: UsageQueryInput,
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
  buckets: UsageBucketRecord[],
  sessions: UsageSessionRecord[],
) {
  const cells = createHourlyHeatmapCells();

  for (const bucket of buckets) {
    const { weekday, hour } = getZonedWeekdayHour(
      bucket.bucketStart,
      input.range.timezone,
    );
    const cell = getHourlyHeatmapCell(cells, weekday, hour);

    if (!cell) {
      continue;
    }

    cell.inputTokens += bucket.inputTokens;
    cell.outputTokens += bucket.outputTokens;
    cell.totalTokens += bucket.totalTokens;
    cell.estimatedCostUsd += estimateBucketCostUsd(bucket, catalog);
  }

  for (const session of sessions) {
    const { weekday, hour } = getZonedWeekdayHour(
      session.firstMessageAt,
      input.range.timezone,
    );
    const cell = getHourlyHeatmapCell(cells, weekday, hour);

    if (!cell) {
      continue;
    }

    cell.activeSeconds += session.activeSeconds;
    cell.sessions += 1;
  }

  return cells;
}

function finalizeBreakdownRows(rows: Map<string, BreakdownRow>) {
  const values = Array.from(rows.values()).sort(
    (left, right) => right.totalTokens - left.totalTokens,
  );
  const totalTokens = values.reduce((sum, row) => sum + row.totalTokens, 0);

  for (const row of values) {
    row.share = totalTokens === 0 ? 0 : row.totalTokens / totalTokens;
  }

  return values;
}

function ensureBreakdownRow(
  rows: Map<string, BreakdownRow>,
  key: string,
  name: string,
): BreakdownRow {
  const existing = rows.get(key);

  if (existing) {
    return existing;
  }

  const next: BreakdownRow = {
    key,
    name,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    cacheCreationTokens: 0,
    estimatedCostUsd: 0,
    activeSeconds: 0,
    totalSeconds: 0,
    sessions: 0,
    messages: 0,
    userMessages: 0,
    share: 0,
  };

  rows.set(key, next);

  return next;
}

function buildDeviceDisplayLabels(
  devices: Array<{ deviceId: string; hostname: string }>,
) {
  const hostnameCounts = new Map<string, number>();

  for (const device of devices) {
    hostnameCounts.set(
      device.hostname,
      (hostnameCounts.get(device.hostname) ?? 0) + 1,
    );
  }

  return new Map(
    devices.map((device) => [
      device.deviceId,
      (hostnameCounts.get(device.hostname) ?? 0) > 1
        ? `${device.hostname} · ${device.deviceId.slice(0, 8)}`
        : device.hostname,
    ]),
  );
}

export async function getBreakdowns(
  input: UsageQueryInput,
): Promise<UsageBreakdowns> {
  const [catalog, buckets, sessions, devices] = await Promise.all([
    getPricingCatalog(),
    loadBuckets(input),
    loadSessions(input),
    prisma.device.findMany({
      where: {
        userId: input.userId,
      },
      select: {
        deviceId: true,
        hostname: true,
      },
    }),
  ]);

  return buildBreakdowns(catalog, buckets, sessions, devices);
}

function buildBreakdowns(
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
  buckets: UsageBucketRecord[],
  sessions: UsageSessionRecord[],
  devices: UsageSessionDevice[],
): UsageBreakdowns {
  const deviceLabels = buildDeviceDisplayLabels(devices);
  const byDevice = new Map<string, BreakdownRow>();
  const byTool = new Map<string, BreakdownRow>();
  const byModel = new Map<string, BreakdownRow>();
  const byProject = new Map<string, BreakdownRow>();

  for (const bucket of buckets) {
    const deviceRow = ensureBreakdownRow(
      byDevice,
      bucket.deviceId,
      deviceLabels.get(bucket.deviceId) ?? bucket.deviceId,
    );
    const toolRow = ensureBreakdownRow(
      byTool,
      normalizeUsageSource(bucket.source),
      getUsageSourceLabel(bucket.source),
    );
    const modelRow = ensureBreakdownRow(byModel, bucket.model, bucket.model);
    const projectRow = ensureBreakdownRow(
      byProject,
      bucket.projectKey,
      bucket.projectLabel,
    );
    const estimatedCostUsd = estimateBucketCostUsd(bucket, catalog);

    for (const row of [deviceRow, toolRow, modelRow, projectRow]) {
      row.totalTokens += bucket.totalTokens;
      row.inputTokens += bucket.inputTokens;
      row.outputTokens += bucket.outputTokens;
      row.reasoningTokens += bucket.reasoningTokens;
      row.cachedTokens += bucket.cachedTokens;
      row.cacheCreationTokens += bucket.cacheCreationTokens ?? 0;
      row.estimatedCostUsd += estimatedCostUsd;
    }
  }

  for (const session of sessions) {
    const deviceRow = ensureBreakdownRow(
      byDevice,
      session.deviceId,
      deviceLabels.get(session.deviceId) ?? session.deviceId,
    );
    const toolRow = ensureBreakdownRow(
      byTool,
      normalizeUsageSource(session.source),
      getUsageSourceLabel(session.source),
    );
    const projectRow = ensureBreakdownRow(
      byProject,
      session.projectKey,
      session.projectLabel,
    );

    for (const row of [deviceRow, toolRow, projectRow]) {
      row.activeSeconds += session.activeSeconds;
      row.totalSeconds += session.durationSeconds;
      row.sessions += 1;
      row.messages += session.messageCount;
      row.userMessages += session.userMessageCount;
    }
  }

  return {
    devices: finalizeBreakdownRows(byDevice),
    tools: finalizeBreakdownRows(byTool),
    models: finalizeBreakdownRows(byModel),
    projects: finalizeBreakdownRows(byProject),
  };
}

function buildModelPricingRows(
  buckets: UsageBucketRecord[],
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
): ModelPricingRow[] {
  const byModel = new Map<string, ModelPricingRow>();

  for (const bucket of buckets) {
    const existing = byModel.get(bucket.model);

    if (existing) {
      existing.totalTokens += bucket.totalTokens;
      existing.inputTokens += bucket.inputTokens;
      existing.outputTokens += bucket.outputTokens;
      existing.reasoningTokens += bucket.reasoningTokens;
      existing.cachedTokens += bucket.cachedTokens;
      existing.cacheCreationTokens += bucket.cacheCreationTokens ?? 0;
      continue;
    }

    byModel.set(bucket.model, {
      rawModel: bucket.model,
      pricingProviderId: null,
      pricingProviderName: null,
      matchedModelId: null,
      matchedModelName: null,
      inputRateUsdPerMillion: null,
      outputRateUsdPerMillion: null,
      reasoningRateUsdPerMillion: null,
      cacheRateUsdPerMillion: null,
      cacheCreationRateUsdPerMillion: null,
      totalTokens: bucket.totalTokens,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      reasoningTokens: bucket.reasoningTokens,
      cachedTokens: bucket.cachedTokens,
      cacheCreationTokens: bucket.cacheCreationTokens ?? 0,
      estimatedCostUsd: null,
      estimatedInputUsd: null,
      estimatedOutputUsd: null,
      estimatedReasoningUsd: null,
      estimatedCacheUsd: null,
      estimatedCacheCreationUsd: null,
    });
  }

  const rows = Array.from(byModel.values());

  for (const row of rows) {
    const provider = resolveOfficialPricingProvider(catalog, row.rawModel);
    row.pricingProviderId = provider?.providerId ?? null;
    row.pricingProviderName = provider?.providerName ?? null;

    const match = resolveOfficialPricingMatch(catalog, row.rawModel);

    if (!match) {
      continue;
    }

    const estimate = estimateCostUsd(
      {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens,
        cachedTokens: row.cachedTokens,
        cacheCreationTokens: row.cacheCreationTokens ?? 0,
      },
      match.cost,
    );

    row.pricingProviderId = match.providerId;
    row.pricingProviderName = match.providerName;
    row.matchedModelId = match.modelId;
    row.matchedModelName = match.modelName;
    row.inputRateUsdPerMillion = match.cost?.input ?? null;
    row.outputRateUsdPerMillion = match.cost?.output ?? null;
    row.reasoningRateUsdPerMillion = match.cost?.reasoning ?? null;
    row.cacheRateUsdPerMillion = match.cost?.cache_read ?? null;
    row.cacheCreationRateUsdPerMillion =
      match.cost?.cache_write ?? match.cost?.input ?? null;
    row.estimatedCostUsd = estimate?.totalUsd ?? null;
    row.estimatedInputUsd = estimate?.inputUsd ?? null;
    row.estimatedOutputUsd = estimate?.outputUsd ?? null;
    row.estimatedReasoningUsd = estimate?.reasoningUsd ?? null;
    row.estimatedCacheUsd = estimate?.cacheUsd ?? null;
    row.estimatedCacheCreationUsd = estimate?.cacheCreationUsd ?? null;
  }

  return rows.sort((left, right) => {
    const rightCost = right.estimatedCostUsd ?? -1;
    const leftCost = left.estimatedCostUsd ?? -1;

    if (rightCost !== leftCost) {
      return rightCost - leftCost;
    }

    if (right.totalTokens !== left.totalTokens) {
      return right.totalTokens - left.totalTokens;
    }

    return left.rawModel.localeCompare(right.rawModel);
  });
}

function summarizePricingRows(
  currentRows: ModelPricingRow[],
  previousRows: ModelPricingRow[],
): UsagePricingSummary {
  const currentUsd = currentRows.reduce(
    (sum, row) => sum + (row.estimatedCostUsd ?? 0),
    0,
  );
  const previousUsd = previousRows.reduce(
    (sum, row) => sum + (row.estimatedCostUsd ?? 0),
    0,
  );
  const pricedTokens = currentRows.reduce(
    (sum, row) => sum + (row.estimatedCostUsd == null ? 0 : row.totalTokens),
    0,
  );
  const totalTokens = currentRows.reduce(
    (sum, row) => sum + row.totalTokens,
    0,
  );
  const pricedModels = currentRows.filter(
    (row) => row.estimatedCostUsd != null,
  ).length;

  return {
    currentUsd,
    previousUsd,
    deltaUsd: currentUsd - previousUsd,
    pricedTokens,
    totalTokens,
    coverage: totalTokens === 0 ? 0 : pricedTokens / totalTokens,
    pricedModels,
    totalModels: currentRows.length,
  };
}

type UsageSessionDevice = {
  deviceId: string;
  hostname: string;
};

type UsageSessionDisplayRecord = Awaited<
  ReturnType<typeof loadRecentSessions>
>[number];

function mapSessionRows(
  sessions: UsageSessionDisplayRecord[],
  devices: UsageSessionDevice[],
  limit = DASHBOARD_SESSION_PAGE_SIZE,
): UsageSessionRow[] {
  const deviceLabels = buildDeviceDisplayLabels(devices);

  return sessions.slice(0, limit).map((session) => ({
    id: session.id,
    sessionHash: session.sessionHash,
    source: session.source,
    projectKey: session.projectKey,
    projectLabel: session.projectLabel,
    deviceId: session.deviceId,
    deviceLabel: deviceLabels.get(session.deviceId) ?? session.deviceId,
    firstMessageAt: session.firstMessageAt.toISOString(),
    lastMessageAt: session.lastMessageAt.toISOString(),
    durationSeconds: session.durationSeconds,
    activeSeconds: session.activeSeconds,
    messageCount: session.messageCount,
    userMessageCount: session.userMessageCount,
    estimatedCostUsd: session.estimatedCostUsd,
    totalTokens: tokenCountToNumber(session.totalTokens),
    inputTokens: tokenCountToNumber(session.inputTokens),
    outputTokens: tokenCountToNumber(session.outputTokens),
    reasoningTokens: tokenCountToNumber(session.reasoningTokens),
    cachedTokens: tokenCountToNumber(session.cachedTokens),
    cacheCreationTokens: tokenCountToNumber(session.cacheCreationTokens),
    primaryModel: session.primaryModel,
  }));
}

export async function getPricingSummaryAndRows(input: {
  userId: string;
  range: DashboardRange;
  filters: UsageFilters;
}): Promise<{
  summary: UsagePricingSummary;
  modelPricingRows: ModelPricingRow[];
}> {
  const previousRange = getPreviousRange(input.range);
  const [catalog, currentBuckets, previousBuckets] = await Promise.all([
    getPricingCatalog(),
    loadBuckets(input),
    loadBuckets({ ...input, range: previousRange }),
  ]);

  return buildPricingSummaryAndRows(catalog, currentBuckets, previousBuckets);
}

function buildPricingSummaryAndRows(
  catalog: Awaited<ReturnType<typeof getPricingCatalog>>,
  currentBuckets: UsageBucketRecord[],
  previousBuckets: UsageBucketRecord[],
): {
  summary: UsagePricingSummary;
  modelPricingRows: ModelPricingRow[];
} {
  const modelPricingRows = buildModelPricingRows(currentBuckets, catalog);
  const previousRows = buildModelPricingRows(previousBuckets, catalog);

  return {
    summary: summarizePricingRows(modelPricingRows, previousRows),
    modelPricingRows,
  };
}

export async function getSessionRows(input: {
  userId: string;
  range: DashboardRange;
  filters: UsageFilters;
}): Promise<UsageSessionRow[]> {
  const [sessions, devices] = await Promise.all([
    loadRecentSessions(input),
    prisma.device.findMany({
      where: {
        userId: input.userId,
      },
      select: {
        deviceId: true,
        hostname: true,
      },
    }),
  ]);

  return mapSessionRows(sessions, devices);
}

/**
 * Load the bounded datasets shared by every dashboard panel once per request.
 * The standalone query functions above remain useful for focused callers, but
 * the full dashboard should not materialize the same buckets/sessions six
 * times in parallel.
 */
export async function getUsageDashboardSnapshot(input: UsageQueryInput) {
  const previousRange = getPreviousRange(input.range);
  let truncated = false;
  const markTruncated = () => {
    truncated = true;
  };
  const [
    catalog,
    currentBuckets,
    currentSessions,
    previousBuckets,
    previousSessions,
    recentSessions,
    devices,
  ] = await Promise.all([
    getPricingCatalog(),
    loadBuckets(input, markTruncated),
    loadSessions(input, markTruncated),
    loadBuckets({ ...input, range: previousRange }, markTruncated),
    loadSessions({ ...input, range: previousRange }, markTruncated),
    loadRecentSessions(input),
    prisma.device.findMany({
      where: { userId: input.userId },
      select: { deviceId: true, hostname: true },
    }),
  ]);

  const pricing = buildPricingSummaryAndRows(
    catalog,
    currentBuckets,
    previousBuckets,
  );

  return {
    truncated,
    overview: buildOverviewMetrics({
      currentBuckets,
      currentSessions,
      previousBuckets,
      previousSessions,
    }),
    tokenTrend: buildTokenTrend(
      input,
      catalog,
      currentBuckets,
      currentSessions,
    ),
    activityTrend: buildActivityTrend(input, currentSessions),
    hourlyActivityHeatmap: buildHourlyActivityHeatmap(
      input,
      catalog,
      currentBuckets,
      currentSessions,
    ),
    breakdowns: buildBreakdowns(
      catalog,
      currentBuckets,
      currentSessions,
      devices,
    ),
    pricingSummary: pricing.summary,
    modelPricingRows: pricing.modelPricingRows,
    // The table already paginates at 20 rows; keep its server payload bounded.
    sessions: mapSessionRows(recentSessions, devices),
  };
}

export async function getFilterOptions(
  userId: string,
): Promise<UsageFilterOptions> {
  const [apiKeys, devices, sourceRows, modelRows, projectRows] =
    await Promise.all([
      prisma.usageApiKey.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, status: true },
      }),
      prisma.device.findMany({
        where: { userId },
        orderBy: { lastSeenAt: "desc" },
        select: { deviceId: true, hostname: true },
      }),
      prisma.usageBucket.groupBy({
        by: ["source"],
        where: { userId },
      }),
      prisma.usageBucket.groupBy({
        by: ["model"],
        where: { userId },
      }),
      prisma.usageBucket.groupBy({
        by: ["projectKey", "projectLabel"],
        where: { userId },
      }),
    ]);
  const deviceLabels = buildDeviceDisplayLabels(devices);
  const projects = new Map<string, FilterOption>();

  for (const project of projectRows) {
    projects.set(project.projectKey, {
      value: project.projectKey,
      label: project.projectLabel,
    });
  }

  return {
    apiKeys,
    devices: devices.map((device) => ({
      value: device.deviceId,
      label: deviceLabels.get(device.deviceId) ?? device.hostname,
    })),
    sources: Array.from(
      new Set(sourceRows.map((row) => normalizeUsageSource(row.source))),
    )
      .map((source) => ({ value: source, label: getUsageSourceLabel(source) }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    models: modelRows
      .map((row) => ({ value: row.model, label: row.model }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    projects: Array.from(projects.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
  };
}

export async function getLastSyncedAt(userId: string) {
  const [bucket, session, device] = await Promise.all([
    prisma.usageBucket.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.usageSession.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.device.findFirst({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true },
    }),
  ]);

  const timestamps = [
    bucket?.updatedAt,
    session?.updatedAt,
    device?.lastSeenAt,
  ].reduce<number[]>((acc, d) => {
    if (d != null) {
      acc.push(d.getTime());
    }
    return acc;
  }, []);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
}
