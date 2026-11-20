"use client";

import * as React from "react";
import { ArrowRight, CheckCircle2, ChevronDown, Info } from "lucide-react";
import { useApp, useName } from "@/components/app-provider";
import { Amount } from "@/components/amount";
import { CATEGORY_ICONS } from "@/components/expense-row";
import { MemberAvatar } from "@/components/member-avatar";
import { Badge } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatDate } from "@/lib/core/dates";
import { formatAed } from "@/lib/core/money";
import { buildMemberDetail } from "@/lib/core/member-detail";
import type { CounterpartyAmount, MemberExpenseLine } from "@/lib/core/member-detail";
import { CATEGORY_LABELS, PAYMENT_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Per-member balance sheet. Bottom sheet on phones (scrolls, respects the safe area),
 * centred modal on larger screens. All numbers come from the group's already-loaded data and
 * the shared balance/simplification helpers, so they always match the dashboard and Settle Up.
 */
export function MemberBalanceDialog({ memberId, onClose }: { memberId: string | null; onClose: () => void }) {
  const { data, members, balances, transfers, me } = useApp();
  const name = useName();

  const member = members.find((m) => m.userId === memberId);
  const detail = React.useMemo(
    () => (data && memberId ? buildMemberDetail(memberId, data.expenses, data.settlements, balances, transfers) : null),
    [data, memberId, balances, transfers],
  );

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      {member && detail && (
        <DialogContent
          title={member.userId === me?.id ? `${member.profile.name} (you)` : member.profile.name}
          description="Balance details for this group"
          className="sm:max-w-lg"
        >
          <div className="space-y-6">
            {/* 1. Summary */}
            <section aria-label="Summary">
              <div className="mb-3 flex items-center gap-3">
                <MemberAvatar profile={member.profile} size="lg" />
                <div>
                  <p className="text-sm text-muted-foreground">Outstanding</p>
                  {detail.netFils === 0 ? (
                    <p className="text-xl font-bold">Settled up</p>
                  ) : (
                    <p className="text-xl font-bold">
                      <Amount fils={detail.netFils} signed />
                    </p>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Total paid" value={formatAed(detail.totalPaidFils)} />
                <Stat label="Personal share" value={formatAed(detail.totalShareFils)} />
                <Stat label="To receive" value={formatAed(detail.toReceiveFils)} tone={detail.toReceiveFils ? "positive" : undefined} />
                <Stat label="To pay" value={formatAed(detail.toPayFils)} tone={detail.toPayFils ? "negative" : undefined} />
              </dl>
            </section>

            {/* 2. Outstanding payments */}
            <section aria-label="Outstanding payments">
              <h3 className="mb-2 font-semibold">What to pay</h3>
              {detail.owesSimplified.length === 0 && detail.owedBySimplified.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl bg-positive/10 p-3 text-sm font-medium text-positive">
                  <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
                  {member.profile.name} is settled up — no payments outstanding.
                </p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {detail.owesSimplified.map((x) => (
                    <PayRow key={`o-${x.userId}`} text={<><b>{name(memberId!)}</b> {memberId === me?.id ? "pay" : "pays"} <b>{name(x.userId)}</b></>} amount={x.amountFils} tone="negative" />
                  ))}
                  {detail.owedBySimplified.map((x) => (
                    <PayRow key={`i-${x.userId}`} text={<><b>{name(x.userId)}</b> pays <b>{name(memberId!)}</b></>} amount={x.amountFils} tone="positive" />
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">Matches the suggested payments on the Settle Up screen.</p>

              {detail.simplificationApplied && (
                <div className="mt-3 rounded-xl bg-muted p-3 text-sm">
                  <p className="mb-1.5 flex items-center gap-1.5 font-medium">
                    <Info className="h-4 w-4" aria-hidden /> Original debts before simplification
                  </p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Based on who paid for what. Settle Up redirects payments so everyone settles with fewer transfers.
                  </p>
                  <OriginalList label="Owes" items={detail.owesOriginal} />
                  <OriginalList label="Is owed by" items={detail.owedByOriginal} />
                </div>
              )}
            </section>

            {/* 3. Expenses */}
            <section aria-label="Expenses">
              <h3 className="mb-2 font-semibold">Expenses ({detail.expenses.length})</h3>
              {detail.expenses.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No expenses involve {member.profile.name} yet.
                </p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {detail.expenses.map((line) => (
                    <ExpenseLine key={line.expense.id} line={line} />
                  ))}
                </ul>
              )}
            </section>

            {/* 4. Settlements */}
            <section aria-label="Settlements">
              <h3 className="mb-2 font-semibold">Settlements ({detail.settlements.length})</h3>
              {detail.settlements.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No settlements yet.</p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {detail.settlements.map((s) => (
                    <li key={s.id} className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className={cn("text-sm", s.undoneAt && "text-muted-foreground line-through")}>
                          <b>{name(s.fromUser)}</b> <ArrowRight className="mx-0.5 inline h-3 w-3" aria-hidden /> <b>{name(s.toUser)}</b>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(s.date)} · {PAYMENT_LABELS[s.method]}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={cn("tabular text-sm font-semibold", s.undoneAt && "text-muted-foreground line-through")}>{formatAed(s.amountFils)}</span>
                        <div>{s.undoneAt ? <Badge>undone</Badge> : <Badge tone="positive">active</Badge>}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("tabular font-semibold", tone === "positive" && "text-positive", tone === "negative" && "text-negative")}>{value}</dd>
    </div>
  );
}

function PayRow({ text, amount, tone }: { text: React.ReactNode; amount: number; tone: "positive" | "negative" }) {
  return (
    <li className="flex items-center justify-between gap-3 p-3 text-sm">
      <span className="min-w-0">{text}</span>
      <span className={cn("tabular shrink-0 font-semibold", tone === "positive" ? "text-positive" : "text-negative")}>{formatAed(amount)}</span>
    </li>
  );
}

function OriginalList({ label, items }: { label: string; items: CounterpartyAmount[] }) {
  const name = useName();
  if (items.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {items.map((x) => (
        <li key={x.userId} className="flex justify-between">
          <span>
            {label} <b>{name(x.userId)}</b>
          </span>
          <span className="tabular">{formatAed(x.amountFils)}</span>
        </li>
      ))}
    </ul>
  );
}

function ExpenseLine({ line }: { line: MemberExpenseLine }) {
  const name = useName();
  const [open, setOpen] = React.useState(false);
  const { expense: e } = line;
  const Icon = CATEGORY_ICONS[e.category];
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/60">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{e.description}</span>
          <span className="block text-xs text-muted-foreground">
            {formatDate(e.date)} · {CATEGORY_LABELS[e.category]} · paid by {name(e.paidBy)}
          </span>
          <span className="mt-1 grid grid-cols-2 gap-x-3 text-xs">
            <span className="text-muted-foreground">Total</span>
            <span className="tabular text-right">{formatAed(e.amountFils)}</span>
            <span className="text-muted-foreground">Their share</span>
            <span className="tabular text-right">{formatAed(line.shareFils)}</span>
            <span className="text-muted-foreground">Contributed</span>
            <span className="tabular text-right">{formatAed(line.paidFils)}</span>
            <span className="text-muted-foreground">{line.netFils >= 0 ? "Lent" : "Borrowed"}</span>
            <span className={cn("tabular text-right font-semibold", line.netFils > 0 && "text-positive", line.netFils < 0 && "text-negative")}>
              {line.netFils === 0 ? formatAed(0) : formatAed(Math.abs(line.netFils))}
            </span>
          </span>
        </span>
        <ChevronDown aria-hidden className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-1 bg-muted/40 px-4 py-3 text-xs">
          <p className="font-medium">
            Split {e.splitMethod === "equal" ? "equally" : e.splitMethod === "exact" ? "by exact amounts" : "by percentage"}
          </p>
          <ul className="space-y-0.5">
            {e.splits.map((s) => (
              <li key={s.userId} className="flex justify-between">
                <span>{name(s.userId)}</span>
                <span className="tabular">
                  {e.splitMethod === "percent" && s.percentBp != null ? `${s.percentBp / 100}% · ` : ""}
                  {formatAed(s.shareFils)}
                </span>
              </li>
            ))}
          </ul>
          {e.notes && <p className="pt-1 text-muted-foreground">Notes: {e.notes}</p>}
        </div>
      )}
    </li>
  );
}
