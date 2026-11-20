import { beforeEach, describe, expect, it } from "vitest";
import { computeBalances, simplifyDebts, sumBalances, totalSpend } from "@/lib/core/balances";
import { canConfirm, findMergeCandidate, settlementStatus } from "@/lib/core/settlements";
import { ValidationError } from "@/lib/core/validate";
import { DemoRepo, MemoryStorage } from "@/lib/store/demo";
import { DEMO_GROUP_ID } from "@/lib/store/demo-seed";
import { uuid } from "@/lib/store/ids";
import { AccessDeniedError } from "@/lib/store/types";
import type { Settlement, SettlementInput } from "@/lib/types";

// Rashneema = A (receiver, admin), Sam = O (payer), Priya = P (extra member), Rashid = R
const RASH = "u-aisha";
const SAM = "u-omar";
const PRIYA = "u-priya";
const RASHID = "u-rashid";
const OUTSIDER = "u-sam";

let repo: DemoRepo;
let gid: string;

const pay = (from: string, to: string, amountFils: number, over: Partial<SettlementInput> = {}): SettlementInput => ({
  clientRequestId: uuid(),
  groupId: gid,
  fromUser: from,
  toUser: to,
  amountFils,
  method: "cash",
  date: "2026-11-20",
  note: "",
  ...over,
});

async function snapshot() {
  const b = await repo.loadGroup(gid);
  const ids = b.members.map((m) => m.userId);
  const balances = computeBalances(ids, b.expenses, b.settlements);
  return { b, balances, active: b.settlements.filter((s) => !s.undoneAt) };
}

/** "Snack at Puranmal": AED 62 paid by Rashneema, exact shares 35 (Rashneema) / 27 (Sam). */
async function addSnack() {
  repo.switchUser(RASH);
  await repo.saveExpense({
    clientRequestId: uuid(),
    groupId: gid,
    description: "Snack at Puranmal",
    amountFils: 6200,
    date: "2026-11-20",
    paidBy: RASH,
    category: "snacks",
    splitMethod: "exact",
    notes: "",
    receiptPath: null,
    splits: [
      { userId: RASH, shareFils: 3500 },
      { userId: SAM, shareFils: 2700 },
    ],
  });
}

beforeEach(async () => {
  repo = new DemoRepo(new MemoryStorage());
  repo.switchUser(RASH);
  gid = await repo.createGroup("Settle test");
  const { code } = await repo.createInvitation(gid);
  for (const u of [SAM, PRIYA, RASHID]) {
    repo.switchUser(u);
    await repo.joinGroup(code);
  }
  await addSnack();
});

describe("the reported scenario: Sam owes Rashneema AED 27", () => {
  it("Sam taps 'I paid', Rashneema taps 'Confirm receipt' → ONE settlement, both balances zero", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));

    let s = await snapshot();
    expect(s.active).toHaveLength(1);
    expect(settlementStatus(s.active[0])).toBe("awaiting");
    expect(s.balances[SAM]).toBe(0); // applied immediately, from the moment it is recorded
    expect(s.balances[RASH]).toBe(0);

    repo.switchUser(RASH);
    await repo.confirmSettlement(gid, id);

    s = await snapshot();
    expect(s.b.settlements).toHaveLength(1); // still just one record
    expect(s.active[0]).toMatchObject({ id, amountFils: 2700, confirmedBy: RASH, createdBy: SAM });
    expect(settlementStatus(s.active[0])).toBe("confirmed");
    expect(s.balances[SAM]).toBe(0);
    expect(s.balances[RASH]).toBe(0);
    expect(sumBalances(s.balances)).toBe(0);
    expect(simplifyDebts(s.balances)).toEqual([]);
  });

  it("reverse order: Rashneema records first, Sam confirms", async () => {
    repo.switchUser(RASH);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    let s = await snapshot();
    expect(settlementStatus(s.active[0])).toBe("awaiting");
    expect(s.balances[SAM]).toBe(0);

    repo.switchUser(SAM);
    await repo.confirmSettlement(gid, id);
    s = await snapshot();
    expect(s.b.settlements).toHaveLength(1);
    expect(s.active[0]).toMatchObject({ createdBy: RASH, confirmedBy: SAM });
    expect(settlementStatus(s.active[0])).toBe("confirmed");
    expect(s.balances[SAM]).toBe(0);
    expect(s.balances[RASH]).toBe(0);
  });

  it("confirming never changes balances or total spend", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 1000)); // partial
    const before = await snapshot();
    repo.switchUser(RASH);
    await repo.confirmSettlement(gid, id);
    const after = await snapshot();
    expect(after.balances).toEqual(before.balances);
    expect(after.balances[SAM]).toBe(-1700);
    expect(totalSpend(after.b.expenses)).toBe(6200);
  });
});

