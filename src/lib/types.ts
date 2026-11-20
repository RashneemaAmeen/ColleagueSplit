// Shared domain types. All money is stored as integer fils (1 AED = 100 fils).

export const CATEGORIES = [
  "lunch",
  "breakfast",
  "dinner",
  "coffee",
  "snacks",
  "groceries",
  "transport",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SPLIT_METHODS = ["equal", "exact", "percent"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export const PAYMENT_METHODS = ["cash", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type MemberRole = "admin" | "member";

export interface Profile {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
  /** Index into the avatar colour palette. */
  colorIndex: number;
}

export interface Group {
  id: string;
  name: string;
  currency: "AED";
  createdBy: string;
  createdAt: string;
}

export interface Member {
  userId: string;
  role: MemberRole;
  joinedAt: string;
  profile: Profile;
}

export interface ExpenseSplit {
  userId: string;
  shareFils: number;
  /** Basis points (10000 = 100%); only set for percent splits. */
  percentBp?: number | null;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amountFils: number;
  /** YYYY-MM-DD */
  date: string;
  paidBy: string;
  category: Category;
  splitMethod: SplitMethod;
  notes: string;
  receiptPath: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  splits: ExpenseSplit[];
}

export interface Settlement {
  id: string;
  groupId: string;
  fromUser: string;
  toUser: string;
  amountFils: number;
  method: PaymentMethod;
  /** YYYY-MM-DD */
  date: string;
  note: string;
  createdBy: string;
  createdAt: string;
  undoneAt: string | null;
  undoneBy: string | null;
  undoReason: string | null;
}

export type ActivityAction =
  | "group_created"
  | "member_joined"
  | "expense_added"
  | "expense_edited"
  | "expense_deleted"
  | "settlement_added"
  | "settlement_undone";

export interface Activity {
  id: string;
  groupId: string;
  actorId: string;
  action: ActivityAction;
  entityType: "group" | "expense" | "settlement" | "member";
  entityId: string | null;
  summary: string;
  createdAt: string;
}

/** Everything the UI needs for one group. Small groups => one fetch is fine. */
export interface GroupBundle {
  group: Group;
  members: Member[];
  /** Active (non-deleted) expenses only. */
  expenses: Expense[];
  /** Includes undone settlements so history can show them. */
  settlements: Settlement[];
  activity: Activity[];
}

/** Full state of an expense at one point in time (stored in the append-only history). */
export interface ExpenseSnapshot {
  description: string;
  amountFils: number;
  date: string;
  paidBy: string;
  category: Category;
  splitMethod: SplitMethod;
  notes: string;
  receiptPath: string | null;
  splits: ExpenseSplit[];
}

/**
 * baseline = state when history tracking started (older expenses); created / edited / deleted
 * are recorded automatically on every change.
 */
export type RevisionAction = "baseline" | "created" | "edited" | "deleted";

export interface ExpenseRevision {
  id: string;
  expenseId: string;
  groupId: string;
  /** 1, 2, 3 … per expense. */
  revision: number;
  action: RevisionAction;
  /** null = changed directly in the database, not through the app. */
  changedBy: string | null;
  changedAt: string;
  snapshot: ExpenseSnapshot;
}

export interface ExpenseInput {
  /** Present when editing. */
  id?: string;
  /** Idempotency key generated once per form; prevents duplicate submissions. */
  clientRequestId: string;
  groupId: string;
  description: string;
  amountFils: number;
  date: string;
  paidBy: string;
  category: Category;
  splitMethod: SplitMethod;
  notes: string;
  receiptPath: string | null;
  splits: ExpenseSplit[];
}

export interface SettlementInput {
  clientRequestId: string;
  groupId: string;
  fromUser: string;
  toUser: string;
  amountFils: number;
  method: PaymentMethod;
  date: string;
  note: string;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  lunch: "Lunch",
  breakfast: "Breakfast",
  dinner: "Dinner",
  coffee: "Coffee",
  snacks: "Snacks",
  groceries: "Groceries",
  transport: "Transport",
  other: "Other",
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
};
