import { snapshotOf } from "../core/revisions";
import { validateExpense, validateSettlement, ValidationError } from "../core/validate";
import { formatAed } from "../core/money";
import type {
  Activity,
  ActivityAction,
  ExpenseInput,
  ExpenseRevision,
  Group,
  GroupBundle,
  Member,
  Profile,
  SettlementInput,
} from "../types";
import { baselineRevision, createSeedState } from "./demo-seed";
import type { DemoExpense, DemoState } from "./demo-seed";
import { inviteCode, uuid } from "./ids";
import {
  AccessDeniedError,
  AuthError,
  NotFoundError,
  RECEIPT_MAX_BYTES,
  RECEIPT_TYPES,
} from "./types";
import type { ProfileUpdate, Repo } from "./types";

export interface DemoStorage {
  load(): string | null;
  save(value: string): void;
}

export class MemoryStorage implements DemoStorage {
  private value: string | null = null;
  load() {
    return this.value;
  }
  save(v: string) {
    this.value = v;
  }
}

export class LocalDemoStorage implements DemoStorage {
  constructor(private key = "colleaguesplit-demo-v1") {}
  load() {
    try {
      return window.localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }
  save(v: string) {
    try {
      window.localStorage.setItem(this.key, v);
    } catch {
      /* storage full or blocked: demo simply won't persist */
    }
  }
}

/**
 * Demo implementation of the repository. It is intentionally strict: it applies the same
 * membership checks, validation, idempotency and authorization rules as the SQL functions
 * in supabase/migrations, so the UI and the tests exercise realistic behaviour.
 */
export class DemoRepo implements Repo {
  readonly mode = "demo" as const;

  constructor(
    private storage: DemoStorage,
    private now: () => Date = () => new Date(),
  ) {}

