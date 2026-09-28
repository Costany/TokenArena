import { describe, expect, it } from "vitest";

import {
  getPreviousRange,
  getZonedWeekdayHour,
  groupByHourOrDay,
  listRangeBuckets,
  MAX_CUSTOM_RANGE_DAYS,
  resolveDashboardRange,
  toZonedParts,
} from "./date-range";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("resolveDashboardRange", () => {
  it("supports date-only custom ranges in the account timezone", () => {
    const result = resolveDashboardRange({
      preset: "custom",
      from: "2026-03-26",
      to: "2026-03-27",
      timezone: "Asia/Shanghai",
    });

    expect(result.from.toISOString()).toBe("2026-03-25T16:00:00.000Z");
    expect(result.to.toISOString()).toBe("2026-03-27T15:59:59.999Z");
    expect(result.granularity).toBe("day");
  });

  it("supports date-only custom ranges in negative UTC offsets", () => {
    const result = resolveDashboardRange({
      preset: "custom",
      from: "2026-03-26",
      to: "2026-03-27",
      timezone: "America/Los_Angeles",
    });

    expect(result.from.toISOString()).toBe("2026-03-26T07:00:00.000Z");
    expect(result.to.toISOString()).toBe("2026-03-28T06:59:59.999Z");
  });

  it("clamps a custom range wider than the cap, keeping the end fixed", () => {
    const result = resolveDashboardRange({
      preset: "custom",
      from: "1970-01-01",
      to: "2026-03-27",
      timezone: "UTC",
    });

    expect(result.to.toISOString()).toBe("2026-03-27T23:59:59.999Z");
    expect(result.to.getTime() - result.from.getTime()).toBe(
      MAX_CUSTOM_RANGE_DAYS * DAY_MS,
    );
  });

  it("leaves a custom range at the cap untouched", () => {
    const to = new Date("2026-03-27T00:00:00.000Z");
    const from = new Date(to.getTime() - MAX_CUSTOM_RANGE_DAYS * DAY_MS);
    const result = resolveDashboardRange({
      preset: "custom",
      from,
      to,
      timezone: "UTC",
    });

    expect(result.from.toISOString()).toBe(from.toISOString());
  });

  it("uses hourly buckets for 1D", () => {
    const result = resolveDashboardRange({
      preset: "1d",
      timezone: "UTC",
      now: new Date("2026-03-26T12:00:00.000Z"),
    });

    expect(result.granularity).toBe("hour");
    expect(result.from.toISOString()).toBe("2026-03-26T00:00:00.000Z");
  });

  it("resolves a 7d preset to a 7-day range with day granularity", () => {
    const result = resolveDashboardRange({
      preset: "7d",
      timezone: "UTC",
      now: new Date("2026-03-26T12:00:00.000Z"),
    });

    expect(result.preset).toBe("7d");
    expect(result.granularity).toBe("day");
    expect(result.timezone).toBe("UTC");
    expect(result.from.toISOString()).toBe("2026-03-20T00:00:00.000Z");
    expect(result.to.toISOString()).toBe("2026-03-26T12:00:00.000Z");
  });

  it("resolves a 30d preset to a 30-day range with day granularity", () => {
    const result = resolveDashboardRange({
      preset: "30d",
      timezone: "UTC",
      now: new Date("2026-03-26T12:00:00.000Z"),
    });

    expect(result.preset).toBe("30d");
    expect(result.granularity).toBe("day");
    expect(result.from.toISOString()).toBe("2026-02-25T00:00:00.000Z");
    expect(result.to.toISOString()).toBe("2026-03-26T12:00:00.000Z");
  });
});

describe("getZonedWeekdayHour", () => {
  it("uses the local weekday when UTC and local dates differ", () => {
    expect(
      getZonedWeekdayHour(
        new Date("2026-03-26T23:30:00.000Z"),
        "Asia/Shanghai",
      ),
    ).toEqual({ weekday: 5, hour: 7 });
  });

  it("uses the correct hour across a daylight saving transition", () => {
    const timezone = "America/Los_Angeles";
    expect(
      getZonedWeekdayHour(new Date("2026-03-08T09:30:00.000Z"), timezone),
    ).toEqual({ weekday: 0, hour: 1 });
    expect(
      getZonedWeekdayHour(new Date("2026-03-08T10:30:00.000Z"), timezone),
    ).toEqual({ weekday: 0, hour: 3 });
  });
});

