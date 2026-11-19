import { beforeEach, describe, expect, it } from "vitest";
import { computeBalances, sumBalances, totalSpend } from "@/lib/core/balances";
import { computeShares } from "@/lib/core/money";
import { ValidationError } from "@/lib/core/validate";
import { DemoRepo, MemoryStorage } from "@/lib/store/demo";
import { DEMO_GROUP_ID } from "@/lib/store/demo-seed";
import { uuid } from "@/lib/store/ids";
import { AccessDeniedError, NotFoundError } from "@/lib/store/types";
import type { ExpenseInput } from "@/lib/types";

const A = "u-aisha";
const O = "u-omar";
const P = "u-priya";
const R = "u-rashid";
const SAM = "u-sam";
const all = [A, O, P, R];

let repo: DemoRepo;
let gid: string;

function expenseInput(over: Partial<ExpenseInput> & { groupId?: string } = {}): ExpenseInput {
  const amountFils = over.amountFils ?? 12000;
  const participants = over.splits?.map((s) => s.userId) ?? all;
  const shares = computeShares({ method: "equal", totalFils: amountFils, participantIds: participants });
  // Custom `splits` passed by a test only lists participants (or deliberately bad shares).
  const explicit = over.splits && over.splits.some((s) => s.shareFils > 0) ? over.splits : undefined;
  const { splits: _ignored, ...rest } = over;
  void _ignored;
  return {
    clientRequestId: uuid(),
    groupId: gid,
    description: "Lunch",
    amountFils,
    date: "2026-03-05",
    paidBy: A,
    category: "lunch",
    splitMethod: "equal",
    notes: "",
    receiptPath: null,
    splits: explicit ?? shares.shares.map((s) => ({ userId: s.userId, shareFils: s.shareFils })),
    ...rest,
  };
}

async function balances() {
  const b = await repo.loadGroup(gid);
  return computeBalances(all, b.expenses, b.settlements);
}

beforeEach(async () => {
  repo = new DemoRepo(new MemoryStorage());
  repo.switchUser(A);
  // a clean group with all four colleagues, created through the real invite flow
  gid = await repo.createGroup("Test crew");
  const { code } = await repo.createInvitation(gid);
  for (const u of [O, P, R]) {
    repo.switchUser(u);
    await repo.joinGroup(code);
  }
  repo.switchUser(A);
});

