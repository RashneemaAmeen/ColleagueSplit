import type { Expense, Settlement } from "../types";

export type BalanceMap = Record<string, number>;

export interface Transfer {
  from: string;
  to: string;
  amountFils: number;
}

/**
 * Net balance per member in fils. Positive = the group owes them,
 * negative = they owe the group. The values always sum to zero.
 *
 * expense: payer is credited the full amount, each participant debited their share.
 * settlement (from -> to): `from` is credited (debt reduced), `to` is debited.
 * Undone settlements are ignored.
 */
export function computeBalances(
  memberIds: string[],
  expenses: Pick<Expense, "amountFils" | "paidBy" | "splits">[],
  settlements: Pick<Settlement, "fromUser" | "toUser" | "amountFils" | "undoneAt">[],
): BalanceMap {
  const balances: BalanceMap = {};
  for (const id of memberIds) balances[id] = 0;
  const add = (id: string, v: number) => {
    balances[id] = (balances[id] ?? 0) + v;
  };
  for (const e of expenses) {
    add(e.paidBy, e.amountFils);
    for (const s of e.splits) add(s.userId, -s.shareFils);
  }
  for (const s of settlements) {
    if (s.undoneAt) continue;
    add(s.fromUser, s.amountFils);
    add(s.toUser, -s.amountFils);
  }
  return balances;
}

/**
 * Greedy debt simplification: repeatedly match the largest debtor with the
 * largest creditor. Produces at most (n - 1) payments, and each payment fully
 * clears at least one person. Deterministic: ties are broken by user id.
 */
export function simplifyDebts(balances: BalanceMap): Transfer[] {
  const creditors = Object.entries(balances)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }));
  const debtors = Object.entries(balances)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }));
  const byAmount = (a: { id: string; v: number }, b: { id: string; v: number }) =>
    b.v - a.v || a.id.localeCompare(b.id);

  const transfers: Transfer[] = [];
  while (creditors.length && debtors.length) {
    creditors.sort(byAmount);
    debtors.sort(byAmount);
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.v, d.v);
    transfers.push({ from: d.id, to: c.id, amountFils: amount });
    c.v -= amount;
    d.v -= amount;
    if (c.v === 0) creditors.shift();
    if (d.v === 0) debtors.shift();
  }
  return transfers;
}

export function sumBalances(b: BalanceMap): number {
  return Object.values(b).reduce((a, v) => a + v, 0);
}

export function totalSpend(expenses: Pick<Expense, "amountFils">[]): number {
  return expenses.reduce((a, e) => a + e.amountFils, 0);
}