describe("getPreviousRange", () => {
  it("shifts the range backward by the same duration", () => {
    const range = resolveDashboardRange({
      preset: "7d",
      timezone: "UTC",
      now: new Date("2026-03-26T12:00:00.000Z"),
    });
    const previous = getPreviousRange(range);

    expect(previous.from.getTime()).toBe(
      range.from.getTime() - (range.to.getTime() - range.from.getTime()),
    );
    expect(previous.to.getTime()).toBe(range.from.getTime());
    expect(previous.preset).toBe(range.preset);
    expect(previous.timezone).toBe(range.timezone);
    expect(previous.granularity).toBe(range.granularity);
  });
});

describe("groupByHourOrDay", () => {
  it("groups by hour when range granularity is hour", () => {
    const range = resolveDashboardRange({
      preset: "1d",
      timezone: "UTC",
      now: new Date("2026-03-26T12:30:00.000Z"),
    });

    const key = groupByHourOrDay(range, new Date("2026-03-26T08:45:00.000Z"));
    expect(key).toBe("2026-03-26T08:00:00.000Z");
  });

  it("groups by day when range granularity is day", () => {
    const range = resolveDashboardRange({
      preset: "7d",
      timezone: "UTC",
      now: new Date("2026-03-26T12:00:00.000Z"),
    });

    const key = groupByHourOrDay(range, new Date("2026-03-24T15:30:00.000Z"));
    expect(key).toBe("2026-03-24");
  });
});

