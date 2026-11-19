import { CATEGORIES, PAYMENT_METHODS, SPLIT_METHODS } from "../types";
import type { ExpenseInput, SettlementInput } from "../types";
import { isValidISODate } from "./dates";
import { MAX_AMOUNT_FILS } from "./money";

export class ValidationError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
    this.name = "ValidationError";
  }
}

/**
 * Validates an expense. The same rules are enforced again in Postgres
 * (see supabase/migrations/0003_functions.sql), so this is never the only line of defence.
 */
export function validateExpense(input: ExpenseInput, memberIds: string[]): string[] {
  const issues: string[] = [];
  const members = new Set(memberIds);
  const desc = input.description.trim();

  if (desc.length < 1) issues.push("Description is required");
  if (desc.length > 120) issues.push("Description must be 120 characters or fewer");
  if (!Number.isSafeInteger(input.amountFils) || input.amountFils <= 0)
    issues.push("Amount must be greater than zero");
  if (input.amountFils > MAX_AMOUNT_FILS) issues.push("Amount is too large");
  if (!isValidISODate(input.date)) issues.push("Date is invalid");
  if (!members.has(input.paidBy)) issues.push("Payer must be a group member");
  if (!(CATEGORIES as readonly string[]).includes(input.category)) issues.push("Invalid category");
  if (!(SPLIT_METHODS as readonly string[]).includes(input.splitMethod))
    issues.push("Invalid split method");
  if (input.notes.length > 500) issues.push("Notes must be 500 characters or fewer");

  if (input.splits.length === 0) issues.push("Select at least one person to split with");
  const seen = new Set<string>();
  let sum = 0;
  for (const s of input.splits) {
    if (!members.has(s.userId)) issues.push("Split includes someone who is not in the group");
    if (seen.has(s.userId)) issues.push("A person appears twice in the split");
    seen.add(s.userId);
    if (!Number.isSafeInteger(s.shareFils) || s.shareFils < 0) issues.push("Invalid share amount");
    sum += s.shareFils;
  }
  if (input.amountFils > 0 && sum !== input.amountFils)
    issues.push("Shares must add up exactly to the total");
  if (input.splitMethod === "percent") {
    const bp = input.splits.reduce((a, s) => a + (s.percentBp ?? 0), 0);
    if (bp !== 10000) issues.push("Percentages must total 100%");
  }
  return [...new Set(issues)];
}

export function validateSettlement(input: SettlementInput, memberIds: string[]): string[] {
  const issues: string[] = [];
  const members = new Set(memberIds);
  if (!members.has(input.fromUser) || !members.has(input.toUser))
    issues.push("Both people must be group members");
  if (input.fromUser === input.toUser) issues.push("Payer and receiver must be different people");
  if (!Number.isSafeInteger(input.amountFils) || input.amountFils <= 0)
    issues.push("Amount must be greater than zero");
  if (input.amountFils > MAX_AMOUNT_FILS) issues.push("Amount is too large");
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method))
    issues.push("Invalid payment method");
  if (!isValidISODate(input.date)) issues.push("Date is invalid");
  if (input.note.length > 300) issues.push("Note must be 300 characters or fewer");
  return issues;
}
