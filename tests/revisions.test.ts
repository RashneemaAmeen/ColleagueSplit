import { beforeEach, describe, expect, it } from "vitest";
import { computeShares } from "@/lib/core/money";
import { buildHistory, diffSnapshots, snapshotOf, wasEdited } from "@/lib/core/revisions";
import { DemoRepo, MemoryStorage } from "@/lib/store/demo";
import { createSeedState, DEMO_GROUP_ID } from "@/lib/store/demo-seed";
import { uuid } from "@/lib/store/ids";
import { AccessDeniedError } from "@/lib/store/types";
import type { ExpenseInput } from "@/lib/types";

const A = "u-aisha";
const O = "u-omar";
const P = "u-priya";
const R = "u-rashid";
const SAM = "u-sam";
const all = [A, O, P, R];
const names: Record<string, string> = { [A]: "Aisha", [O]: "Omar", [P]: "Priya", [R]: "Rashid" };
const nameOf = (id: string) => names[id] ?? id;

let repo: DemoRepo;

function input(over: Partial<ExpenseInput> = {}): ExpenseInput {
  const amountFils = over.amountFils ?? 12000;
  const shares = computeShares({ method: "equal", totalFils: amountFils, participantIds: all }).shares;
  return {
    clientRequestId: uuid(),
    groupId: DEMO_GROUP_ID,
    description: "Lunch",
    amountFils,
    date: "2026-03-05",
    paidBy: O,
    category: "lunch",
    splitMethod: "equal",
    notes: "",
    receiptPath: null,
    splits: shares.map((s) => ({ userId: s.userId, shareFils: s.shareFils })),
    ...over,
  };
}

beforeEach(() => {
  repo = new DemoRepo(new MemoryStorage());
  repo.switchUser(O);
});