describe("listRangeBuckets", () => {
  it.each([
    { timezone: "Europe/Berlin", date: "2026-03-29", count: 23 },
    { timezone: "Europe/Berlin", date: "2026-10-25", count: 25 },
    { timezone: "America/New_York", date: "2026-03-08", count: 23 },
    { timezone: "America/New_York", date: "2026-11-01", count: 25 },
  ])("advances through $date in $timezone", ({ timezone, date, count }) => {
    const range = resolveDashboardRange({
      preset: "custom",
      from: date,
      to: date,
      timezone,
    });

    const buckets = listRangeBuckets(range);

    expect(buckets).toHaveLength(count);
    expect(new Set(buckets.map((bucket) => bucket.key)).size).toBe(count);
    expect(buckets[0]?.start.getTime()).toBe(range.from.getTime());
    expect(buckets.at(-1)?.start.getTime()).toBe(
      range.to.getTime() + 1 - 60 * 60 * 1000,
    );
    for (let index = 1; index < buckets.length; index++) {
      expect(
        buckets[index].start.getTime() - buckets[index - 1].start.getTime(),
      ).toBe(60 * 60 * 1000);
    }
  });

  it.each([
    "2026-11-01T05:30:45.123Z",
    "2026-11-01T06:30:45.123Z",
  ])("keeps the correct occurrence of an ambiguous starting hour at %s", (from) => {
    const range = resolveDashboardRange({
      preset: "custom",
      from,
      to: new Date(new Date(from).getTime() + 15 * 60 * 1000),
      timezone: "America/New_York",
    });

    const buckets = listRangeBuckets(range);

    expect(buckets).toHaveLength(1);
    expect(buckets[0].start.toISOString()).toBe(
      from.replace("30:45.123", "00:00.000"),
    );
    expect(buckets[0].label).toBe("2026-11-01 01:00");
  });

  it("keeps both occurrences of a repeated hour apart", () => {
    const range = resolveDashboardRange({
      preset: "custom",
      from: "2026-11-01",
      to: "2026-11-01",
      timezone: "America/New_York",
    });
    const keys = new Set(listRangeBuckets(range).map((bucket) => bucket.key));

    // Both are 01:30 on the wall clock, an hour apart. Trends seed a map by key,
    // so a shared key would add the two hours together again.
    const first = groupByHourOrDay(range, new Date("2026-11-01T05:30:00.000Z"));
    const second = groupByHourOrDay(
      range,
      new Date("2026-11-01T06:30:00.000Z"),
    );
    expect(first).not.toBe(second);
    expect(keys).toContain(first);
    expect(keys).toContain(second);
    expect(
      listRangeBuckets(range).filter(
        (bucket) => bucket.label === "2026-11-01 01:00",
      ),
    ).toHaveLength(2);
  });

  it.each([
    // 02:45 jumps to 03:45, off the hour grid.
    { timezone: "Pacific/Chatham", from: "2026-09-27", to: "2026-09-27" },
    // 02:00 jumps to 02:30, and the range starts inside the short hour.
    {
      timezone: "Australia/Lord_Howe",
      from: "2026-10-03T15:45:00.000Z",
      to: "2026-10-03T20:00:00.000Z",
    },
    // 02:00 falls back to 01:30, repeating half an hour.
    { timezone: "Australia/Lord_Howe", from: "2027-04-04", to: "2027-04-04" },
  ])("has a bucket for every moment of $from in $timezone", ({
    timezone,
    from,
    to,
  }) => {
    const range = resolveDashboardRange({
      preset: "custom",
      from,
      to,
      timezone,
    });
    const buckets = listRangeBuckets(range);
    const keys = new Set(buckets.map((bucket) => bucket.key));

    expect(keys.size).toBe(buckets.length);
    for (
      let time = range.from.getTime();
      time <= range.to.getTime();
      time += 60 * 1000
    ) {
      expect(keys).toContain(groupByHourOrDay(range, new Date(time)));
    }
  });

  it("labels an hour that starts after a half-hour jump by its own hour", () => {
    const range = resolveDashboardRange({
      preset: "custom",
      from: "2026-10-03T15:45:00.000Z",
      to: "2026-10-03T16:30:00.000Z",
      timezone: "Australia/Lord_Howe",
    });

    expect(listRangeBuckets(range).map((bucket) => bucket.label)).toEqual([
      "2026-10-04 02:00",
      "2026-10-04 03:00",
    ]);
  });

  it.each([
    { timezone: "Africa/Cairo", now: "2026-04-27T09:00:00.000Z" },
    { timezone: "Asia/Beirut", now: "2026-03-31T09:00:00.000Z" },
  ])("keeps today in a 7d range after $timezone skips midnight", ({
    timezone,
    now,
  }) => {
    const range = resolveDashboardRange({
      preset: "7d",
      timezone,
      now: new Date(now),
    });
    const keys = listRangeBuckets(range).map((bucket) => bucket.key);

    expect(keys).toHaveLength(7);
    expect(new Set(keys).size).toBe(7);
    expect(keys.at(-1)).toBe(now.slice(0, 10));
  });

  it("starts a day without a midnight at the hour that replaces it", () => {
    // Cairo moves from 00:00 straight to 01:00 on 2026-04-24.
    const today = resolveDashboardRange({
      preset: "1d",
      timezone: "Africa/Cairo",
      now: new Date("2026-04-24T09:00:00.000Z"),
    });
    const custom = resolveDashboardRange({
      preset: "custom",
      from: "2026-04-24",
      to: "2026-04-24",
      timezone: "Africa/Cairo",
    });

    expect(today.from.toISOString()).toBe("2026-04-23T22:00:00.000Z");
    expect(listRangeBuckets(today)[0]?.label).toBe("2026-04-24 01:00");
    expect(custom.from.toISOString()).toBe("2026-04-23T22:00:00.000Z");
    expect(custom.to.toISOString()).toBe("2026-04-24T20:59:59.999Z");
  });

  it("generates hourly buckets for a 1d range", () => {
    const range = resolveDashboardRange({
      preset: "1d",
      timezone: "UTC",
      now: new Date("2026-03-26T05:00:00.000Z"),
    });

    const buckets = listRangeBuckets(range);

    expect(buckets.length).toBe(6);
    expect(buckets[0]).toMatchObject({
      key: "2026-03-26T00:00:00.000Z",
      label: "2026-03-26 00:00",
    });
    expect(buckets[5]?.label).toBe("2026-03-26 05:00");
  });

  it("generates daily buckets for a 7d range", () => {
    const range = resolveDashboardRange({
      preset: "7d",
      timezone: "UTC",
      now: new Date("2026-03-26T00:00:00.000Z"),
    });

    const buckets = listRangeBuckets(range);

    expect(buckets).toHaveLength(7);
    expect(buckets[0]?.key).toBe("2026-03-20");
    expect(buckets[6]?.key).toBe("2026-03-26");
  });
});

describe("toZonedParts", () => {
  it("extracts date/time parts in the specified timezone", () => {
    const parts = toZonedParts(new Date("2026-03-26T08:30:45.000Z"), "UTC");

    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(3);
    expect(parts.day).toBe(26);
    expect(parts.hour).toBe(8);
    expect(parts.minute).toBe(30);
    expect(parts.second).toBe(45);
  });

  it("converts to a timezone with positive offset", () => {
    const parts = toZonedParts(
      new Date("2026-03-26T08:30:45.000Z"),
      "Asia/Shanghai",
    );

    expect(parts.hour).toBe(16);
    expect(parts.day).toBe(26);
  });
});
