"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Paperclip, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { CATEGORY_ICONS } from "@/components/expense-row";
import { MemberAvatar } from "@/components/member-avatar";
import { useOnline } from "@/components/pwa";
import { Button } from "@/components/ui/button";
import { Card, Input, Label, Segmented, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { todayISO } from "@/lib/core/dates";
import {
  bpToPercentString,
  computeShares,
  filsToDecimal,
  formatAed,
  parseAmountToFils,
  parsePercentToBp,
  splitEqual,
} from "@/lib/core/money";
import { validateExpense, ValidationError } from "@/lib/core/validate";
import { uuid } from "@/lib/store/ids";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/store/types";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/types";
import type { Category, Expense, SplitMethod } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ExpenseForm({ expense }: { expense?: Expense }) {
  const { repo, me, data, members, refresh } = useApp();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const editing = !!expense;

  // One idempotency key per form instance: double-taps / retries can't create duplicates.
  const requestId = React.useRef(uuid());

  const memberIds = React.useMemo(() => members.map((m) => m.userId), [members]);

  const [description, setDescription] = React.useState(expense?.description ?? "");
  const [amountStr, setAmountStr] = React.useState(expense ? filsToDecimal(expense.amountFils) : "");
  const [date, setDate] = React.useState(expense?.date ?? todayISO());
  const [paidBy, setPaidBy] = React.useState(expense?.paidBy ?? me?.id ?? "");
  const [category, setCategory] = React.useState<Category>(expense?.category ?? "lunch");
  const [method, setMethod] = React.useState<SplitMethod>(expense?.splitMethod ?? "equal");
  const [participants, setParticipants] = React.useState<string[]>(
    expense ? expense.splits.map((s) => s.userId) : memberIds,
  );
  const [custom, setCustom] = React.useState<Record<string, string>>(() => {
    if (!expense) return {};
    return Object.fromEntries(
      expense.splits.map((s) => [
        s.userId,
        expense.splitMethod === "percent" ? bpToPercentString(s.percentBp ?? 0) : filsToDecimal(s.shareFils),
      ]),
    );
  });
  const [notes, setNotes] = React.useState(expense?.notes ?? "");
  const [receiptFile, setReceiptFile] = React.useState<File | null>(null);
  const [receiptPath, setReceiptPath] = React.useState<string | null>(expense?.receiptPath ?? null);
  const [submitting, setSubmitting] = React.useState(false);

  const totalFils = parseAmountToFils(amountStr);
  const ordered = memberIds.filter((id) => participants.includes(id));

  const customNumbers = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of ordered) {
      const raw = custom[id] ?? "";
      out[id] = (method === "percent" ? parsePercentToBp(raw) : parseAmountToFils(raw)) ?? 0;
    }
    return out;
  }, [custom, ordered, method]);

  const result = React.useMemo(
    () =>
      totalFils
        ? computeShares({ method, totalFils, participantIds: ordered, custom: customNumbers })
        : null,
    [method, totalFils, ordered, customNumbers],
  );

  function changeMethod(next: SplitMethod) {
    setMethod(next);
    // Pre-fill custom fields from an even split so editing is quick.
    if (next === "exact" && totalFils) {
      setCustom(Object.fromEntries(splitEqual(totalFils, ordered).map((s) => [s.userId, filsToDecimal(s.shareFils)])));
    } else if (next === "percent") {
      fillEvenPercent(ordered);
    }
  }

  function fillEvenPercent(ids: string[]) {
    if (!ids.length) return;
    const shares = splitEqual(10000, ids);
    setCustom(Object.fromEntries(shares.map((s) => [s.userId, bpToPercentString(s.shareFils)])));
  }

  function toggle(id: string) {
    setParticipants((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function pickReceipt(file: File | undefined) {
    if (!file) return;
    if (!RECEIPT_TYPES.includes(file.type)) return toast.error("Receipt must be a JPG, PNG, WebP or PDF");
    if (file.size > RECEIPT_MAX_BYTES) return toast.error("Receipt must be smaller than 5 MB");
    setReceiptFile(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo || !data || submitting) return;
    if (!online) return toast.error("You're offline. Reconnect to save this expense.");
    if (!totalFils) return toast.error("Enter a valid amount, e.g. 45.50");
    if (!result?.ok) return toast.error(result?.error ?? "Check the split");

    const input = {
      id: expense?.id,
      clientRequestId: requestId.current,
      groupId: data.group.id,
      description: description.trim(),
      amountFils: totalFils,
      date,
      paidBy,
      category,
      splitMethod: method,
      notes: notes.trim(),
      receiptPath,
      splits: result.shares.map((s) => ({ userId: s.userId, shareFils: s.shareFils, percentBp: s.percentBp ?? null })),
    };
    const issues = validateExpense(input, memberIds);
    if (issues.length) return toast.error(issues[0]);

    setSubmitting(true);
    try {
      if (receiptFile) input.receiptPath = await repo.uploadReceipt(data.group.id, receiptFile);
      await repo.saveExpense(input);
      await refresh();
      toast.success(editing ? "Expense updated" : "Expense added");
      router.replace("/expenses");
    } catch (err) {
      toast.error(err instanceof ValidationError ? err.issues[0] : err instanceof Error ? err.message : "Could not save expense");
      setSubmitting(false);
    }
  }

  const customTotal = ordered.reduce((n, id) => n + (customNumbers[id] ?? 0), 0);

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Card className="space-y-4 p-4">
        <div>
          <Label htmlFor="amount">Amount (AED)</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">AED</span>
            <Input
              id="amount"
              inputMode="decimal"
              autoComplete="off"
              autoFocus={!editing}
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.,]/g, ""))}
              className="h-14 pl-14 text-2xl font-bold tabular"
              aria-invalid={amountStr !== "" && totalFils === null}
            />
          </div>
          {amountStr !== "" && totalFils === null && (
            <p className="mt-1 text-sm text-negative">Use up to 2 decimals, e.g. 45.50</p>
          )}
        </div>
        <div>
          <Label htmlFor="desc">What was it for?</Label>
          <Input id="desc" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Lunch at Zaatar w Zeit" />
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Category</legend>
          <div className="grid grid-cols-4 gap-2">
            {CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICONS[c];
              const active = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border py-2 text-xs font-medium transition-colors",
                    active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {CATEGORY_LABELS[c]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="paidBy">Paid by</Label>
            <Select id="paidBy" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === me?.id ? "You" : m.profile.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Split between</h2>
          <button
            type="button"
            className="text-sm font-medium text-primary"
            onClick={() => setParticipants(participants.length === memberIds.length ? [] : memberIds)}
          >
            {participants.length === memberIds.length ? "Clear all" : "Select all"}
          </button>
        </div>

        <Segmented<SplitMethod>
          label="Split method"
          value={method}
          onChange={changeMethod}
          options={[
            { value: "equal", label: "Equally" },
            { value: "exact", label: "Exact amounts" },
            { value: "percent", label: "Percent" },
          ]}
        />

        <ul className="divide-y">
          {members.map((m) => {
            const on = participants.includes(m.userId);
            const share = result?.ok ? result.shares.find((s) => s.userId === m.userId) : undefined;
            return (
              <li key={m.userId} className="flex items-center gap-3 py-2.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`Include ${m.profile.name}`}
                  onClick={() => toggle(m.userId)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                  >
                    {on && <Check className="h-4 w-4" aria-hidden />}
                  </span>
                  <MemberAvatar profile={m.profile} size="sm" />
                  <span className={cn("truncate font-medium", !on && "text-muted-foreground")}>
                    {m.userId === me?.id ? "You" : m.profile.name}
                  </span>
                </button>

                {on && method !== "equal" && (
                  <div className="relative w-28 shrink-0">
                    <Input
                      inputMode="decimal"
                      aria-label={`${m.profile.name} ${method === "percent" ? "percentage" : "amount"}`}
                      value={custom[m.userId] ?? ""}
                      onChange={(e) => setCustom((c) => ({ ...c, [m.userId]: e.target.value.replace(/[^\d.,]/g, "") }))}
                      placeholder="0"
                      className="h-10 pr-8 text-right tabular"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      {method === "percent" ? "%" : ""}
                    </span>
                  </div>
                )}
                {on && (
                  <span className="w-24 shrink-0 text-right text-sm tabular text-muted-foreground" aria-label="Calculated share">
                    {share ? formatAed(share.shareFils) : "—"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* Live validation of custom splits */}
        {method !== "equal" && ordered.length > 0 && totalFils && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
            {result?.ok ? (
              <span className="flex items-center gap-1.5 font-medium text-positive">
                <Check className="h-4 w-4" aria-hidden /> Adds up to {formatAed(totalFils)}
              </span>
            ) : (
              <span role="alert" className="font-medium text-negative">
                {result?.error}
              </span>
            )}
            {method === "percent" && (
              <button type="button" className="shrink-0 font-medium text-primary" onClick={() => fillEvenPercent(ordered)}>
                Split evenly
              </button>
            )}
            {method === "exact" && !result?.ok && customTotal !== totalFils && (
              <button
                type="button"
                className="shrink-0 font-medium text-primary"
                onClick={() => setCustom(Object.fromEntries(splitEqual(totalFils, ordered).map((s) => [s.userId, filsToDecimal(s.shareFils)])))}
              >
                Split evenly
              </button>
            )}
          </div>
        )}
        {ordered.length === 0 && <p className="text-sm text-negative">Select at least one person.</p>}
        {method === "equal" && result?.ok && ordered.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {ordered.length} {ordered.length === 1 ? "person" : "people"} · {formatAed(Math.floor(totalFils! / ordered.length))} each
            {totalFils! % ordered.length ? " (a few fils are shared out so the total is exact)" : ""}
          </p>
        )}
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering?" />
        </div>
        <div>
          <Label htmlFor="receipt">Receipt (optional)</Label>
          {receiptFile || receiptPath ? (
            <div className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
              <span className="flex items-center gap-2 truncate">
                <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
                {receiptFile?.name ?? "Receipt attached"}
              </span>
              <button
                type="button"
                aria-label="Remove receipt"
                onClick={() => {
                  setReceiptFile(null);
                  setReceiptPath(null);
                }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Input id="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => pickReceipt(e.target.files?.[0])} className="h-auto py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm" />
          )}
          <p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WebP or PDF up to 5 MB. Stored privately for your group.</p>
        </div>
      </Card>

      <div className="sticky bottom-24 z-20 md:static">
        <Button type="submit" size="lg" className="w-full shadow-lg" loading={submitting} disabled={!online}>
          {editing ? "Save changes" : "Add expense"}
          {totalFils ? ` · ${formatAed(totalFils)}` : ""}
        </Button>
        {!online && <p className="mt-2 text-center text-sm text-amber-700 dark:text-amber-300">Offline — reconnect to save.</p>}
      </div>
    </form>
  );
}
