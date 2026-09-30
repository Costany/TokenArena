import type { DashboardPreset, DashboardRange } from "./types";

export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type ResolveDashboardRangeInput = {
  preset?: DashboardPreset;
  from?: string | Date;
  to?: string | Date;
  timezone: string;
  now?: Date;
};

const zonedDateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const zonedWeekdayHourFormatterCache = new Map<string, Intl.DateTimeFormat>();
const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Widest span a `custom` range may cover, in days (a leap year).
 *
 * The dashboard loads raw buckets and sessions for the range and then sums them
 * in memory, so an unbounded `from` would pull a user's entire history — and
 * `getPreviousRange` doubles whatever span is chosen.
 */
export const MAX_CUSTOM_RANGE_DAYS = 366;

const MAX_CUSTOM_RANGE_MS = MAX_CUSTOM_RANGE_DAYS * 24 * 60 * 60 * 1000;

function getZonedFormatter(timezone: string) {
  const cached = zonedDateFormatterCache.get(timezone);

  if (cached) {
    return cached;
  }

  const formatter = Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  zonedDateFormatterCache.set(timezone, formatter);

  return formatter;
}

function getZonedWeekdayHourFormatter(timezone: string) {
  const cached = zonedWeekdayHourFormatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
  });
  zonedWeekdayHourFormatterCache.set(timezone, formatter);
  return formatter;
}

