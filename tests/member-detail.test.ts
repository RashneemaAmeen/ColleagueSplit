import { describe, expect, it } from "vitest";
import { computeBalances, simplifyDebts } from "@/lib/core/balances";
import { buildMemberDetail } from "@/lib/core/member-detail";
import { splitEqual } from "@/lib/core/money";
import type { Expense, Settlement } from "@/lib/types";

const R = "rashneema";
const SAM = "sam";
const AISHA = "aisha";
const ids = [R, SAM, AISHA];

function expense(over: Partial<Expense> & Pick<Expense, "id" | "paidBy" | "amountFils" | "splits">): Expense {
  return {
    groupId: "g",
    description: over.id,
    date: "2026-11-10",
    category: "snacks",
    splitMethod: "exact",
    notes: "",
    receiptPath: null,
    createdBy: over.paidBy,
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-10T10:00:00Z",
    ...over,
  };
}

function settlement(over: Partial<Settlement> & Pick<Settlement, "id" | "fromUser" | "toUser" | "amountFils">): Settlement {
  return {
    groupId: "g",
    method: "cash",
    date: "2026-11-12",
    note: "",
    createdBy: over.fromUser,
    createdAt: "2026-11-12T10:00:00Z",
    undoneAt: null,
    undoneBy: null,
    undoReason: null,
    ...over,
  };
}

function detail(memberId: string, expenses: Expense[], settlements: Settlement[] = [], members = ids) {
  const balances = computeBalances(members, expenses, settlements);
  const transfers = simplifyDebts(balances);
  return { d: buildMemberDetail(memberId, expenses, settlements, balances, transfers), balances, transfers };
}

// "Snack at Puranmal" — AED 62, paid by Rashneema, exact shares 35 (Rashneema) and 27 (Sam)
const snack = expense({
  id: "snack",
  description: "Snack at Puranmal",
  paidBy: R,
  amountFils: 6200,
  splits: [
    { userId: R, shareFils: 3500 },
    { userId: SAM, shareFils: 2700 },
  ],
});

describe("member detail — Snack at Puranmal example", () => {
  it("Sam owes Rashneema AED 27 and sees the expense", () => {
    const { d } = detail(SAM, [snack]);
    expect(d.totalPaidFils).toBe(0);
    expect(d.totalShareFils).toBe(2700);
    expect(d.netFils).toBe(-2700);
    expect(d.toPayFils).toBe(2700);
    expect(d.toReceiveFils).toBe(0);
    expect(d.owesSimplified).toEqual([{ userId: R, amountFils: 2700 }]);
    expect(d.owedBySimplified).toEqual([]);
    expect(d.expenses).toHaveLength(1);
    expect(d.expenses[0]).toMatchObject({ paidFils: 0, shareFils: 2700, netFils: -2700 });
  });

  it("Rashneema is owed AED 27 by Sam", () => {
    const { d } = detail(R, [snack]);
    expect(d.totalPaidFils).toBe(6200);
    expect(d.totalShareFils).toBe(3500);
    expect(d.netFils).toBe(2700);
    expect(d.toReceiveFils).toBe(2700);
    expect(d.owedBySimplified).toEqual([{ userId: SAM, amountFils: 2700 }]);
    expect(d.expenses[0]).toMatchObject({ paidFils: 6200, shareFils: 3500, netFils: 2700 });
  });

  it("Aisha is settled up with no expenses", () => {
    const { d } = detail(AISHA, [snack]);
    expect(d.netFils).toBe(0);
    expect(d.owesSimplified).toEqual([]);
    expect(d.owedBySimplified).toEqual([]);
    expect(d.expenses).toEqual([]);
    expect(d.settlements).toEqual([]);
  });
});