describe("no duplicate record when both sides act", () => {
  it("stale screen: payer recorded, receiver taps 'Received' (new request id) → merged into the same record", async () => {
    repo.switchUser(SAM);
    const first = await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(RASH); // receiver never refreshed, so the suggestion still shows
    const second = await repo.recordSettlement(pay(SAM, RASH, 2700));

    expect(second).toBe(first);
    const s = await snapshot();
    expect(s.b.settlements).toHaveLength(1);
    expect(settlementStatus(s.active[0])).toBe("confirmed");
    expect(s.active[0].confirmedBy).toBe(RASH);
    expect(s.balances[SAM]).toBe(0); // NOT +27 in Sam's favour, as the old bug produced
    expect(s.balances[RASH]).toBe(0);
  });

  it("stale screen, reverse: receiver recorded, payer taps 'I paid' → merged", async () => {
    repo.switchUser(RASH);
    const first = await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(SAM);
    const second = await repo.recordSettlement(pay(SAM, RASH, 2700));
    expect(second).toBe(first);
    const s = await snapshot();
    expect(s.b.settlements).toHaveLength(1);
    expect(s.active[0]).toMatchObject({ createdBy: RASH, confirmedBy: SAM });
    expect(s.balances[SAM]).toBe(0);
  });

  it("both tap at (almost) the same time from two devices → still exactly one record", async () => {
    // The demo store is single-threaded, so this fires both calls back-to-back without awaiting.
    // In Postgres the same guarantee comes from a per-pair advisory lock (see migration 0006).
    repo.switchUser(SAM);
    const p1 = repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(RASH);
    const p2 = repo.recordSettlement(pay(SAM, RASH, 2700));
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    const s = await snapshot();
    expect(s.b.settlements).toHaveLength(1);
    expect(s.balances[SAM]).toBe(0);
    expect(s.balances[RASH]).toBe(0);
  });

  it("repeated clicks with the same request id create / confirm only once", async () => {
    repo.switchUser(SAM);
    const req = pay(SAM, RASH, 2700);
    const ids = await Promise.all([repo.recordSettlement(req), repo.recordSettlement(req), repo.recordSettlement(req)]);
    expect(new Set(ids).size).toBe(1);

    repo.switchUser(RASH);
    await repo.confirmSettlement(gid, ids[0]);
    await repo.confirmSettlement(gid, ids[0]); // second tap is a harmless no-op
    await repo.confirmSettlement(gid, ids[0]);

    const s = await snapshot();
    expect(s.b.settlements).toHaveLength(1);
    expect(s.b.activity.filter((a) => a.action === "settlement_added")).toHaveLength(1);
    expect(s.b.activity.filter((a) => a.action === "settlement_confirmed")).toHaveLength(1);
  });

  it("a retry of the merging request (same id) does not create a new record afterwards", async () => {
    repo.switchUser(SAM);
    await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(RASH);
    const req = pay(SAM, RASH, 2700);
    const a = await repo.recordSettlement(req);
    const b = await repo.recordSettlement(req); // network retry
    expect(a).toBe(b);
    expect((await snapshot()).b.settlements).toHaveLength(1);
  });
});

