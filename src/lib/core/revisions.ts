import { formatDate } from "./dates";
import { bpToPercentString, formatAed } from "./money";
import { CATEGORY_LABELS } from "../types";
import type { Expense, ExpenseRevision, ExpenseSnapshot } from "../types";

export interface FieldChange {
  field: "description" | "amount" | "date" | "paidBy" | "category" | "splitMethod" | "split" | "notes" | "receipt";
  label: string;
  before: string;
  after: string;
}

const METHOD_LABELS = { equal: "Equally", exact: "Exact amounts", percent: "By percentage" } as const;

/** Snapshot of an expense as it is right now. */
export function snapshotOf(e: Expense): ExpenseSnapshot {
  return {
    description: e.description,
    amountFils: e.amountFils,
    date: e.date,
    paidBy: e.paidBy,
    category: e.category,
    splitMethod: e.splitMethod,
    notes: e.notes,
    receiptPath: e.receiptPath,
    splits: e.splits.map((s) => ({ userId: s.userId, shareFils: s.shareFils, percentBp: s.percentBp ?? null })),
  };
}

function describeSplits(s: ExpenseSnapshot, nameOf: (id: string) => string): string {
  return s.splits
    .map((x) => ({
      name: nameOf(x.userId),
      text:
        s.splitMethod === "percent" && x.percentBp != null
          ? `${bpToPercentString(x.percentBp)}% · ${formatAed(x.shareFils)}`
          : formatAed(x.shareFils),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((x) => `${x.name} ${x.text}`)
    .join(", ");
}

/** Human-readable list of what differs between two snapshots. Empty = nothing changed. */
export function diffSnapshots(
  before: ExpenseSnapshot,
  after: ExpenseSnapshot,
  nameOf: (userId: string) => string,
): FieldChange[] {
  const out: FieldChange[] = [];
  const push = (field: FieldChange["field"], label: string, b: string, a: string) => {
    if (b !== a) out.push({ field, label, before: b, after: a });
  };

  push("amount", "Amount", formatAed(before.amountFils), formatAed(after.amountFils));
  push("description", "Description", before.description, after.description);
  push("paidBy", "Paid by", nameOf(before.paidBy), nameOf(after.paidBy));
  push("date", "Date", formatDate(before.date), formatDate(after.date));
  push("category", "Category", CATEGORY_LABELS[before.category], CATEGORY_LABELS[after.category]);
  push("splitMethod", "Split method", METHOD_LABELS[before.splitMethod], METHOD_LABELS[after.splitMethod]);
  push("split", "Split", describeSplits(before, nameOf), describeSplits(after, nameOf));
  push("notes", "Notes", before.notes || "—", after.notes || "—");
  push(
    "receipt",
    "Receipt",
    before.receiptPath ? "attached" : "none",
    !after.receiptPath
      ? "none"
      : before.receiptPath && after.receiptPath !== before.receiptPath
        ? "replaced"
        : "attached",
  );
  return out;
}

export interface HistoryEntry {
  revision: ExpenseRevision;
  /** Changes vs the previous revision. Empty for the first entry or a no-op save. */
  changes: FieldChange[];
  isFirst: boolean;
}

/** Newest-first timeline with a diff against the preceding revision. */
export function buildHistory(revisions: ExpenseRevision[], nameOf: (id: string) => string): HistoryEntry[] {
  const asc = [...revisions].sort((a, b) => a.revision - b.revision);
  return asc
    .map((revision, i) => ({
      revision,
      isFirst: i === 0,
      changes: i === 0 ? [] : diffSnapshots(asc[i - 1].snapshot, revision.snapshot, nameOf),
    }))
    .reverse();
}

/** True when an expense was modified after it was created. */
export function wasEdited(e: Pick<Expense, "createdAt" | "updatedAt">): boolean {
  return e.updatedAt !== e.createdAt;
}
