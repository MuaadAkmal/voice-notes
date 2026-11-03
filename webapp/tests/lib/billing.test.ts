// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { type BillingStatus, formatBytes, formatHours, holdsPlan, setReturnTo, takeReturnTo } from "@/lib/billing";

describe("billing helpers", () => {
  beforeEach(() => sessionStorage.clear());

  it("formats Cloud time in minutes, then hours", () => {
    expect(formatHours(0)).toBe("0 min");
    expect(formatHours(1800)).toBe("30 min");
    expect(formatHours(18000)).toBe("5 h");
    expect(formatHours(5400)).toBe("1.5 h");
  });

  it("formats storage in MB, then GB", () => {
    expect(formatBytes(262144000)).toBe("250 MB");
    expect(formatBytes(5368709120)).toBe("5 GB");
  });

  it("the return path is read once, and only a same-site path", () => {
    setReturnTo("/account/?plan=pro&period=annual");
    expect(takeReturnTo()).toBe("/account/?plan=pro&period=annual");
    expect(takeReturnTo()).toBeNull();
    setReturnTo("//evil.example/x");
    expect(takeReturnTo()).toBeNull();
    setReturnTo("https://evil.example/x");
    expect(takeReturnTo()).toBeNull();
  });

  it("a plan is held while active, pending or setting up", () => {
    const s = (status: string | null): BillingStatus => ({
      plan: "standard",
      subscription: status ? { plan: "standard", period: "monthly", status, currentEnd: null, cancelAtPeriodEnd: false } : null,
      cloud: { used: 0, limit: 18000, resetsAt: "2026-12-01T00:00:00.000Z" },
      storage: { used: 0, limit: 5368709120 },
    });
    expect(["active", "pending", "authenticated"].map((x) => holdsPlan(s(x)))).toEqual([true, true, true]);
    expect(["created", "halted", "cancelled", "completed"].map((x) => holdsPlan(s(x)))).toEqual([false, false, false, false]);
    expect(holdsPlan(s(null))).toBe(false);
  });
});
