import { describe, expect, it } from "vitest";
import {
  computeShares,
  filsToDecimal,
  formatAed,
  parseAmountToFils,
  parsePercentToBp,
  splitByPercent,
  splitEqual,
} from "@/lib/core/money";

const four = ["a", "b", "c", "d"];
const sum = (xs: { shareFils: number }[]) => xs.reduce((n, x) => n + x.shareFils, 0);

describe("amount parsing & formatting", () => {
  it("parses AED strings into integer fils", () => {
    expect(parseAmountToFils("120")).toBe(12000);
    expect(parseAmountToFils("12.5")).toBe(1250);
    expect(parseAmountToFils("1,234.56")).toBe(123456);
    expect(parseAmountToFils("0.07")).toBe(7);
  });
  it("rejects invalid amounts", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "12.", ".5"]) {
      expect(parseAmountToFils(bad)).toBeNull();
    }
  });
  it("avoids floating point artefacts", () => {
    expect(parseAmountToFils("19.99")).toBe(1999);
    expect(parseAmountToFils("1.15")).toBe(115); // 1.15 * 100 === 114.99999999999999 in JS floats
  });
  it("formats", () => {
    expect(formatAed(12345)).toBe("AED 123.45");
    expect(formatAed(-5)).toBe("-AED 0.05");
    expect(filsToDecimal(12345)).toBe("123.45");
    expect(parsePercentToBp("33.33")).toBe(3333);
  });
});

describe("equal split", () => {
  it("AED 120 between four members is AED 30 each", () => {
    const r = computeShares({ method: "equal", totalFils: 12000, participantIds: four });
    expect(r.ok).toBe(true);
    expect(r.shares.map((s) => s.shareFils)).toEqual([3000, 3000, 3000, 3000]);
  });
  it("splits between selected members only", () => {
    const r = computeShares({ method: "equal", totalFils: 9000, participantIds: ["a", "c", "d"] });
    expect(r.shares.map((s) => s.userId)).toEqual(["a", "c", "d"]);
    expect(r.shares.every((s) => s.shareFils === 3000)).toBe(true);
  });
  it("distributes rounding remainders so shares sum exactly", () => {
    for (const total of [1, 2, 3, 100, 1001, 4650, 9999, 12345]) {
      for (let n = 1; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => `u${i}`);
        const shares = splitEqual(total, ids);
        expect(sum(shares)).toBe(total);
        const vals = shares.map((s) => s.shareFils);
        expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
      }
    }
  });
  it("AED 46.50 between four: 11.63, 11.63, 11.62, 11.62", () => {
    expect(splitEqual(4650, four).map((s) => s.shareFils)).toEqual([1163, 1163, 1162, 1162]);
  });
});

describe("exact split", () => {
  it("accepts amounts that match the total", () => {
    const r = computeShares({
      method: "exact",
      totalFils: 5500,
      participantIds: ["a", "b"],
      custom: { a: 1500, b: 4000 },
    });
    expect(r.ok).toBe(true);
  });
  it("rejects when amounts do not match, with a helpful message", () => {
    const under = computeShares({ method: "exact", totalFils: 5500, participantIds: ["a", "b"], custom: { a: 1500, b: 3000 } });
    expect(under.ok).toBe(false);
    expect(under.error).toContain("AED 10.00 still to be assigned");
    const over = computeShares({ method: "exact", totalFils: 5500, participantIds: ["a", "b"], custom: { a: 5000, b: 1000 } });
    expect(over.ok).toBe(false);
    expect(over.error).toContain("exceed");
  });
});

describe("percentage split", () => {
  it("40/20/20/20 of AED 310", () => {
    const r = splitByPercent(31000, [
      { userId: "a", percentBp: 4000 },
      { userId: "b", percentBp: 2000 },
      { userId: "c", percentBp: 2000 },
      { userId: "d", percentBp: 2000 },
    ]);
    expect(r.shares.map((s) => s.shareFils)).toEqual([12400, 6200, 6200, 6200]);
  });
  it("rounding differences still sum exactly (thirds)", () => {
    const r = splitByPercent(10000, [
      { userId: "a", percentBp: 3334 },
      { userId: "b", percentBp: 3333 },
      { userId: "c", percentBp: 3333 },
    ]);
    expect(r.ok).toBe(true);
    expect(sum(r.shares)).toBe(10000);
  });
  it("sums exactly for awkward totals", () => {
    for (const total of [1, 7, 101, 9999, 123457]) {
      const r = splitByPercent(total, [
        { userId: "a", percentBp: 3333 },
        { userId: "b", percentBp: 3333 },
        { userId: "c", percentBp: 3334 },
      ]);
      expect(sum(r.shares)).toBe(total);
    }
  });
  it("rejects percentages not totalling 100", () => {
    const r = splitByPercent(1000, [
      { userId: "a", percentBp: 5000 },
      { userId: "b", percentBp: 4000 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("90%");
  });
});
