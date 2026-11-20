"use client";

import * as React from "react";
import { ArrowRight, BellRing, CheckCircle2, Plus, Undo2 } from "lucide-react";
import { useApp, useName } from "@/components/app-provider";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { MemberAvatar } from "@/components/member-avatar";
import { useOnline } from "@/components/pwa";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, Card, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { Transfer } from "@/lib/core/balances";
import { formatDate, formatDateTime, todayISO } from "@/lib/core/dates";
import { filsToDecimal, formatAed, parseAmountToFils } from "@/lib/core/money";
import { canConfirm, settlementStatus, STATUS_LABELS } from "@/lib/core/settlements";
import { validateSettlement, ValidationError } from "@/lib/core/validate";
import { settlementsToCsv } from "@/lib/core/reports";
import { downloadText } from "@/lib/download";
import { uuid } from "@/lib/store/ids";
import { PAYMENT_LABELS, PAYMENT_METHODS } from "@/lib/types";
import type { PaymentMethod, Settlement } from "@/lib/types";

export default function SettlePage() {
  const { data, me, members, transfers, memberById, repo, refresh } = useApp();
  const name = useName();
  const toast = useToast();
  const online = useOnline();
  const [dialog, setDialog] = React.useState<{ transfer: Transfer | null; suggested: number | null } | null>(null);
  const [undoing, setUndoing] = React.useState<Settlement | null>(null);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);

  // Keep payment status in sync across people's devices while this screen is open:
  // poll gently, only while the app is visible and online (no polling in the background).
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void refresh();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!data || !me) return null;
  const myRole = members.find((m) => m.userId === me.id)?.role;
  const canRecord = (t: Transfer) => myRole === "admin" || t.from === me.id || t.to === me.id;
  const canUndo = (s: Settlement) =>
    !s.undoneAt && (myRole === "admin" || s.createdBy === me.id || s.fromUser === me.id || s.toUser === me.id);

  const mine = transfers.filter((t) => t.from === me.id || t.to === me.id);
  const others = transfers.filter((t) => t.from !== me.id && t.to !== me.id);

  const row = (t: Transfer) => {
    const from = memberById(t.from)?.profile;
    const to = memberById(t.to)?.profile;
    if (!from || !to) return null;
    return (
      <li key={`${t.from}-${t.to}`} className="flex items-center gap-3 p-3">
        <MemberAvatar profile={from} size="sm" />
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <MemberAvatar profile={to} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            <strong>{name(t.from)}</strong> {t.from === me.id ? "pay" : "pays"} <strong>{name(t.to)}</strong>
          </p>
          <Amount fils={t.amountFils} className={t.from === me.id ? "text-negative" : t.to === me.id ? "text-positive" : ""} />
        </div>
        {canRecord(t) && (
          <Button size="sm" variant={t.from === me.id || t.to === me.id ? "default" : "outline"} onClick={() => setDialog({ transfer: t, suggested: t.amountFils })}>
            {t.from === me.id ? "I paid" : t.to === me.id ? "Received" : "Record"}
          </Button>
        )}
      </li>
    );
  };

  const toConfirm = data.settlements.filter((s) => canConfirm(s, me.id));

  async function confirm(s: Settlement) {
    if (!repo || confirmingId) return; // ignore repeated taps while a confirmation is in flight
    if (!online) return toast.error("You're offline. Reconnect to confirm this payment.");
    setConfirmingId(s.id);
    try {
      // Updates the EXISTING record; it never creates a payment and never changes balances.
      await repo.confirmSettlement(data!.group.id, s.id);
      await refresh();
      toast.success(s.toUser === me!.id ? "Receipt confirmed" : "Payment confirmed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not confirm payment");
      await refresh(); // the record may have changed on another device
    } finally {
      setConfirmingId(null);
    }
  }

  async function undo(reason: string) {
    if (!undoing || !repo) return;
    try {
      await repo.undoSettlement(data!.group.id, undoing.id, reason);
      await refresh();
      toast.success("Settlement undone");
      setUndoing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not undo settlement");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settle up</h1>
          <p className="text-sm text-muted-foreground">Fewest payments to clear everyone.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDialog({ transfer: null, suggested: null })}>
          <Plus className="h-4 w-4" /> Other payment
        </Button>
      </div>

      {toConfirm.length > 0 && (
        <section aria-labelledby="confirm-h">
          <h2 id="confirm-h" className="mb-2 flex items-center gap-2 font-semibold">
            <BellRing className="h-4 w-4 text-amber-600" aria-hidden /> Needs your confirmation
          </h2>
          <Card className="divide-y border-amber-400/60">
            {toConfirm.map((s) => {
              const iAmReceiver = s.toUser === me.id;
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {iAmReceiver ? (
                        <>
                          <strong>{name(s.fromUser)}</strong> says they paid you
                        </>
                      ) : (
                        <>
                          <strong>{name(s.toUser)}</strong> says they received from you
                        </>
                      )}{" "}
                      <strong className="tabular">{formatAed(s.amountFils)}</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(s.date)} · {PAYMENT_LABELS[s.method]} · already counted in balances
                    </p>
                  </div>
                  <Button size="sm" loading={confirmingId === s.id} disabled={!!confirmingId || !online} onClick={() => confirm(s)}>
                    {iAmReceiver ? "Confirm receipt" : "Confirm payment"}
                  </Button>
                </div>
              );
            })}
          </Card>
        </section>
      )}

      {transfers.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="All settled up!" description="Nobody owes anybody anything right now. Enjoy your next lunch." />
      ) : (
        <>
          {mine.length > 0 && (
            <section aria-labelledby="mine-h">
              <h2 id="mine-h" className="mb-2 font-semibold">
                Your payments
              </h2>
              <Card className="divide-y">
                <ul>{mine.map(row)}</ul>
              </Card>
            </section>
          )}
          {others.length > 0 && (
            <section aria-labelledby="others-h">
              <h2 id="others-h" className="mb-2 font-semibold">
                {mine.length ? "Between others" : "Suggested payments"}
              </h2>
              <Card className="divide-y">
                <ul>{others.map(row)}</ul>
              </Card>
            </section>
          )}
          <p className="text-xs text-muted-foreground">
            ColleagueSplit only records payments you make yourselves (cash or bank transfer). No money moves through the app.
          </p>
        </>
      )}

      <section aria-labelledby="hist-h">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="hist-h" className="font-semibold">
            Settlement history
          </h2>
          {data.settlements.length > 0 && (
            <button className="text-sm font-medium text-primary" onClick={() => downloadText("colleaguesplit-settlements.csv", settlementsToCsv(data.settlements, members))}>
              Export CSV
            </button>
          )}
        </div>
        {data.settlements.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <Card className="divide-y">
            {data.settlements.map((s) => (
              <div key={s.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm ${s.undoneAt ? "text-muted-foreground line-through" : ""}`}>
                      <strong>{name(s.fromUser)}</strong> paid <strong>{name(s.toUser)}</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(s.date)} · {PAYMENT_LABELS[s.method]}
                      {s.note ? ` · ${s.note}` : ""}
                    </p>
                    {s.undoneAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Undone by {name(s.undoneBy!)} on {formatDateTime(s.undoneAt)} — “{s.undoReason}”
                      </p>
                    )}
                    {settlementStatus(s) === "confirmed" && s.confirmedBy && s.confirmedBy !== s.createdBy && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Recorded by {name(s.createdBy)} · confirmed by {name(s.confirmedBy)}
                      </p>
                    )}
                    {settlementStatus(s) === "awaiting" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Recorded by {name(s.createdBy)} · waiting for {name(s.createdBy === s.fromUser ? s.toUser : s.fromUser)} to confirm
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`tabular text-sm font-semibold ${s.undoneAt ? "text-muted-foreground line-through" : ""}`}>{formatAed(s.amountFils)}</span>
                    <div>
                      <Badge tone={settlementStatus(s) === "confirmed" ? "positive" : settlementStatus(s) === "awaiting" ? "warning" : "muted"}>
                        {STATUS_LABELS[settlementStatus(s)]}
                      </Badge>
                    </div>
                    {canUndo(s) && (
                      <button className="mt-0.5 flex items-center gap-1 text-xs font-medium text-negative" onClick={() => setUndoing(s)}>
                        <Undo2 className="h-3 w-3" /> Undo
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {dialog && (
        <RecordDialog
          key={`${dialog.transfer?.from}-${dialog.transfer?.to}`}
          initial={dialog.transfer}
          suggested={dialog.suggested}
          onClose={() => setDialog(null)}
          online={online}
        />
      )}
      <UndoDialog settlement={undoing} onClose={() => setUndoing(null)} onConfirm={undo} />
    </div>
  );
}

function RecordDialog({
  initial,
  suggested,
  onClose,
  online,
}: {
  initial: Transfer | null;
  suggested: number | null;
  onClose: () => void;
  online: boolean;
}) {
  const { repo, data, me, members, refresh } = useApp();
  const toast = useToast();
  const requestId = React.useRef(uuid());
  const [from, setFrom] = React.useState(initial?.from ?? me?.id ?? "");
  const [to, setTo] = React.useState(initial?.to ?? members.find((m) => m.userId !== me?.id)?.userId ?? "");
  const [amountStr, setAmountStr] = React.useState(initial ? filsToDecimal(initial.amountFils) : "");
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [date, setDate] = React.useState(todayISO());
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const fils = parseAmountToFils(amountStr);
  const partial = suggested != null && fils != null && fils < suggested;
  const over = suggested != null && fils != null && fils > suggested;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo || !data || busy) return;
    if (!online) return toast.error("You're offline. Reconnect to record this payment.");
    const input = {
      clientRequestId: requestId.current,
      groupId: data.group.id,
      fromUser: from,
      toUser: to,
      amountFils: fils ?? 0,
      method,
      date,
      note: note.trim(),
    };
    const issues = validateSettlement(input, members.map((m) => m.userId));
    if (issues.length) return toast.error(issues[0]);
    setBusy(true);
    try {
      await repo.recordSettlement(input);
      await refresh();
      toast.success(partial ? "Partial payment recorded" : "Payment recorded");
      onClose();
    } catch (err) {
      toast.error(err instanceof ValidationError ? err.issues[0] : err instanceof Error ? err.message : "Could not record payment");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Record a payment" description="Record money that has already been paid outside the app.">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-from">Paid by</Label>
              <Select id="s-from" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!!initial}>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userId === me?.id ? "You" : m.profile.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="s-to">Paid to</Label>
              <Select id="s-to" value={to} onChange={(e) => setTo(e.target.value)} disabled={!!initial}>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userId === me?.id ? "You" : m.profile.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="s-amount">Amount (AED)</Label>
            <Input id="s-amount" inputMode="decimal" autoFocus value={amountStr} onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0.00" className="h-12 text-xl font-bold tabular" />
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {partial ? "Partial payment — the rest stays outstanding." : over ? "That's more than the suggested amount." : suggested != null ? "Full amount." : ""}
              </span>
              {suggested != null && fils !== suggested && (
                <button type="button" className="font-medium text-primary" onClick={() => setAmountStr(filsToDecimal(suggested))}>
                  Use full {formatAed(suggested)}
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-method">Method</Label>
              <Select id="s-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="s-date">Date</Label>
              <Input id="s-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="s-note">Note (optional)</Label>
            <Input id="s-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bank transfer ref 1234" />
          </div>
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!online}>
            Record payment
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UndoDialog({
  settlement,
  onClose,
  onConfirm,
}: {
  settlement: Settlement | null;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const name = useName();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    setReason("");
    setBusy(false);
  }, [settlement]);

  return (
    <Dialog open={!!settlement} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Undo this payment?" description="Balances go back to how they were. The reason is saved in the activity log.">
        {settlement && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await onConfirm(reason);
              setBusy(false);
            }}
            className="space-y-4"
          >
            <div className="rounded-xl bg-muted p-3 text-sm">
              <strong>{name(settlement.fromUser)}</strong> paid <strong>{name(settlement.toUser)}</strong> {formatAed(settlement.amountFils)}
            </div>
            <div>
              <Label htmlFor="undo-reason">Reason</Label>
              <Input id="undo-reason" required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered the wrong amount" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" onClick={onClose}>
                Keep it
              </Button>
              <Button type="submit" variant="destructive" loading={busy} disabled={!reason.trim()}>
                Undo payment
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
