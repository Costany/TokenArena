import { describe, expect, it } from "vitest";
import { dashboardQuerySchema, ingestRequestSchema } from "./contracts";
import {
  getUsageSourceFilter,
  getUsageSourceLabel,
  normalizeUsageSource,
} from "./sources";
import { schemaVersion } from "./types";

describe("Snow read-side grouping", () => {
  it.each([
    "snow",
    "snow-app",
  ])("groups %s without changing upload identities", (source) => {
    expect(normalizeUsageSource(source)).toBe("snow");
    expect(getUsageSourceLabel(source)).toBe("Snow");
    expect(getUsageSourceFilter(source)).toEqual({
      in: ["snow", "snow-app"],
    });
    expect(dashboardQuerySchema.parse({ source }).source).toBe("snow");
    const parsed = ingestRequestSchema.parse({
      schemaVersion,
      device: { deviceId: "device-123", hostname: "test" },
      buckets: [
        {
          source,
          model: "test",
          projectKey: "test",
          projectLabel: "test",
          bucketStart: "2026-09-30T00:00:00.000Z",
          inputTokens: 1,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedTokens: 0,
          totalTokens: 1,
        },
      ],
      sessions: [],
    });
    expect(parsed.buckets[0].source).toBe(source);
  });
  it.each([
    "codex",
    "claude-code",
    "snow-other",
    "unknown",
  ])("leaves %s unchanged", (source) => {
    expect(normalizeUsageSource(source)).toBe(source);
    expect(getUsageSourceLabel(source)).toBe(source);
    expect(getUsageSourceFilter(source)).toBe(source);
  });
  it("keeps an absent dashboard filter absent", () => {
    expect(dashboardQuerySchema.parse({}).source).toBeUndefined();
  });
});