  // ---------- state helpers ----------
  private read(): DemoState {
    const raw = this.storage.load();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DemoState;
        if (parsed.version === 1) {
          // Data saved before history existed: add baseline entries (like the SQL backfill).
          if (!parsed.revisions) {
            parsed.revisions = parsed.expenses.filter((e) => !e.deletedAt).map((e) => baselineRevision(e));
            this.storage.save(JSON.stringify(parsed));
          }
          return parsed;
        }
      } catch {
        /* fall through to reseed */
      }
    }
    const seed = createSeedState();
    this.storage.save(JSON.stringify(seed));
    return seed;
  }

  private write(s: DemoState) {
    this.storage.save(JSON.stringify(s));
  }

  private me(s: DemoState): Profile {
    const u = s.users.find((x) => x.id === s.currentUserId);
    if (!u) throw new AuthError();
    return u;
  }

  private membership(s: DemoState, groupId: string, userId: string) {
    return s.members.find((m) => m.groupId === groupId && m.userId === userId);
  }

  private requireMember(s: DemoState, groupId: string) {
    const me = this.me(s);
    const m = this.membership(s, groupId, me.id);
    if (!m) throw new AccessDeniedError();
    return { me, membership: m };
  }

  private memberIds(s: DemoState, groupId: string) {
    return s.members.filter((m) => m.groupId === groupId).map((m) => m.userId);
  }

  private log(
    s: DemoState,
    groupId: string,
    action: ActivityAction,
    entityType: Activity["entityType"],
    entityId: string | null,
    summary: string,
  ) {
    s.activity.unshift({
      id: uuid(),
      groupId,
      actorId: s.currentUserId!,
      action,
      entityType,
      entityId,
      summary,
      createdAt: this.now().toISOString(),
    });
  }

  private recordRevision(s: DemoState, e: DemoExpense, action: ExpenseRevision["action"]) {
    const n = s.revisions.filter((r) => r.expenseId === e.id).length;
    s.revisions.push({
      id: uuid(),
      expenseId: e.id,
      groupId: e.groupId,
      revision: n + 1,
      action,
      changedBy: s.currentUserId,
      changedAt: this.now().toISOString(),
      snapshot: structuredClone(snapshotOf(e)),
    });
  }

  // ---------- demo-only helpers ----------
  listDemoUsers(): Profile[] {
    return this.read().users;
  }

  switchUser(userId: string) {
    const s = this.read();
    if (!s.users.some((u) => u.id === userId)) throw new NotFoundError("Unknown demo user");
    s.currentUserId = userId;
    this.write(s);
  }

  reset() {
    const seed = createSeedState();
    this.write(seed);
  }

  // ---------- auth ----------
  async getCurrentUser() {
    const s = this.read();
    return s.users.find((u) => u.id === s.currentUserId) ?? null;
  }
  async signUp(): Promise<{ needsConfirmation: boolean }> {
    throw new Error("Sign-up is disabled in demo mode. Pick a demo user instead.");
  }
  async signIn() {
    throw new Error("Sign-in is disabled in demo mode. Pick a demo user instead.");
  }
  async signOut() {
    const s = this.read();
    s.currentUserId = null;
    this.write(s);
  }

  async updateProfile(update: ProfileUpdate): Promise<Profile> {
    const s = this.read();
    const me = this.me(s);
    if (update.name !== undefined) {
      const name = update.name.trim();
      if (name.length < 1 || name.length > 60) throw new ValidationError(["Name must be 1–60 characters"]);
      me.name = name;
    }
    if (update.colorIndex !== undefined) me.colorIndex = update.colorIndex;
    if (update.avatar === null) me.avatarUrl = null;
    else if (update.avatar) me.avatarUrl = await blobToDataUrl(update.avatar);
    for (const m of s.members) if (m.userId === me.id) m.profile = { ...me };
    this.write(s);
    return { ...me };
  }

  // ---------- groups ----------
  async listGroups(): Promise<Group[]> {
    const s = this.read();
    const me = this.me(s);
    const ids = new Set(s.members.filter((m) => m.userId === me.id).map((m) => m.groupId));
    return s.groups.filter((g) => ids.has(g.id)).map((g) => ({ ...g }));
  }

  async createGroup(name: string): Promise<string> {
    const s = this.read();
    const me = this.me(s);
    const n = name.trim();
    if (n.length < 1 || n.length > 60) throw new ValidationError(["Group name must be 1–60 characters"]);
    const id = uuid();
    const at = this.now().toISOString();
    s.groups.push({ id, name: n, currency: "AED", createdBy: me.id, createdAt: at });
    s.members.push({ groupId: id, userId: me.id, role: "admin", joinedAt: at, profile: { ...me } });
    this.log(s, id, "group_created", "group", id, `Created the group "${n}"`);
    this.write(s);
    return id;
  }

  async loadGroup(groupId: string): Promise<GroupBundle> {
    const s = this.read();
    this.requireMember(s, groupId);
    const group = s.groups.find((g) => g.id === groupId);
    if (!group) throw new NotFoundError("Group not found");
    const members: Member[] = s.members
      .filter((m) => m.groupId === groupId)
      .map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        profile: { ...(s.users.find((u) => u.id === m.userId) ?? m.profile) },
      }));
    const expenses = s.expenses
      .filter((e) => e.groupId === groupId && !e.deletedAt)
      .map((e) => {
        const { deletedAt: _d, ...rest } = e;
        void _d;
        return rest;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const settlements = s.settlements
      .filter((x) => x.groupId === groupId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const activity = s.activity.filter((a) => a.groupId === groupId).slice(0, 100);
    return structuredClone({ group, members, expenses, settlements, activity });
  }

  async createInvitation(groupId: string) {
    const s = this.read();
    const { membership } = this.requireMember(s, groupId);
    if (membership.role !== "admin") throw new AccessDeniedError("Only group admins can invite people");
    const code = inviteCode();
    const expiresAt = new Date(this.now().getTime() + 7 * 86400_000).toISOString();
    s.invites.push({ code, groupId, expiresAt, maxUses: 10, uses: 0 });
    this.write(s);
    return { code, expiresAt };
  }

  async joinGroup(code: string): Promise<string> {
    const s = this.read();
    const me = this.me(s);
    const inv = s.invites.find((i) => i.code === code.trim().toUpperCase());
    // One generic error for unknown / expired / used-up codes (no information leak).
    if (!inv || new Date(inv.expiresAt) < this.now() || inv.uses >= inv.maxUses)
      throw new NotFoundError("This invitation is invalid or has expired");
    if (!this.membership(s, inv.groupId, me.id)) {
      s.members.push({
        groupId: inv.groupId,
        userId: me.id,
        role: "member",
        joinedAt: this.now().toISOString(),
        profile: { ...me },
      });
      inv.uses += 1;
      this.log(s, inv.groupId, "member_joined", "member", me.id, `${me.name} joined the group`);
      this.write(s);
    }
    return inv.groupId;
  }

  // ---------- expenses ----------
  private canModifyExpense(s: DemoState, e: DemoExpense, userId: string) {
    const m = this.membership(s, e.groupId, userId);
    return !!m && (m.role === "admin" || e.createdBy === userId || e.paidBy === userId);
  }

  async saveExpense(input: ExpenseInput): Promise<string> {
    const s = this.read();
    const { me } = this.requireMember(s, input.groupId);
    const issues = validateExpense(input, this.memberIds(s, input.groupId));
    if (issues.length) throw new ValidationError(issues);
    if (input.receiptPath && !input.receiptPath.startsWith(`${input.groupId}/`))
      throw new ValidationError(["Invalid receipt"]);

    const at = this.now().toISOString();
    const splits = input.splits.map((x) => ({
      userId: x.userId,
      shareFils: x.shareFils,
      percentBp: input.splitMethod === "percent" ? (x.percentBp ?? null) : null,
    }));

    if (!input.id) {
      const key = `${input.groupId}:${input.clientRequestId}`;
      const existing = s.idempotency[key];
      if (existing) return existing; // duplicate submission: return the original
      const id = uuid();
      const created: DemoExpense = {
        id,
        groupId: input.groupId,
        description: input.description.trim(),
        amountFils: input.amountFils,
        date: input.date,
        paidBy: input.paidBy,
        category: input.category,
        splitMethod: input.splitMethod,
        notes: input.notes.trim(),
        receiptPath: input.receiptPath,
        createdBy: me.id,
        createdAt: at,
        updatedAt: at,
        splits,
        deletedAt: null,
      };
      s.expenses.push(created);
      this.recordRevision(s, created, "created");
      s.idempotency[key] = id;
      this.log(s, input.groupId, "expense_added", "expense", id, `Added "${input.description.trim()}" · ${formatAed(input.amountFils)}`);
      this.write(s);
      return id;
    }

    const e = s.expenses.find((x) => x.id === input.id && x.groupId === input.groupId && !x.deletedAt);
    if (!e) throw new NotFoundError("Expense not found");
    if (!this.canModifyExpense(s, e, me.id))
      throw new AccessDeniedError("Only the person who added or paid for this expense, or a group admin, can edit it");
    const before = formatAed(e.amountFils);
    Object.assign(e, {
      description: input.description.trim(),
      amountFils: input.amountFils,
      date: input.date,
      paidBy: input.paidBy,
      category: input.category,
      splitMethod: input.splitMethod,
      notes: input.notes.trim(),
      receiptPath: input.receiptPath,
      updatedAt: at,
      splits,
    });
    const change = before === formatAed(e.amountFils) ? formatAed(e.amountFils) : `${before} → ${formatAed(e.amountFils)}`;
    this.recordRevision(s, e, "edited");
    this.log(s, e.groupId, "expense_edited", "expense", e.id, `Edited "${e.description}" · ${change}`);
    this.write(s);
    return e.id;
  }

  async deleteExpense(groupId: string, expenseId: string) {
    const s = this.read();
    const { me } = this.requireMember(s, groupId);
    const e = s.expenses.find((x) => x.id === expenseId && x.groupId === groupId && !x.deletedAt);
    if (!e) throw new NotFoundError("Expense not found");
    if (!this.canModifyExpense(s, e, me.id))
      throw new AccessDeniedError("Only the person who added or paid for this expense, or a group admin, can delete it");
    e.deletedAt = this.now().toISOString();
    this.recordRevision(s, e, "deleted");
    this.log(s, groupId, "expense_deleted", "expense", e.id, `Deleted "${e.description}" · ${formatAed(e.amountFils)}`);
    this.write(s);
  }

  async loadExpenseHistory(groupId: string, expenseId: string): Promise<ExpenseRevision[]> {
    const s = this.read();
    this.requireMember(s, groupId);
    return structuredClone(
      s.revisions
        .filter((r) => r.groupId === groupId && r.expenseId === expenseId)
        .sort((a, b) => a.revision - b.revision),
    );
  }

  // ---------- settlements ----------
  async recordSettlement(input: SettlementInput): Promise<string> {
    const s = this.read();
    const { me, membership } = this.requireMember(s, input.groupId);
    const issues = validateSettlement(input, this.memberIds(s, input.groupId));
    if (issues.length) throw new ValidationError(issues);
    if (membership.role !== "admin" && me.id !== input.fromUser && me.id !== input.toUser)
      throw new AccessDeniedError("You can only record payments you made or received");

    const key = `${input.groupId}:${input.clientRequestId}`;
    const existing = s.idempotency[key];
    if (existing) return existing;
    const id = uuid();
    s.settlements.push({
      id,
      groupId: input.groupId,
      fromUser: input.fromUser,
      toUser: input.toUser,
      amountFils: input.amountFils,
      method: input.method,
      date: input.date,
      note: input.note.trim(),
      createdBy: me.id,
      createdAt: this.now().toISOString(),
      undoneAt: null,
      undoneBy: null,
      undoReason: null,
    });
    s.idempotency[key] = id;
    const name = (uid: string) => s.users.find((u) => u.id === uid)?.name ?? "Someone";
    this.log(s, input.groupId, "settlement_added", "settlement", id, `${name(input.fromUser)} paid ${name(input.toUser)} ${formatAed(input.amountFils)}`);
    this.write(s);
    return id;
  }

  async undoSettlement(groupId: string, settlementId: string, reason: string) {
    const s = this.read();
    const { me, membership } = this.requireMember(s, groupId);
    const st = s.settlements.find((x) => x.id === settlementId && x.groupId === groupId);
    if (!st) throw new NotFoundError("Settlement not found");
    if (st.undoneAt) throw new ValidationError(["This settlement was already undone"]);
    const r = reason.trim();
    if (r.length < 1 || r.length > 200) throw new ValidationError(["Please give a reason (up to 200 characters)"]);
    const allowed =
      membership.role === "admin" || st.createdBy === me.id || st.fromUser === me.id || st.toUser === me.id;
    if (!allowed) throw new AccessDeniedError("Only the people involved or a group admin can undo this settlement");
    st.undoneAt = this.now().toISOString();
    st.undoneBy = me.id;
    st.undoReason = r;
    const name = (uid: string) => s.users.find((u) => u.id === uid)?.name ?? "Someone";
    this.log(s, groupId, "settlement_undone", "settlement", st.id, `Undid ${name(st.fromUser)} → ${name(st.toUser)} ${formatAed(st.amountFils)} (${r})`);
    this.write(s);
  }

  // ---------- receipts ----------
  async uploadReceipt(groupId: string, file: File): Promise<string> {
    const s = this.read();
    this.requireMember(s, groupId);
    if (!RECEIPT_TYPES.includes(file.type)) throw new ValidationError(["Receipt must be a JPG, PNG, WebP or PDF"]);
    if (file.size > RECEIPT_MAX_BYTES) throw new ValidationError(["Receipt must be smaller than 5 MB"]);
    const path = `${groupId}/${uuid()}`;
    const url = await blobToDataUrl(file);
    try {
      window.sessionStorage.setItem(`receipt:${path}`, url);
    } catch {
      /* ignore in non-browser/test environments */
    }
    return path;
  }

  async getReceiptUrl(path: string): Promise<string> {
    const s = this.read();
    this.requireMember(s, path.split("/")[0]);
    try {
      return window.sessionStorage.getItem(`receipt:${path}`) ?? "";
    } catch {
      return "";
    }
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
