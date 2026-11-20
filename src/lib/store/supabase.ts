import type { SupabaseClient } from "@supabase/supabase-js";
import { ValidationError } from "../core/validate";
import type {
  Activity,
  Expense,
  ExpenseInput,
  ExpenseRevision,
  Group,
  GroupBundle,
  Member,
  Profile,
  Settlement,
  SettlementInput,
} from "../types";
import { uuid } from "./ids";
import {
  AccessDeniedError,
  AuthError,
  NotFoundError,
  RECEIPT_MAX_BYTES,
  RECEIPT_TYPES,
} from "./types";
import type { ProfileUpdate, Repo } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Map Postgres / PostgREST errors raised by our RPC functions to friendly app errors. */
function mapError(error: { code?: string; message: string } | null): never {
  const e = error ?? { message: "Unknown error" };
  switch (e.code) {
    case "28000":
      throw new AuthError();
    case "42501":
      throw new AccessDeniedError(e.message.includes("permission denied") ? undefined : e.message);
    case "P0002":
      throw new NotFoundError(e.message);
    case "22023":
    case "23514":
      throw new ValidationError([e.message]);
    default:
      throw new Error(e.message);
  }
}

const profileFrom = (p: any, email?: string): Profile => ({
  id: p.id,
  name: p.name,
  email,
  avatarUrl: p.avatar_url,
  colorIndex: p.color_index ?? 0,
});

export class SupabaseRepo implements Repo {
  readonly mode = "supabase" as const;
  constructor(private sb: SupabaseClient) {}