describe("expense history (audit trail)", () => {
  it("records creation, an amount change by the same person, and deletion — in order", async () => {
    const id = await repo.saveExpense(input());
    await repo.saveExpense(input({ id, amountFils: 16000 }));
    await repo.deleteExpense(DEMO_GROUP_ID, id);

    const rev = await repo.loadExpenseHistory(DEMO_GROUP_ID, id);
    expect(rev.map((r) => [r.revision, r.action])).toEqual([
      [1, "created"],
      [2, "edited"],
      [3, "deleted"],
    ]);
    expect(rev.every((r) => r.changedBy === O)).toBe(true);
    expect(rev[0].snapshot.amountFils).toBe(12000);
    expect(rev[1].snapshot.amountFils).toBe(16000);
  });

  it("shows exactly what changed: amount 120.00 → 160.00 and the recalculated split", async () => {
    const id = await repo.saveExpense(input());
    await repo.saveExpense(input({ id, amountFils: 16000 }));
    const entries = buildHistory(await repo.loadExpenseHistory(DEMO_GROUP_ID, id), nameOf);

    const edit = entries[0]; // newest first
    expect(edit.revision.action).toBe("edited");
    const amount = edit.changes.find((c) => c.field === "amount");
    expect(amount).toEqual({ field: "amount", label: "Amount", before: "AED 120.00", after: "AED 160.00" });
    expect(edit.changes.find((c) => c.field === "split")?.after).toContain("Aisha AED 40.00");
    expect(entries[1].changes).toEqual([]); // first entry has nothing to compare with
  });

  it("captures changes other than the amount (payer, date, category, notes)", async () => {
    const id = await repo.saveExpense(input());
    await repo.saveExpense(input({ id, paidBy: A, date: "2026-03-06", category: "dinner", notes: "client" }));
    const [edit] = buildHistory(await repo.loadExpenseHistory(DEMO_GROUP_ID, id), nameOf);
    const fields = edit.changes.map((c) => c.field).sort();
    expect(fields).toEqual(["category", "date", "notes", "paidBy"]);
    expect(edit.changes.find((c) => c.field === "paidBy")).toMatchObject({ before: "Omar", after: "Aisha" });
  });

  it("records who made the change when an admin edits someone else's expense", async () => {
    const id = await repo.saveExpense(input());
    repo.switchUser(A); // Aisha is the group admin
    await repo.saveExpense(input({ id, amountFils: 9000 }));
    const rev = await repo.loadExpenseHistory(DEMO_GROUP_ID, id);
    expect(rev[0].changedBy).toBe(O);
    expect(rev[1].changedBy).toBe(A);
  });

  it("flags a save with no real changes as an empty diff", async () => {
    const id = await repo.saveExpense(input());
    await repo.saveExpense(input({ id }));
    const [edit] = buildHistory(await repo.loadExpenseHistory(DEMO_GROUP_ID, id), nameOf);
    expect(edit.revision.action).toBe("edited");
    expect(edit.changes).toEqual([]);
  });

  it("a failed or rejected edit leaves no history entry", async () => {
    const id = await repo.saveExpense(input());
    repo.switchUser(P); // not creator, payer or admin
    await expect(repo.saveExpense(input({ id, amountFils: 1000 }))).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(repo.saveExpense(input({ id, amountFils: -5 }))).rejects.toBeDefined();
    expect(await repo.loadExpenseHistory(DEMO_GROUP_ID, id)).toHaveLength(1);
  });

  it("a duplicate submission does not add a second 'created' entry", async () => {
    const dup = input();
    const id = await repo.saveExpense(dup);
    await repo.saveExpense(dup);
    expect(await repo.loadExpenseHistory(DEMO_GROUP_ID, id)).toHaveLength(1);
  });

  it("non-members cannot read an expense's history", async () => {
    const id = await repo.saveExpense(input());
    repo.switchUser(SAM);
    await expect(repo.loadExpenseHistory(DEMO_GROUP_ID, id)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("history is returned as a copy: callers cannot alter the stored trail", async () => {
    const id = await repo.saveExpense(input());
    const first = await repo.loadExpenseHistory(DEMO_GROUP_ID, id);
    first[0].snapshot.amountFils = 1;
    first.pop();
    const again = await repo.loadExpenseHistory(DEMO_GROUP_ID, id);
    expect(again).toHaveLength(1);
    expect(again[0].snapshot.amountFils).toBe(12000);
  });

  it("seed expenses start with a baseline entry", async () => {
    const rev = await repo.loadExpenseHistory(DEMO_GROUP_ID, "e-seed-1");
    expect(rev.map((r) => r.action)).toEqual(["baseline"]);
  });

  it("demo data saved before history existed is upgraded with baseline entries", async () => {
    const storage = new MemoryStorage();
    const legacy = createSeedState() as unknown as Record<string, unknown>;
    delete legacy.revisions;
    storage.save(JSON.stringify(legacy));
    const r = new DemoRepo(storage);
    r.switchUser(A);
    const rev = await r.loadExpenseHistory(DEMO_GROUP_ID, "e-seed-2");
    expect(rev).toHaveLength(1);
    expect(rev[0].action).toBe("baseline");
  });
});

describe("diffSnapshots / wasEdited", () => {
  const base = {
    description: "Lunch",
    amountFils: 12000,
    date: "2026-03-05",
    paidBy: O,
    category: "lunch" as const,
    splitMethod: "equal" as const,
    notes: "",
    receiptPath: null,
    splits: [
      { userId: A, shareFils: 6000 },
      { userId: O, shareFils: 6000 },
    ],
  };

  it("returns nothing when snapshots are identical", () => {
    expect(diffSnapshots(base, structuredClone(base), nameOf)).toEqual([]);
  });

  it("detects who was added to or removed from a split", () => {
    const after = { ...base, splits: [{ userId: A, shareFils: 12000 }] };
    const split = diffSnapshots(base, after, nameOf).find((c) => c.field === "split")!;
    expect(split.before).toBe("Aisha AED 60.00, Omar AED 60.00");
    expect(split.after).toBe("Aisha AED 120.00");
  });

  it("detects receipt added and replaced", () => {
    expect(diffSnapshots(base, { ...base, receiptPath: "g/1" }, nameOf)[0]).toMatchObject({ field: "receipt", before: "none", after: "attached" });
    expect(diffSnapshots({ ...base, receiptPath: "g/1" }, { ...base, receiptPath: "g/2" }, nameOf)[0].after).toBe("replaced");
  });

  it("wasEdited reflects updatedAt vs createdAt, and snapshotOf copies the splits", async () => {
    const id = await repo.saveExpense(input());
    const b1 = await repo.loadGroup(DEMO_GROUP_ID);
    const created = b1.expenses.find((e) => e.id === id)!;
    expect(wasEdited(created)).toBe(false);
    expect(wasEdited({ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" })).toBe(true);
    const snap = snapshotOf(created);
    snap.splits[0].shareFils = 1;
    expect(created.splits[0].shareFils).not.toBe(1);
  });
});
