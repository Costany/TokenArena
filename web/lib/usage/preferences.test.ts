import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usagePreferenceFindUnique: vi.fn(),
  usagePreferenceCreate: vi.fn(),
  usagePreferenceFindUniqueOrThrow: vi.fn(),
  usagePreferenceUpdate: vi.fn(),
  expireLeaderboardSnapshots: vi.fn(),
  prismaTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    usagePreference: {
      findUnique: mocks.usagePreferenceFindUnique,
      create: mocks.usagePreferenceCreate,
      findUniqueOrThrow: mocks.usagePreferenceFindUniqueOrThrow,
      update: mocks.usagePreferenceUpdate,
    },
    $transaction: mocks.prismaTransaction,
  },
}));

vi.mock("@/lib/leaderboard/aggregates", () => ({
  expireLeaderboardSnapshots: mocks.expireLeaderboardSnapshots,
}));

import {
  ensureUsagePreferenceWithDb,
  updateUsagePreference,
} from "./preferences";

function createPreference(overrides: Record<string, unknown> = {}) {
  return {
    id: "pref_123",
    userId: "user_123",
    locale: "en",
    theme: "system",
    timezone: "UTC",
    projectMode: "hashed",
    projectHashSalt: "salt123",
    publicProfileEnabled: false,
    bio: null,
    createdAt: new Date("2026-03-26T00:00:00.000Z"),
    updatedAt: new Date("2026-03-26T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ensureUsagePreferenceWithDb", () => {
  it("returns the existing preference when a concurrent create hits the unique userId constraint", async () => {
    const existingPreference = createPreference();

    const db = {
      usagePreference: {
        findUnique: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn().mockRejectedValueOnce({ code: "P2002" }),
        findUniqueOrThrow: vi.fn().mockResolvedValueOnce(existingPreference),
      },
    };

    const result = await ensureUsagePreferenceWithDb(db as never, "user_123");

    expect(result).toEqual(existingPreference);
    expect(db.usagePreference.findUnique).toHaveBeenCalledWith({
      where: { userId: "user_123" },
    });
    expect(db.usagePreference.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { userId: "user_123" },
    });
  });

  it("returns the existing preference when it already exists", async () => {
    const existingPreference = createPreference();

    const db = {
      usagePreference: {
        findUnique: vi.fn().mockResolvedValueOnce(existingPreference),
        create: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    };

    const result = await ensureUsagePreferenceWithDb(db as never, "user_123");

    expect(result).toEqual(existingPreference);
    expect(db.usagePreference.create).not.toHaveBeenCalled();
    expect(db.usagePreference.findUnique).toHaveBeenCalledWith({
      where: { userId: "user_123" },
    });
  });

  it("creates a new preference when none exists", async () => {
    const newPreference = createPreference();

    const db = {
      usagePreference: {
        findUnique: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValueOnce(newPreference),
        findUniqueOrThrow: vi.fn(),
      },
    };

    const result = await ensureUsagePreferenceWithDb(db as never, "user_123");

    expect(result).toEqual(newPreference);
    expect(db.usagePreference.create).toHaveBeenCalledWith({
      data: {
        userId: "user_123",
        projectHashSalt: expect.any(String),
      },
    });
  });

  it("throws non-P2002 errors from create", async () => {
    const error = new Error("connection lost");

    const db = {
      usagePreference: {
        findUnique: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn().mockRejectedValueOnce(error),
        findUniqueOrThrow: vi.fn(),
      },
    };

    await expect(
      ensureUsagePreferenceWithDb(db as never, "user_123"),
    ).rejects.toThrow("connection lost");

    expect(db.usagePreference.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe("updateUsagePreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** A transaction client whose reads and writes go to one stored row. */
  function createTransaction(initial: ReturnType<typeof createPreference>) {
    let stored = initial;
    const tx = {
      usagePreference: {
        findUniqueOrThrow: vi.fn(async () => stored),
        // Like Prisma, fields left undefined are not written.
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          stored = {
            ...stored,
            ...Object.fromEntries(
              Object.entries(data).filter(([, value]) => value !== undefined),
            ),
          };
          return stored;
        }),
        create: vi.fn(),
      },
    };
    mocks.prismaTransaction.mockImplementation(
      async (fn: (client: unknown) => unknown) => fn(tx),
    );
    return tx;
  }

  it("creates a missing preference before updating it", async () => {
    const created = createPreference({ publicProfileEnabled: true });
    mocks.usagePreferenceFindUnique.mockResolvedValueOnce(null);
    mocks.usagePreferenceCreate.mockResolvedValueOnce(created);
    const tx = createTransaction(created);

    const result = await updateUsagePreference("user_123", {
      theme: "dark",
      publicProfileEnabled: false,
    });

    expect(result).toMatchObject({
      theme: "dark",
      publicProfileEnabled: false,
    });
    expect(mocks.usagePreferenceCreate).toHaveBeenCalledTimes(1);
    expect(tx.usagePreference.create).not.toHaveBeenCalled();
    expect(mocks.expireLeaderboardSnapshots).toHaveBeenCalledWith(tx);
  });

  it("uses the row a concurrent request created first", async () => {
    // A unique violation aborts a PostgreSQL transaction, so the conflict has
    // to be resolved before the update transaction starts.
    const winner = createPreference({ publicProfileEnabled: true });
    mocks.usagePreferenceFindUnique.mockResolvedValueOnce(null);
    mocks.usagePreferenceCreate.mockRejectedValueOnce({ code: "P2002" });
    mocks.usagePreferenceFindUniqueOrThrow.mockResolvedValueOnce(winner);
    const tx = createTransaction(winner);

    const result = await updateUsagePreference("user_123", { theme: "dark" });

    expect(result).toMatchObject({ theme: "dark" });
    expect(mocks.usagePreferenceFindUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(mocks.prismaTransaction.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.usagePreferenceCreate.mock.invocationCallOrder[0],
    );
    expect(tx.usagePreference.create).not.toHaveBeenCalled();
  });

  it("updates preference fields and returns the updated record", async () => {
    const existing = createPreference({ publicProfileEnabled: false });
    mocks.usagePreferenceFindUnique.mockResolvedValueOnce(existing);
    createTransaction(existing);

    const result = await updateUsagePreference("user_123", { locale: "zh" });

    expect(result).toEqual({ ...existing, locale: "zh" });
    expect(mocks.usagePreferenceCreate).not.toHaveBeenCalled();
    expect(mocks.expireLeaderboardSnapshots).not.toHaveBeenCalled();
  });

  it("triggers expireLeaderboardSnapshots when publicProfileEnabled changes", async () => {
    const existing = createPreference({ publicProfileEnabled: false });
    mocks.usagePreferenceFindUnique.mockResolvedValueOnce(existing);
    const tx = createTransaction(existing);
    mocks.expireLeaderboardSnapshots.mockResolvedValueOnce(undefined);

    const result = await updateUsagePreference("user_123", {
      publicProfileEnabled: true,
    });

    expect(result).toMatchObject({ publicProfileEnabled: true });
    expect(mocks.expireLeaderboardSnapshots).toHaveBeenCalledTimes(1);
    expect(mocks.expireLeaderboardSnapshots).toHaveBeenCalledWith(tx);
  });

  it("does not trigger expireLeaderboardSnapshots when publicProfileEnabled stays the same", async () => {
    const existing = createPreference({ publicProfileEnabled: true });
    mocks.usagePreferenceFindUnique.mockResolvedValueOnce(existing);
    createTransaction(existing);

    const result = await updateUsagePreference("user_123", {
      publicProfileEnabled: true,
      timezone: "Asia/Shanghai",
    });

    expect(result).toMatchObject({
      publicProfileEnabled: true,
      timezone: "Asia/Shanghai",
    });
    expect(mocks.expireLeaderboardSnapshots).not.toHaveBeenCalled();
  });
});