  private async uid(): Promise<string> {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) throw new AuthError();
    return data.user.id;
  }

  // ---------- auth ----------
  async getCurrentUser(): Promise<Profile | null> {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) return null;
    const { data: p } = await this.sb.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
    if (!p) return { id: data.user.id, name: data.user.email?.split("@")[0] ?? "Member", email: data.user.email, colorIndex: 0 };
    return profileFrom(p, data.user.email);
  }

  async signUp(email: string, password: string, name: string) {
    const { data, error } = await this.sb.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw new Error(error.message);
    return { needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message);
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async updateProfile(update: ProfileUpdate): Promise<Profile> {
    const id = await this.uid();
    const patch: Record<string, unknown> = {};
    if (update.name !== undefined) {
      const name = update.name.trim();
      if (name.length < 1 || name.length > 60) throw new ValidationError(["Name must be 1–60 characters"]);
      patch.name = name;
    }
    if (update.colorIndex !== undefined) patch.color_index = update.colorIndex;
    if (update.avatar === null) patch.avatar_url = null;
    else if (update.avatar) {
      const path = `${id}/${uuid()}.jpg`;
      const { error } = await this.sb.storage.from("avatars").upload(path, update.avatar, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (error) throw new Error(error.message);
      patch.avatar_url = this.sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }
    if (Object.keys(patch).length) {
      const { error } = await this.sb.from("profiles").update(patch).eq("id", id);
      if (error) mapError(error);
    }
    return (await this.getCurrentUser())!;
  }

  // ---------- groups ----------
  async listGroups(): Promise<Group[]> {
    const { data, error } = await this.sb.from("groups").select("*").order("created_at");
    if (error) mapError(error);
    return (data ?? []).map(groupFrom);
  }

  async createGroup(name: string) {
    const { data, error } = await this.sb.rpc("create_group", { p_name: name });
    if (error) mapError(error);
    return data as string;
  }

  async loadGroup(groupId: string): Promise<GroupBundle> {
    const [g, m, e, s, a] = await Promise.all([
      this.sb.from("groups").select("*").eq("id", groupId).maybeSingle(),
      this.sb
        .from("group_members")
        .select("user_id, role, joined_at, profiles(id, name, avatar_url, color_index)")
        .eq("group_id", groupId),
      this.sb
        .from("expenses")
        .select("*, expense_splits(user_id, share_fils, percent_bp)")
        .eq("group_id", groupId)
        .is("deleted_at", null)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false }),
      this.sb.from("settlements").select("*").eq("group_id", groupId).order("created_at", { ascending: false }),
      this.sb.from("activity_logs").select("*").eq("group_id", groupId).order("created_at", { ascending: false }).limit(100),
    ]);
    for (const r of [g, m, e, s, a]) if (r.error) mapError(r.error);
    // RLS hides groups the caller isn't a member of, so "not found" == "no access".
    if (!g.data) throw new AccessDeniedError();

    const members: Member[] = (m.data ?? []).map((r: any) => ({
      userId: r.user_id,
      role: r.role,
      joinedAt: r.joined_at,
      profile: profileFrom(r.profiles ?? { id: r.user_id, name: "Member", color_index: 0 }),
    }));
    const expenses: Expense[] = (e.data ?? []).map((r: any) => ({
      id: r.id,
      groupId: r.group_id,
      description: r.description,
      amountFils: Number(r.amount_fils),
      date: r.expense_date,
      paidBy: r.paid_by,
      category: r.category,
      splitMethod: r.split_method,
      notes: r.notes,
      receiptPath: r.receipt_path,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      splits: (r.expense_splits ?? []).map((x: any) => ({
        userId: x.user_id,
        shareFils: Number(x.share_fils),
        percentBp: x.percent_bp,
      })),
    }));
    const settlements: Settlement[] = (s.data ?? []).map((r: any) => ({
      id: r.id,
      groupId: r.group_id,
      fromUser: r.from_user,
      toUser: r.to_user,
      amountFils: Number(r.amount_fils),
      method: r.method,
      date: r.settled_on,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
      undoneAt: r.undone_at,
      undoneBy: r.undone_by,
      undoReason: r.undo_reason,
    }));
    const activity: Activity[] = (a.data ?? []).map((r: any) => ({
      id: r.id,
      groupId: r.group_id,
      actorId: r.actor_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      summary: r.summary,
      createdAt: r.created_at,
    }));
    return { group: groupFrom(g.data), members, expenses, settlements, activity };
  }

  async createInvitation(groupId: string) {
    const { data, error } = await this.sb.rpc("create_invitation", { p_group: groupId });
    if (error) mapError(error);
    return { code: data.code as string, expiresAt: data.expires_at as string };
  }

  async joinGroup(code: string) {
    const { data, error } = await this.sb.rpc("join_group", { p_code: code });
    if (error) mapError(error);
    return data as string;
  }

  // ---------- expenses ----------
  async saveExpense(input: ExpenseInput) {
    const { data, error } = await this.sb.rpc("save_expense", {
      p_expense_id: input.id ?? null,
      p_group: input.groupId,
      p_client_request_id: input.clientRequestId,
      p_description: input.description,
      p_amount_fils: input.amountFils,
      p_date: input.date,
      p_paid_by: input.paidBy,
      p_category: input.category,
      p_split_method: input.splitMethod,
      p_notes: input.notes,
      p_receipt_path: input.receiptPath,
      p_splits: input.splits.map((s) => ({
        user_id: s.userId,
        share_fils: s.shareFils,
        percent_bp: s.percentBp ?? null,
      })),
    });
    if (error) mapError(error);
    return data as string;
  }

  async deleteExpense(groupId: string, expenseId: string) {
    const { error } = await this.sb.rpc("delete_expense", { p_group: groupId, p_expense: expenseId });
    if (error) mapError(error);
  }

  async loadExpenseHistory(groupId: string, expenseId: string): Promise<ExpenseRevision[]> {
    const { data, error } = await this.sb
      .from("expense_revisions")
      .select("*")
      .eq("group_id", groupId)
      .eq("expense_id", expenseId)
      .order("revision", { ascending: true });
    if (error) mapError(error);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      expenseId: r.expense_id,
      groupId: r.group_id,
      revision: r.revision,
      action: r.action,
      changedBy: r.changed_by,
      changedAt: r.changed_at,
      snapshot: {
        description: r.snapshot.description,
        amountFils: Number(r.snapshot.amount_fils),
        date: r.snapshot.date,
        paidBy: r.snapshot.paid_by,
        category: r.snapshot.category,
        splitMethod: r.snapshot.split_method,
        notes: r.snapshot.notes ?? "",
        receiptPath: r.snapshot.receipt_path ?? null,
        splits: (r.snapshot.splits ?? []).map((x: any) => ({
          userId: x.user_id,
          shareFils: Number(x.share_fils),
          percentBp: x.percent_bp,
        })),
      },
    }));
  }

  // ---------- settlements ----------
  async recordSettlement(input: SettlementInput) {
    const { data, error } = await this.sb.rpc("record_settlement", {
      p_group: input.groupId,
      p_client_request_id: input.clientRequestId,
      p_from: input.fromUser,
      p_to: input.toUser,
      p_amount_fils: input.amountFils,
      p_method: input.method,
      p_date: input.date,
      p_note: input.note,
    });
    if (error) mapError(error);
    return data as string;
  }

  async undoSettlement(groupId: string, settlementId: string, reason: string) {
    const { error } = await this.sb.rpc("undo_settlement", {
      p_group: groupId,
      p_settlement: settlementId,
      p_reason: reason,
    });
    if (error) mapError(error);
  }

  // ---------- receipts ----------
  async uploadReceipt(groupId: string, file: File) {
    if (!RECEIPT_TYPES.includes(file.type)) throw new ValidationError(["Receipt must be a JPG, PNG, WebP or PDF"]);
    if (file.size > RECEIPT_MAX_BYTES) throw new ValidationError(["Receipt must be smaller than 5 MB"]);
    const path = `${groupId}/${uuid()}`;
    const { error } = await this.sb.storage.from("receipts").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return path;
  }

  async getReceiptUrl(path: string) {
    const { data, error } = await this.sb.storage.from("receipts").createSignedUrl(path, 60);
    if (error || !data) throw new AccessDeniedError("Receipt unavailable");
    return data.signedUrl;
  }
}

const groupFrom = (r: any): Group => ({
  id: r.id,
  name: r.name,
  currency: r.currency,
  createdBy: r.created_by,
  createdAt: r.created_at,
});
