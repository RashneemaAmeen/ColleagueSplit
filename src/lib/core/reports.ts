import { CATEGORIES } from "../types";
import type { Category, Expense, Member, Settlement } from "../types";
import { filsToDecimal } from "./money";
import { monthKey } from "./dates";
import { settlementStatus } from "./settlements";

export interface MemberMonthStats {
  userId: string;
  paidFils: number;
  shareFils: number;
}

export interface MonthlySummary {
  month: string;
  totalFils: number;
  expenseCount: number;
  perMember: MemberMonthStats[];
  byCategory: { category: Category; totalFils: number }[];
}

export function summarizeMonth(
  month: string,
  expenses: Expense[],
  memberIds: string[],
): MonthlySummary {
  const inMonth = expenses.filter((e) => monthKey(e.date) === month);
  const per = new Map<string, MemberMonthStats>(
    memberIds.map((id) => [id, { userId: id, paidFils: 0, shareFils: 0 }]),
  );
  const cats = new Map<Category, number>();
  let total = 0;
  for (const e of inMonth) {
    total += e.amountFils;
    const payer = per.get(e.paidBy) ?? { userId: e.paidBy, paidFils: 0, shareFils: 0 };
    payer.paidFils += e.amountFils;
    per.set(e.paidBy, payer);
    for (const s of e.splits) {
      const m = per.get(s.userId) ?? { userId: s.userId, paidFils: 0, shareFils: 0 };
      m.shareFils += s.shareFils;
      per.set(s.userId, m);
    }
    cats.set(e.category, (cats.get(e.category) ?? 0) + e.amountFils);
  }
  return {
    month,
    totalFils: total,
    expenseCount: inMonth.length,
    perMember: [...per.values()],
    byCategory: CATEGORIES.filter((c) => cats.has(c))
      .map((c) => ({ category: c, totalFils: cats.get(c)! }))
      .sort((a, b) => b.totalFils - a.totalFils),
  };
}

/**
 * Spreadsheet formula-injection guard: text cells starting with = + - @ (or tab/CR)
 * are prefixed with an apostrophe so Excel/Sheets treat them as text.
 * Numbers are passed through untouched.
 */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const nameOf = (members: Member[], id: string) =>
  members.find((m) => m.userId === id)?.profile.name ?? "Unknown";

export function expensesToCsv(expenses: Expense[], members: Member[]): string {
  const header = [
    "Date",
    "Description",
    "Category",
    "Amount (AED)",
    "Paid by",
    "Split method",
    "Split between",
    "Notes",
  ];
  const rows = [...expenses]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => [
      e.date,
      e.description,
      e.category,
      filsToDecimal(e.amountFils),
      nameOf(members, e.paidBy),
      e.splitMethod,
      e.splits.map((s) => `${nameOf(members, s.userId)} ${filsToDecimal(s.shareFils)}`).join("; "),
      e.notes,
    ]);
  return toCsv([header, ...rows]);
}

export function summaryToCsv(
  summary: MonthlySummary,
  members: Member[],
  balances: Record<string, number>,
): string {
  const rows: (string | number)[][] = [
    ["Month", summary.month],
    ["Total spending (AED)", filsToDecimal(summary.totalFils)],
    [],
    ["Member", "Paid (AED)", "Share (AED)", "Outstanding balance (AED)"],
    ...summary.perMember.map((m) => [
      nameOf(members, m.userId),
      filsToDecimal(m.paidFils),
      filsToDecimal(m.shareFils),
      filsToDecimal(balances[m.userId] ?? 0),
    ]),
    [],
    ["Category", "Total (AED)"],
    ...summary.byCategory.map((c) => [c.category, filsToDecimal(c.totalFils)]),
  ];
  return toCsv(rows);
}

export function settlementsToCsv(settlements: Settlement[], members: Member[]): string {
  return toCsv([
    ["Date", "From", "To", "Amount (AED)", "Method", "Status"],
    ...settlements.map((s) => [
      s.date,
      nameOf(members, s.fromUser),
      nameOf(members, s.toUser),
      filsToDecimal(s.amountFils),
      s.method,
      settlementStatus(s),
    ]),
  ]);
}