describe("member detail — consistency with the shared calculation", () => {
  it("simplified instructions equal the Settle Up transfers for that member", () => {
    const e = [
      expense({ id: "a", paidBy: R, amountFils: 9000, splitMethod: "equal", splits: splitEqual(9000, ids) }),
      expense({ id: "b", paidBy: SAM, amountFils: 4000, splitMethod: "equal", splits: splitEqual(4000, [SAM, AISHA]) }),
    ];
    const { transfers, d } = detail(AISHA, e);
    const mine = transfers.filter((t) => t.from === AISHA || t.to === AISHA);
    expect(d.owesSimplified.length + d.owedBySimplified.length).toBe(mine.length);
    for (const t of transfers.filter((x) => x.from === AISHA)) {
      expect(d.owesSimplified).toContainEqual({ userId: t.to, amountFils: t.amountFils });
    }
  });

  it("original pairwise debts always add up to the member's net balance", () => {
    const e = [
      expense({ id: "a", paidBy: R, amountFils: 9100, splitMethod: "equal", splits: splitEqual(9100, ids) }),
      expense({ id: "b", paidBy: SAM, amountFils: 4001, splitMethod: "equal", splits: splitEqual(4001, [SAM, AISHA]) }),
      expense({ id: "c", paidBy: AISHA, amountFils: 777, splitMethod: "equal", splits: splitEqual(777, [R, AISHA]) }),
    ];
    const s = [settlement({ id: "s1", fromUser: AISHA, toUser: R, amountFils: 500 })];
    for (const id of ids) {
      const { d } = detail(id, e, s);
      const owedBy = d.owedByOriginal.reduce((n, x) => n + x.amountFils, 0);
      const owes = d.owesOriginal.reduce((n, x) => n + x.amountFils, 0);
      expect(owedBy - owes).toBe(d.netFils);
    }
  });

  it("explains simplification: B owes A and C owes B, so Settle Up says C pays A", () => {
    const A = "a";
    const B = "b";
    const C = "c";
    const e = [
      expense({ id: "1", paidBy: A, amountFils: 3000, splits: [{ userId: B, shareFils: 3000 }] }),
      expense({ id: "2", paidBy: B, amountFils: 3000, splits: [{ userId: C, shareFils: 3000 }] }),
    ];
    const { d } = detail(B, e, [], [A, B, C]);
    expect(d.owesOriginal).toEqual([{ userId: A, amountFils: 3000 }]);
    expect(d.owedByOriginal).toEqual([{ userId: C, amountFils: 3000 }]);
    expect(d.owesSimplified).toEqual([]);
    expect(d.owedBySimplified).toEqual([]);
    expect(d.simplificationApplied).toBe(true);
    const { d: dc } = detail(C, e, [], [A, B, C]);
    expect(dc.owesSimplified).toEqual([{ userId: A, amountFils: 3000 }]);
  });

  it("flags no simplification when instructions match the original debts", () => {
    const { d } = detail(SAM, [snack]);
    expect(d.simplificationApplied).toBe(false);
  });
});

describe("member detail — settlements", () => {
  it("lists settlements involving the member and excludes undone ones from balances", () => {
    const active = settlement({ id: "s1", fromUser: SAM, toUser: R, amountFils: 1000 });
    const undone = settlement({
      id: "s2",
      fromUser: SAM,
      toUser: R,
      amountFils: 500,
      undoneAt: "2026-11-13T10:00:00Z",
      undoneBy: SAM,
      undoReason: "typo",
    });
    const other = settlement({ id: "s3", fromUser: AISHA, toUser: R, amountFils: 100 });
    const { d } = detail(SAM, [snack], [active, undone, other]);
    expect(d.netFils).toBe(-1700); // 2700 owed − 1000 active payment; undone 500 ignored
    expect(d.settlements.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(d.settlements.find((s) => s.id === "s2")?.undoneAt).toBeTruthy();
    // Aisha's unrelated 1.00 payment to Rashneema leaves Aisha owed 1.00, so the shared
    // simplification redirects 1.00 of Sam's 17.00 to Aisha. Total still equals Sam's balance.
    expect(d.owesSimplified).toEqual([
      { userId: R, amountFils: 1600 },
      { userId: AISHA, amountFils: 100 },
    ]);
    expect(d.owesSimplified.reduce((n, x) => n + x.amountFils, 0)).toBe(1700);
    expect(d.simplificationApplied).toBe(true);
    // original direct debt is still to Rashneema only
    expect(d.owesOriginal).toEqual([{ userId: R, amountFils: 1700 }]);
  });

  it("only active expenses passed in are counted (deleted ones are excluded upstream)", () => {
    const { d } = detail(SAM, []);
    expect(d.netFils).toBe(0);
    expect(d.expenses).toEqual([]);
  });
});
