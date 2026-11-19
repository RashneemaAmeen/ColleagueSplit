import { describe, expect, it } from "vitest";
import { computeBalances, simplifyDebts, sumBalances } from "@/lib/core/balances";
import { splitEqual } from "@/lib/core/money";
import { csvCell, summarizeMonth } from "@/lib/core/reports";
import type { Expense } from "@/lib/types";

const ids = ["a", "b", "c", "d"];
const exp = (paidBy: string, amountFils: number, participants = ids) => ({
  paidBy,
  amountFils,
  splits: splitEqual(amountFils, participants),
});
const noSettlements: Parameters<typeof computeBalances>[2] = [];
const settle = (fromUser: string, toUser: string, amountFils: number, undoneAt: string | null = null) => ({
  fromUser,
  toUser,
  amountFils,
  undoneAt,
});

describe("balances", () => {
  it("A pays AED 120 for four: A is owed 90, others owe 30", () => {
    const b = computeBalances(ids, [exp("a", 12000)], noSettlements);
    expect(b).toEqual({ a: 9000, b: -3000, c: -3000, d: -3000 });
    expect(sumBalances(b)).toBe(0);
  });

  it("multiple expenses with different payers", () => {
    const b = computeBalances(
      ids,
      [exp("a", 12000), exp("b", 4650), exp("c", 8735, ["c", "d", "a"]), exp("d", 31000)],
      noSettlements,
    );
    expect(sumBalances(b)).toBe(0);
    // a: paid 12000; shares 3000 + 1163 + 2911 (third of [c,d,a], gets no extra fil) + 7750 => -2824
    expect(b.a).toBe(12000 - 3000 - 1163 - 2911 - 7750);
  });

  it("full settlement clears the debt", () => {
    const e = [exp("a", 12000)];
    const b = computeBalances(ids, e, [settle("b", "a", 3000)]);
    expect(b.b).toBe(0);
    expect(b.a).toBe(6000);
    expect(sumBalances(b)).toBe(0);
  });

  it("partial settlement reduces the debt", () => {
    const b = computeBalances(ids, [exp("a", 12000)], [settle("b", "a", 1000)]);
    expect(b.b).toBe(-2000);
    expect(sumBalances(b)).toBe(0);
  });

  it("settlements do not change total spending, only balances", () => {
    const e = [exp("a", 12000)];
    const total = e.reduce((n, x) => n + x.amountFils, 0);
    computeBalances(ids, e, [settle("b", "a", 3000)]);
    expect(total).toBe(12000);
  });

  it("undone settlements are ignored", () => {
    const b = computeBalances(ids, [exp("a", 12000)], [settle("b", "a", 3000, "2026-01-01T00:00:00Z")]);
    expect(b.b).toBe(-3000);
  });

  it("editing an expense changes balances; deleting removes its effect", () => {
    const before = computeBalances(ids, [exp("a", 12000)], noSettlements);
    const edited = computeBalances(ids, [exp("a", 16000)], noSettlements);
    expect(edited.a).toBe(12000);
    expect(edited.a).not.toBe(before.a);
    const deleted = computeBalances(ids, [], noSettlements);
    expect(Object.values(deleted).every((v) => v === 0)).toBe(true);
  });

  it("sum of balances is always zero (randomised)", () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let run = 0; run < 200; run++) {
      const expenses = Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => {
        const participants = ids.filter(() => rnd() > 0.3);
        return exp(ids[Math.floor(rnd() * 4)], 1 + Math.floor(rnd() * 100000), participants.length ? participants : ["a"]);
      });
      const settlements = Array.from({ length: Math.floor(rnd() * 4) }, () => settle("b", "c", 1 + Math.floor(rnd() * 5000)));
      expect(sumBalances(computeBalances(ids, expenses, settlements))).toBe(0);
    }
  });
});

describe("simplifyDebts", () => {
  it("produces few payments that fully settle everyone", () => {
    const b = { a: 9000, b: -3000, c: -3000, d: -3000 };
    const t = simplifyDebts(b);
    expect(t).toHaveLength(3);
    const applied = { ...b };
    for (const x of t) {
      applied[x.from as keyof typeof applied] += x.amountFils;
      applied[x.to as keyof typeof applied] -= x.amountFils;
    }
    expect(Object.values(applied).every((v) => v === 0)).toBe(true);
  });

  it("minimises payments: chains collapse", () => {
    // B owes A 30, C owes B 30 => simplified: C pays A 30 (net B = 0)
    const t = simplifyDebts({ a: 3000, b: 0, c: -3000 });
    expect(t).toEqual([{ from: "c", to: "a", amountFils: 3000 }]);
  });

  it("never needs more than n-1 payments", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let run = 0; run < 200; run++) {
      const n = 2 + Math.floor(rnd() * 6);
      const users = Array.from({ length: n }, (_, i) => `u${i}`);
      const expenses = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () =>
        exp(users[Math.floor(rnd() * n)], 1 + Math.floor(rnd() * 50000), users),
      );
      const b = computeBalances(users, expenses, noSettlements);
      const t = simplifyDebts(b);
      expect(t.length).toBeLessThanOrEqual(n - 1);
      const applied = { ...b };
      for (const x of t) {
        applied[x.from] += x.amountFils;
        applied[x.to] -= x.amountFils;
      }
      expect(Object.values(applied).every((v) => v === 0)).toBe(true);
    }
  });

  it("returns nothing when all settled", () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
  });
});

describe("reports", () => {
  it("summarises a month", () => {
    const mk = (id: string, date: string, paidBy: string, amt: number, category: Expense["category"]): Expense => ({
      id,
      groupId: "g",
      description: id,
      amountFils: amt,
      date,
      paidBy,
      category,
      splitMethod: "equal",
      notes: "",
      receiptPath: null,
      createdBy: paidBy,
      createdAt: "",
      updatedAt: "",
      splits: splitEqual(amt, ids),
    });
    const s = summarizeMonth(
      "2026-03",
      [mk("1", "2026-03-02", "a", 12000, "lunch"), mk("2", "2026-03-10", "b", 4000, "coffee"), mk("3", "2026-02-10", "b", 9999, "lunch")],
      ids,
    );
    expect(s.totalFils).toBe(16000);
    expect(s.perMember.find((m) => m.userId === "a")).toMatchObject({ paidFils: 12000, shareFils: 4000 });
    expect(s.byCategory[0]).toEqual({ category: "lunch", totalFils: 12000 });
    expect(s.perMember.reduce((n, m) => n + m.shareFils, 0)).toBe(16000);
  });

  it("neutralises CSV formula injection", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("Lunch, with comma")).toBe('"Lunch, with comma"');
    expect(csvCell(-5)).toBe("-5");
  });
});
