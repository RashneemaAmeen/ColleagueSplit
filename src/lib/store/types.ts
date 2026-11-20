import type {
  ExpenseInput,
  ExpenseRevision,
  Group,
  GroupBundle,
  Profile,
  SettlementInput,
} from "../types";

export class AccessDeniedError extends Error {
  constructor(message = "You don't have access to this group") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class AuthError extends Error {
  constructor(message = "Please sign in") {
    super(message);
    this.name = "AuthError";
  }
}

export interface ProfileUpdate {
  name?: string;
  colorIndex?: number;
  /** `Blob` to set a new avatar, `null` to remove it, undefined to leave unchanged. */
  avatar?: Blob | null;
}

/**
 * The single data-access contract used by the UI. Two implementations exist:
 *  - DemoRepo (browser localStorage, sample data) — used when Supabase is not configured
 *  - SupabaseRepo (Postgres + RLS + RPC functions)
 * Both enforce the same authorization and validation rules.
 */
export interface Repo {
  readonly mode: "demo" | "supabase";

  getCurrentUser(): Promise<Profile | null>;
  signUp(email: string, password: string, name: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  updateProfile(update: ProfileUpdate): Promise<Profile>;

  listGroups(): Promise<Group[]>;
  createGroup(name: string): Promise<string>;
  /** Throws AccessDeniedError when the caller is not a member. */
  loadGroup(groupId: string): Promise<GroupBundle>;
  createInvitation(groupId: string): Promise<{ code: string; expiresAt: string }>;
  joinGroup(code: string): Promise<string>;

  saveExpense(input: ExpenseInput): Promise<string>;
  deleteExpense(groupId: string, expenseId: string): Promise<void>;
  /** Append-only change history for one expense, oldest first. Members of the group only. */
  loadExpenseHistory(groupId: string, expenseId: string): Promise<ExpenseRevision[]>;
  recordSettlement(input: SettlementInput): Promise<string>;
  undoSettlement(groupId: string, settlementId: string, reason: string): Promise<void>;

  uploadReceipt(groupId: string, file: File): Promise<string>;
  getReceiptUrl(path: string): Promise<string>;
}

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