export function toZonedParts(date: Date, timezone: string): ZonedDateParts {
  const parts = getZonedFormatter(timezone).formatToParts(date);
  const values = Object.fromEntries(
    parts.reduce<[string, number][]>((acc, part) => {
      if (part.type !== "literal") {
        acc.push([part.type, Number.parseInt(part.value, 10)]);
      }
      return acc;
    }, []),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function getZonedWeekdayHour(date: Date, timezone: string) {
  let weekday = 0;
  let hour = 0;
  for (const part of getZonedWeekdayHourFormatter(timezone).formatToParts(
    date,
  )) {
    if (part.type === "weekday") {
      const index = weekdayIndex[part.value];
      if (index === undefined)
        throw new Error(`Unknown weekday: ${part.value}`);
      weekday = index;
    } else if (part.type === "hour") {
      hour = Number.parseInt(part.value, 10);
    }
  }
  return { weekday, hour };
}

function getTimezoneOffsetMs(date: Date, timezone: string) {
  const parts = toZonedParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

function isSameWallTime(date: Date, parts: ZonedDateParts, timezone: string) {
  const actual = toZonedParts(date, timezone);

  return (
    actual.year === parts.year &&
    actual.month === parts.month &&
    actual.day === parts.day &&
    actual.hour === parts.hour &&
    actual.minute === parts.minute &&
    actual.second === parts.second
  );
}

/**
 * The instant a wall-clock time names in `timezone`.
 *
 * The offsets in effect a day either side cover any transition near the wall
 * time. A time repeated when clocks go back resolves to its first occurrence,
 * and a time skipped when clocks go forward resolves to the instant right after
 * the gap, which is Temporal's "compatible" disambiguation. The first instant of
 * a day whose midnight is skipped (Africa/Cairo, Asia/Beirut) is therefore the
 * 01:00 that replaces it, not 23:00 of the previous day.
 */
function zonedDateTimeToUtc(parts: ZonedDateParts, timezone: string) {
  const wallMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetBefore = getTimezoneOffsetMs(new Date(wallMs - DAY_MS), timezone);
  const offsetAfter = getTimezoneOffsetMs(new Date(wallMs + DAY_MS), timezone);
  const matches = [wallMs - offsetBefore, wallMs - offsetAfter].filter(
    (utcMs) => isSameWallTime(new Date(utcMs), parts, timezone),
  );

  return new Date(
    matches.length > 0 ? Math.min(...matches) : wallMs - offsetBefore,
  );
}

function addDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const next = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );

  return {
    ...parts,
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

/** First instant of the local day `days` after the one containing `date`. */
function startOfZonedDay(date: Date, timezone: string, days = 0) {
  return zonedDateTimeToUtc(
    {
      ...addDays(toZonedParts(date, timezone), days),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timezone,
  );
}

/**
 * Start of the local hour containing `date`.
 *
 * Subtracting the local minutes keeps the offset of `date`, so the first of two
 * repeated hours does not turn into the second. When a transition moves the
 * clock by less than an hour, the result can fall before the transition; it
 * still identifies the local hour, which is all a bucket key needs.
 */
function startOfZonedHour(date: Date, timezone: string) {
  const parts = toZonedParts(date, timezone);

  return new Date(
    date.getTime() -
      parts.minute * 60_000 -
      parts.second * 1000 -
      date.getUTCMilliseconds(),
  );
}

function parseDateOnly(value: string) {
  const [year, month, day] = value
    .split("-")
    .map((part) => Number.parseInt(part, 10));

  return {
    year,
    month,
    day,
  };
}

function dateOnlyToUtc(value: string, timezone: string, edge: "start" | "end") {
  const parts = parseDateOnly(value);
  const startParts = {
    ...parts,
    hour: 0,
    minute: 0,
    second: 0,
  };

  if (edge === "start") {
    return zonedDateTimeToUtc(startParts, timezone);
  }

  return new Date(
    zonedDateTimeToUtc(addDays(startParts, 1), timezone).getTime() - 1,
  );
}

function toDate(
  value: string | Date | undefined,
  fallback: Date,
  edge: "start" | "end",
  timezone: string,
) {
  if (!value) {
    return fallback;
  }

  if (value instanceof Date) {
    return value;
  }

  if (dateOnlyPattern.test(value)) {
    return dateOnlyToUtc(value, timezone, edge);
  }

  return new Date(value);
}

export function resolveDashboardRange(
  input: ResolveDashboardRangeInput,
): DashboardRange {
  const preset = input.preset ?? "7d";
  const now = input.now ?? new Date();

  if (preset === "custom") {
    const to = toDate(input.to, now, "end", input.timezone);
    const requestedFrom = toDate(input.from, now, "start", input.timezone);
    // Clamp rather than reject: the resolved range travels back to the client,
    // so a too-wide request still renders, just over the capped window.
    const from =
      to.getTime() - requestedFrom.getTime() > MAX_CUSTOM_RANGE_MS
        ? new Date(to.getTime() - MAX_CUSTOM_RANGE_MS)
        : requestedFrom;

    return {
      from,
      to,
      granularity:
        to.getTime() - from.getTime() <= 36 * 60 * 60 * 1000 ? "hour" : "day",
      preset,
      timezone: input.timezone,
    };
  }

  if (preset === "1d") {
    return {
      from: startOfZonedDay(now, input.timezone),
      to: now,
      granularity: "hour",
      preset,
      timezone: input.timezone,
    };
  }

  return {
    from: startOfZonedDay(now, input.timezone, preset === "7d" ? -6 : -29),
    to: now,
    granularity: "day",
    preset,
    timezone: input.timezone,
  };
}

export function getPreviousRange(range: DashboardRange): DashboardRange {
  const duration = range.to.getTime() - range.from.getTime();

  return {
    ...range,
    from: new Date(range.from.getTime() - duration),
    to: new Date(range.from.getTime()),
  };
}

function formatBucketLabel(range: DashboardRange, value: Date) {
  const parts = toZonedParts(value, range.timezone);
  const date = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;

  return range.granularity === "hour"
    ? `${date} ${String(parts.hour).padStart(2, "0")}:00`
    : date;
}

/**
 * Key of the bucket that `value` falls in, matching `listRangeBuckets`.
 *
 * Days are keyed by their local date. Hours are keyed by the instant they
 * start, because the same wall-clock hour happens twice when clocks go back.
 */
export function groupByHourOrDay(range: DashboardRange, value: Date) {
  if (range.granularity === "hour") {
    return startOfZonedHour(value, range.timezone).toISOString();
  }

  return formatBucketLabel(range, value);
}

export function listRangeBuckets(range: DashboardRange) {
  const buckets: Array<{ key: string; label: string; start: Date }> = [];

  if (range.granularity === "hour") {
    // Step an hour of elapsed time past each bucket's start. Every instant is
    // keyed by the start of its local hour, and this reaches each of those
    // starts in turn, also when clocks skip, repeat, or shift by 30 or 45
    // minutes. The label comes from the probe rather than the key, which can
    // precede a short hour.
    for (
      let probe = range.from;
      probe.getTime() <= range.to.getTime();
      probe = new Date(buckets[buckets.length - 1].start.getTime() + HOUR_MS)
    ) {
      const start = startOfZonedHour(probe, range.timezone);
      buckets.push({
        key: start.toISOString(),
        label: formatBucketLabel(range, probe),
        start,
      });
    }

    return buckets;
  }

  for (
    let start = startOfZonedDay(range.from, range.timezone);
    start.getTime() <= range.to.getTime();
    start = startOfZonedDay(start, range.timezone, 1)
  ) {
    const key = formatBucketLabel(range, start);
    buckets.push({ key, label: key, start });
  }

  return buckets;
}