describe("legitimate separate and partial payments are not blocked", () => {
  it("different amounts are separate records (partial payments)", async () => {
    repo.switchUser(SAM);
    await repo.recordSettlement(pay(SAM, RASH, 1000));
    repo.switchUser(RASH);
    await repo.recordSettlement(pay(SAM, RASH, 1700)); // not the same payment as the AED 10 one
    const s = await snapshot();
    expect(s.b.settlements).toHaveLength(2);
    expect(s.active.every((x) => settlementStatus(x) === "awaiting")).toBe(true);
    expect(s.balances[SAM]).toBe(0);
  });

  it("the same person can record two separate payments of the same amount", async () => {
    repo.switchUser(SAM);
    await repo.recordSettlement(pay(SAM, RASH, 1000));
    await repo.recordSettlement(pay(SAM, RASH, 1000)); // new request id, same creator → new payment
    const s = await snapshot();
    expect(s.b.settlements).toHaveLength(2);
    expect(s.balances[SAM]).toBe(-700);
  });

  it("a new payment after the first was confirmed is a new record", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 1000));
    repo.switchUser(RASH);
    await repo.confirmSettlement(gid, id);
    repo.switchUser(SAM);
    await repo.recordSettlement(pay(SAM, RASH, 1000));
    expect((await snapshot()).b.settlements).toHaveLength(2);
  });

  it("two pending same-amount payments: the receiver's 'Received' confirms only the oldest", async () => {
    repo.switchUser(SAM);
    await repo.recordSettlement(pay(SAM, RASH, 1000));
    await repo.recordSettlement(pay(SAM, RASH, 1000));
    repo.switchUser(RASH);
    await repo.recordSettlement(pay(SAM, RASH, 1000));
    const s = await snapshot();
    expect(s.b.settlements).toHaveLength(2);
    expect(s.active.map(settlementStatus).sort()).toEqual(["awaiting", "confirmed"]);
  });

  it("opposite direction is never merged", async () => {
    repo.switchUser(SAM);
    await repo.recordSettlement(pay(SAM, RASH, 1000));
    repo.switchUser(RASH);
    await repo.recordSettlement(pay(RASH, SAM, 1000));
    expect((await snapshot()).b.settlements).toHaveLength(2);
  });

  it("findMergeCandidate ignores other groups, undone and confirmed payments, and non-parties", () => {
    const base: Settlement = {
      id: "s1",
      groupId: "g1",
      fromUser: "p",
      toUser: "r",
      amountFils: 500,
      method: "cash",
      date: "2026-11-20",
      note: "",
      createdBy: "p",
      createdAt: "2026-11-20T10:00:00Z",
      confirmedAt: null,
      confirmedBy: null,
      undoneAt: null,
      undoneBy: null,
      undoReason: null,
    };
    const input = { groupId: "g1", fromUser: "p", toUser: "r", amountFils: 500 };
    expect(findMergeCandidate([base], input, "r")?.id).toBe("s1");
    expect(findMergeCandidate([base], input, "p")).toBeUndefined(); // same person who recorded it
    expect(findMergeCandidate([base], input, "someone-else")).toBeUndefined();
    expect(findMergeCandidate([base], { ...input, groupId: "g2" }, "r")).toBeUndefined();
    expect(findMergeCandidate([{ ...base, undoneAt: "x", undoneBy: "p", undoReason: "r" }], input, "r")).toBeUndefined();
    expect(findMergeCandidate([{ ...base, confirmedAt: "x", confirmedBy: "r" }], input, "r")).toBeUndefined();
  });
});

