import type { BalanceMap, Transfer } from "./balances";
import type { Expense, Settlement } from "../types";

/**
 * View-model for the per-member balance sheet on the dashboard.
 *
 * It does NOT compute balances itself: the net balance and the simplified payment
 * instructions are passed in from `computeBalances` / `simplifyDebts` (the same values the
 * Settle Up screen uses). The only extra derivation is the *original* direct debts between
 * this member and each other member, which exist to explain why simplification may redirect
 * a payment (e.g. B owes A and C owes B  =>  Settle Up says "C pays A").
 */

export interface MemberExpenseLine {
  expense: Expense;
  /** Amount this member paid up front for the expense (0 if someone else paid). */
  paidFils: number;
  /** This member's personal share (0 if they only paid for others). */
  shareFils: number;
  /** paid - share: positive = lent to others, negative = borrowed. */
  netFils: number;
}

export interface CounterpartyAmount {
  userId: string;
  amountFils: number;
}

export interface MemberDetail {
  memberId: string;
  /** Total of expenses this member paid for. */
  totalPaidFils: number;
  /** Total of this member's own shares across all active expenses. */
  totalShareFils: number;
  /** Net outstanding (positive = owed to them, negative = they owe). Same as the dashboard balance. */
  netFils: number;
  toReceiveFils: number;
  toPayFils: number;
  /** Simplified payment instructions — identical to the Settle Up screen. */
  owesSimplified: CounterpartyAmount[];
  owedBySimplified: CounterpartyAmount[];
  /** Direct debts from expenses and active settlements, before simplification. */
  owesOriginal: CounterpartyAmount[];
  owedByOriginal: CounterpartyAmount[];
  /** True when the simplified instructions differ from the original direct debts. */
  simplificationApplied: boolean;
  expenses: MemberExpenseLine[];
  /** Every settlement involving the member, including undone ones. */
  settlements: Settlement[];
}

const byAmountThenId = (a: CounterpartyAmount, b: CounterpartyAmount) =>
  b.amountFils - a.amountFils || a.userId.localeCompare(b.userId);

/** Direct pairwise position of `memberId` vs every other person. Positive = they owe the member. */
function pairwise(
  memberId: string,
  expenses: Pick<Expense, "paidBy" | "splits">[],
  settlements: Pick<Settlement, "fromUser" | "toUser" | "amountFils" | "undoneAt">[],
): Map<string, number> {
  const net = new Map<string, number>();
  const add = (id: string, v: number) => net.set(id, (net.get(id) ?? 0) + v);

  for (const e of expenses) {
    if (e.paidBy === memberId) {
      for (const s of e.splits) if (s.userId !== memberId) add(s.userId, s.shareFils);
    } else {
      const mine = e.splits.find((s) => s.userId === memberId);
      if (mine) add(e.paidBy, -mine.shareFils);
    }
  }
  for (const s of settlements) {
    if (s.undoneAt) continue;
    if (s.fromUser === memberId) add(s.toUser, s.amountFils); // member paid: they now owe less
    else if (s.toUser === memberId) add(s.fromUser, -s.amountFils);
  }
  return net;
}

function split(net: Map<string, number>): { owes: CounterpartyAmount[]; owedBy: CounterpartyAmount[] } {
  const owes: CounterpartyAmount[] = [];
  const owedBy: CounterpartyAmount[] = [];
  for (const [userId, v] of net) {
    if (v > 0) owedBy.push({ userId, amountFils: v });
    else if (v < 0) owes.push({ userId, amountFils: -v });
  }
  return { owes: owes.sort(byAmountThenId), owedBy: owedBy.sort(byAmountThenId) };
}

const sameList = (a: CounterpartyAmount[], b: CounterpartyAmount[]) =>
  a.length === b.length && a.every((x, i) => x.userId === b[i].userId && x.amountFils === b[i].amountFils);

export function buildMemberDetail(
  memberId: string,
  expenses: Expense[],
  settlements: Settlement[],
  balances: BalanceMap,
  transfers: Transfer[],
): MemberDetail {
  const lines: MemberExpenseLine[] = [];
  let totalPaid = 0;
  let totalShare = 0;
  for (const expense of expenses) {
    const paid = expense.paidBy === memberId ? expense.amountFils : 0;
    const share = expense.splits.find((s) => s.userId === memberId)?.shareFils ?? 0;
    const involved = expense.paidBy === memberId || expense.splits.some((s) => s.userId === memberId);
    if (!involved) continue;
    totalPaid += paid;
    totalShare += share;
    lines.push({ expense, paidFils: paid, shareFils: share, netFils: paid - share });
  }
  lines.sort(
    (a, b) => b.expense.date.localeCompare(a.expense.date) || b.expense.createdAt.localeCompare(a.expense.createdAt),
  );

  const net = balances[memberId] ?? 0;

  const simplifiedOwes = transfers
    .filter((t) => t.from === memberId)
    .map((t) => ({ userId: t.to, amountFils: t.amountFils }))
    .sort(byAmountThenId);
  const simplifiedOwedBy = transfers
    .filter((t) => t.to === memberId)
    .map((t) => ({ userId: t.from, amountFils: t.amountFils }))
    .sort(byAmountThenId);

  const original = split(pairwise(memberId, expenses, settlements));

  return {
    memberId,
    totalPaidFils: totalPaid,
    totalShareFils: totalShare,
    netFils: net,
    toReceiveFils: Math.max(net, 0),
    toPayFils: Math.max(-net, 0),
    owesSimplified: simplifiedOwes,
    owedBySimplified: simplifiedOwedBy,
    owesOriginal: original.owes,
    owedByOriginal: original.owedBy,
    simplificationApplied:
      !sameList(simplifiedOwes, original.owes) || !sameList(simplifiedOwedBy, original.owedBy),
    expenses: lines,
    settlements: settlements
      .filter((s) => s.fromUser === memberId || s.toUser === memberId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
  };
}