describe("group access", () => {
  it("non-members cannot load a group", async () => {
    repo.switchUser(SAM);
    await expect(repo.loadGroup(DEMO_GROUP_ID)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(repo.loadGroup(gid)).rejects.toBeInstanceOf(AccessDeniedError);
  });
  it("non-members cannot write expenses or settlements", async () => {
    repo.switchUser(SAM);
    await expect(repo.saveExpense(expenseInput())).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      repo.recordSettlement({ clientRequestId: uuid(), groupId: gid, fromUser: O, toUser: A, amountFils: 100, method: "cash", date: "2026-03-05", note: "" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
  it("lists only the groups the user belongs to", async () => {
    repo.switchUser(SAM);
    expect(await repo.listGroups()).toEqual([]);
    repo.switchUser(A);
    expect((await repo.listGroups()).map((g) => g.id)).toContain(gid);
  });
  it("only admins can create invitations; bad codes are rejected generically", async () => {
    repo.switchUser(O);
    await expect(repo.createInvitation(gid)).rejects.toBeInstanceOf(AccessDeniedError);
    repo.switchUser(SAM);
    await expect(repo.joinGroup("NOTACODE0000")).rejects.toBeInstanceOf(NotFoundError);
  });
  it("an outsider can join with a valid code and then gets access", async () => {
    repo.switchUser(A);
    const { code } = await repo.createInvitation(gid);
    repo.switchUser(SAM);
    expect(await repo.joinGroup(code)).toBe(gid);
    await expect(repo.loadGroup(gid)).resolves.toBeTruthy();
  });
  it("expired invitations are rejected", async () => {
    let now = new Date("2026-03-01T00:00:00Z");
    const r = new DemoRepo(new MemoryStorage(), () => now);
    r.switchUser(A);
    const { code } = await r.createInvitation(DEMO_GROUP_ID);
    now = new Date("2026-03-20T00:00:00Z");
    r.switchUser(SAM);
    await expect(r.joinGroup(code)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("expenses", () => {
  it("equal split between four: A paid 120 → A +90, others −30", async () => {
    await repo.saveExpense(expenseInput());
    expect(await balances()).toEqual({ [A]: 9000, [O]: -3000, [P]: -3000, [R]: -3000 });
  });

  it("split between selected members only", async () => {
    await repo.saveExpense(
      expenseInput({ amountFils: 9000, splits: [{ userId: A, shareFils: 0 }, { userId: O, shareFils: 0 }, { userId: P, shareFils: 0 }] }),
    );
    const b = await balances();
    expect(b[R]).toBe(0);
    expect(b[A]).toBe(6000);
  });

  it("rejects custom splits that don't add up to the total", async () => {
    await expect(
      repo.saveExpense(
        expenseInput({ splitMethod: "exact", splits: [{ userId: A, shareFils: 5000 }, { userId: O, shareFils: 5000 }] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a split that includes a non-member", async () => {
    await expect(
      repo.saveExpense(expenseInput({ amountFils: 1000, splits: [{ userId: A, shareFils: 500 }, { userId: SAM, shareFils: 500 }] })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("prevents duplicate submissions with the same request id", async () => {
    const input = expenseInput();
    const first = await repo.saveExpense(input);
    const second = await repo.saveExpense(input);
    expect(second).toBe(first);
    const b = await repo.loadGroup(gid);
    expect(b.expenses).toHaveLength(1);
    expect(totalSpend(b.expenses)).toBe(12000);
  });

  it("prevents duplicate settlements with the same request id", async () => {
    await repo.saveExpense(expenseInput());
    repo.switchUser(O);
    const s = { clientRequestId: uuid(), groupId: gid, fromUser: O, toUser: A, amountFils: 3000, method: "cash" as const, date: "2026-03-06", note: "" };
    const a = await repo.recordSettlement(s);
    const b = await repo.recordSettlement(s);
    expect(a).toBe(b);
    expect((await repo.loadGroup(gid)).settlements).toHaveLength(1);
  });

  it("editing recalculates balances and logs the activity", async () => {
    const id = await repo.saveExpense(expenseInput());
    await repo.saveExpense(expenseInput({ id, amountFils: 16000 }));
    expect((await balances())[A]).toBe(12000);
    const log = (await repo.loadGroup(gid)).activity.map((a) => a.action);
    expect(log).toContain("expense_edited");
    expect(log).toContain("expense_added");
  });

  it("deleting removes the effect, keeps an audit entry", async () => {
    const id = await repo.saveExpense(expenseInput());
    await repo.deleteExpense(gid, id);
    const bundle = await repo.loadGroup(gid);
    expect(bundle.expenses).toHaveLength(0);
    expect(Object.values(await balances()).every((v) => v === 0)).toBe(true);
    expect(bundle.activity[0].action).toBe("expense_deleted");
  });

  it("only the creator/payer or an admin may edit or delete", async () => {
    repo.switchUser(O);
    const id = await repo.saveExpense(expenseInput({ paidBy: O }));
    repo.switchUser(P);
    await expect(repo.deleteExpense(gid, id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(repo.saveExpense(expenseInput({ id, amountFils: 500 }))).rejects.toBeInstanceOf(AccessDeniedError);
    repo.switchUser(O);
    await expect(repo.deleteExpense(gid, id)).resolves.toBeUndefined();
    // admin can delete someone else's expense
    repo.switchUser(O);
    const id2 = await repo.saveExpense(expenseInput({ paidBy: O }));
    repo.switchUser(A);
    await expect(repo.deleteExpense(gid, id2)).resolves.toBeUndefined();
  });

  it("balances always sum to zero after a mix of operations", async () => {
    await repo.saveExpense(expenseInput({ amountFils: 4650 }));
    repo.switchUser(O);
    await repo.saveExpense(expenseInput({ amountFils: 8735, paidBy: O, splits: [{ userId: O, shareFils: 0 }, { userId: P, shareFils: 0 }, { userId: R, shareFils: 0 }] }));
    await repo.recordSettlement({ clientRequestId: uuid(), groupId: gid, fromUser: O, toUser: A, amountFils: 1000, method: "bank_transfer", date: "2026-03-06", note: "" });
    expect(sumBalances(await balances())).toBe(0);
  });
});

describe("settlements", () => {
  beforeEach(async () => {
    await repo.saveExpense(expenseInput());
  });
  const settle = (from: string, to: string, amountFils: number) => ({
    clientRequestId: uuid(), groupId: gid, fromUser: from, toUser: to, amountFils, method: "cash" as const, date: "2026-03-06", note: "",
  });

  it("full settlement zeroes the debt without changing total spend", async () => {
    repo.switchUser(O);
    await repo.recordSettlement(settle(O, A, 3000));
    const bundle = await repo.loadGroup(gid);
    expect((await balances())[O]).toBe(0);
    expect(totalSpend(bundle.expenses)).toBe(12000);
  });

  it("partial settlement leaves a remainder", async () => {
    repo.switchUser(O);
    await repo.recordSettlement(settle(O, A, 1250));
    expect((await balances())[O]).toBe(-1750);
  });

  it("members can't record payments between two other people", async () => {
    repo.switchUser(P);
    await expect(repo.recordSettlement(settle(O, R, 100))).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("rejects zero amounts and paying yourself", async () => {
    repo.switchUser(O);
    await expect(repo.recordSettlement(settle(O, A, 0))).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.recordSettlement(settle(O, O, 100))).rejects.toBeInstanceOf(ValidationError);
  });

  it("undo restores the debt, requires a reason, is authorised and audit-logged", async () => {
    repo.switchUser(O);
    const id = await repo.recordSettlement(settle(O, A, 3000));
    repo.switchUser(P);
    await expect(repo.undoSettlement(gid, id, "oops")).rejects.toBeInstanceOf(AccessDeniedError);
    repo.switchUser(O);
    await expect(repo.undoSettlement(gid, id, "  ")).rejects.toBeInstanceOf(ValidationError);
    await repo.undoSettlement(gid, id, "Entered wrong amount");
    expect((await balances())[O]).toBe(-3000);
    const b = await repo.loadGroup(gid);
    const s = b.settlements.find((x) => x.id === id)!;
    expect(s).toMatchObject({ undoneBy: O, undoReason: "Entered wrong amount" });
    expect(b.activity[0].action).toBe("settlement_undone");
    await expect(repo.undoSettlement(gid, id, "again")).rejects.toBeInstanceOf(ValidationError);
  });
});