describe("confirmation authorization", () => {
  it("the person who recorded the payment cannot confirm it themselves", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    await expect(repo.confirmSettlement(gid, id)).rejects.toBeInstanceOf(AccessDeniedError);
    expect(settlementStatus((await snapshot()).active[0])).toBe("awaiting");
  });

  it("a member who is neither payer nor receiver cannot confirm", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(PRIYA);
    await expect(repo.confirmSettlement(gid, id)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("an admin who is not a party cannot confirm on someone's behalf", async () => {
    // Rashid creates his own group where he is admin; Rashneema and Sam are plain members.
    repo.switchUser(RASHID);
    const g2 = await repo.createGroup("Admin test");
    const { code } = await repo.createInvitation(g2);
    for (const u of [RASH, SAM]) {
      repo.switchUser(u);
      await repo.joinGroup(code);
    }
    repo.switchUser(SAM);
    const id = await repo.recordSettlement({ ...pay(SAM, RASH, 500), groupId: g2 });
    repo.switchUser(RASHID); // admin, but not a party
    await expect(repo.confirmSettlement(g2, id)).rejects.toBeInstanceOf(AccessDeniedError);
    repo.switchUser(RASH);
    await expect(repo.confirmSettlement(g2, id)).resolves.toBeUndefined();
  });

  it("an admin recording on behalf of two others lets either of them confirm", async () => {
    repo.switchUser(RASH); // admin of the test group, but we record a payment between Sam and Priya
    const id = await repo.recordSettlement(pay(SAM, PRIYA, 300));
    const st = (await snapshot()).active.find((x) => x.id === id)!;
    expect(canConfirm(st, SAM)).toBe(true);
    expect(canConfirm(st, PRIYA)).toBe(true);
    expect(canConfirm(st, RASH)).toBe(false);
    repo.switchUser(PRIYA);
    await repo.confirmSettlement(gid, id);
    expect(settlementStatus((await snapshot()).active.find((x) => x.id === id)!)).toBe("confirmed");
  });

  it("non-members cannot confirm or even see the payment", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(OUTSIDER);
    await expect(repo.confirmSettlement(gid, id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(repo.loadGroup(gid)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("confirming a payment from a different group is rejected", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(RASH);
    await expect(repo.confirmSettlement(DEMO_GROUP_ID, id)).rejects.toBeDefined();
  });
});

describe("undo still works (pending and confirmed)", () => {
  it("undoing an awaiting payment restores the debt; it can no longer be confirmed", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    await repo.undoSettlement(gid, id, "Wrong person");
    const s = await snapshot();
    expect(settlementStatus(s.b.settlements[0])).toBe("undone");
    expect(s.balances[SAM]).toBe(-2700);
    expect(s.balances[RASH]).toBe(2700);

    repo.switchUser(RASH);
    await expect(repo.confirmSettlement(gid, id)).rejects.toBeInstanceOf(ValidationError);
    expect((await snapshot()).balances[SAM]).toBe(-2700);
  });

  it("undoing a confirmed payment restores the debt and keeps the reason and audit entry", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(RASH);
    await repo.confirmSettlement(gid, id);
    await repo.undoSettlement(gid, id, "Never received it");
    const s = await snapshot();
    expect(settlementStatus(s.b.settlements[0])).toBe("undone");
    expect(s.b.settlements[0]).toMatchObject({ undoneBy: RASH, undoReason: "Never received it", confirmedBy: RASH });
    expect(s.balances[SAM]).toBe(-2700);
    expect(s.b.activity[0].action).toBe("settlement_undone");
  });

  it("an undone payment is not merged with a later identical one", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    await repo.undoSettlement(gid, id, "oops");
    repo.switchUser(RASH);
    const again = await repo.recordSettlement(pay(SAM, RASH, 2700));
    expect(again).not.toBe(id);
    expect((await snapshot()).b.settlements).toHaveLength(2);
  });
});

describe("audit log and history", () => {
  it("logs 'added' then 'confirmed' with names, and nothing extra", async () => {
    repo.switchUser(SAM);
    const id = await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(RASH);
    await repo.confirmSettlement(gid, id);
    const { b } = await snapshot();
    const entries = b.activity.filter((a) => a.entityId === id).map((a) => [a.action, a.actorId, a.summary]);
    expect(entries).toEqual([
      ["settlement_confirmed", RASH, expect.stringContaining("confirmed receiving AED 27.00")],
      ["settlement_added", SAM, expect.stringContaining("paid")],
    ]);
  });

  it("a merged stale tap is logged as a confirmation, not a second payment", async () => {
    repo.switchUser(SAM);
    await repo.recordSettlement(pay(SAM, RASH, 2700));
    repo.switchUser(RASH);
    await repo.recordSettlement(pay(SAM, RASH, 2700));
    const { b } = await snapshot();
    expect(b.activity.filter((a) => a.action === "settlement_added")).toHaveLength(1);
    expect(b.activity.filter((a) => a.action === "settlement_confirmed")).toHaveLength(1);
  });

  it("settlements that already existed (seed data) are shown as confirmed", async () => {
    repo.switchUser(RASH);
    const seeded = await repo.loadGroup(DEMO_GROUP_ID);
    expect(seeded.settlements.map(settlementStatus)).toEqual(["confirmed"]);
  });
});
