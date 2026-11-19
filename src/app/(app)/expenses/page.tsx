"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Download, Pencil, Plus, Receipt, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useApp, useName } from "@/components/app-provider";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { ExpenseRow } from "@/components/expense-row";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Card, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime } from "@/lib/core/dates";
import { formatAed } from "@/lib/core/money";
import { expensesToCsv } from "@/lib/core/reports";
import { downloadText } from "@/lib/download";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/types";
import type { Expense } from "@/lib/types";

export default function ExpensesPage() {
  const { data, me, members, refresh, repo } = useApp();
  const name = useName();
  const toast = useToast();
  const router = useRouter();

  const [query, setQuery] = React.useState("");
  const [member, setMember] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [showFilters, setShowFilters] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<Expense | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.expenses ?? []).filter((e) => {
      if (q) {
        const hay = [e.description, e.notes, CATEGORY_LABELS[e.category], name(e.paidBy), ...e.splits.map((s) => name(s.userId))]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (member && e.paidBy !== member && !e.splits.some((s) => s.userId === member)) return false;
      if (category && e.category !== category) return false;
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, member, category, from, to]);

  if (!data || !me) return null;
  const activeFilters = [member, category, from, to].filter(Boolean).length;
  const filteredTotal = filtered.reduce((n, e) => n + e.amountFils, 0);
  const myRole = members.find((m) => m.userId === me.id)?.role;
  const canModify = (e: Expense) => myRole === "admin" || e.createdBy === me.id || e.paidBy === me.id;

  function clearFilters() {
    setQuery("");
    setMember("");
    setCategory("");
    setFrom("");
    setTo("");
  }

  async function confirmDelete() {
    if (!toDelete || !repo || deleting) return;
    setDeleting(true);
    try {
      await repo.deleteExpense(data!.group.id, toDelete.id);
      await refresh();
      toast.success("Expense deleted");
      setToDelete(null);
      setOpenId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete expense");
    } finally {
      setDeleting(false);
    }
  }

  // group rows by month for easier scanning
  const groups: { label: string; items: Expense[] }[] = [];
  for (const e of filtered) {
    const label = new Date(e.date + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
        <Button
          variant="outline"
          size="sm"
          disabled={filtered.length === 0}
          onClick={() => downloadText(`colleaguesplit-expenses.csv`, expensesToCsv(filtered, members))}
        >
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search expenses"
            placeholder="Search description, person, notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant={activeFilters ? "default" : "outline"} size="icon" aria-label="Filters" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)} className="relative h-11 w-11">
          <SlidersHorizontal className="h-5 w-5" />
          {activeFilters > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[11px] text-background">{activeFilters}</span>
          )}
        </Button>
      </div>

      {showFilters && (
        <Card className="grid grid-cols-2 gap-3 p-4">
          <div>
            <Label htmlFor="f-member">Member</Label>
            <Select id="f-member" value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">Everyone</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === me.id ? "You" : m.profile.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-cat">Category</Label>
            <Select id="f-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" className="col-span-2" onClick={clearFilters}>
              <X className="h-4 w-4" /> Clear filters
            </Button>
          )}
        </Card>
      )}

      {data.expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expenses yet"
          description="Your group's lunches, coffees and snacks will show up here."
          action={
            <Button asChild>
              <Link href="/expenses/new">
                <Plus className="h-4 w-4" /> Add expense
              </Link>
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching expenses"
          description="Try a different search or clear the filters."
          action={
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "expense" : "expenses"} · {formatAed(filteredTotal)}
          </p>
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h2>
              <Card className="divide-y overflow-hidden">
                {g.items.map((e) => {
                  const open = openId === e.id;
                  const activity = data.activity.filter((a) => a.entityId === e.id).slice().reverse();
                  return (
                    <div key={e.id}>
                      <div className="relative">
                        <ExpenseRow expense={e} onClick={() => setOpenId(open ? null : e.id)} />
                        <ChevronDown aria-hidden className={`pointer-events-none absolute bottom-1 right-3 h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                      </div>
                      {open && (
                        <div className="space-y-3 bg-muted/40 px-4 py-3 text-sm">
                          <div>
                            <p className="mb-1 font-medium">Split ({e.splitMethod === "equal" ? "equally" : e.splitMethod === "exact" ? "exact amounts" : "by percentage"})</p>
                            <ul className="space-y-0.5">
                              {e.splits.map((s) => (
                                <li key={s.userId} className="flex justify-between">
                                  <span>{name(s.userId)}</span>
                                  <span className="tabular">
                                    {s.percentBp != null && e.splitMethod === "percent" ? `${s.percentBp / 100}% · ` : ""}
                                    {formatAed(s.shareFils)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          {e.notes && (
                            <p>
                              <span className="font-medium">Notes: </span>
                              {e.notes}
                            </p>
                          )}
                          {activity.length > 0 && (
                            <ul className="space-y-0.5 text-xs text-muted-foreground">
                              {activity.map((a) => (
                                <li key={a.id}>
                                  {a.action === "expense_added" ? "Added" : a.action === "expense_edited" ? "Edited" : "Updated"} by {name(a.actorId)} · {formatDateTime(a.createdAt)}
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {e.receiptPath && <ReceiptViewer path={e.receiptPath} />}
                            {canModify(e) ? (
                              <>
                                <Button variant="outline" size="sm" onClick={() => router.push(`/expenses/${e.id}/edit`)}>
                                  <Pencil className="h-4 w-4" /> Edit
                                </Button>
                                <Button variant="outline" size="sm" className="text-negative" onClick={() => setToDelete(e)}>
                                  <Trash2 className="h-4 w-4" /> Delete
                                </Button>
                              </>
                            ) : (
                              <span className="self-center text-xs text-muted-foreground">Only {name(e.createdBy)}, the payer or an admin can change this.</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
        </>
      )}

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent title="Delete this expense?" description="Balances will be recalculated. This is recorded in the activity log.">
          {toDelete && (
            <div className="mb-4 rounded-xl bg-muted p-3 text-sm">
              <p className="font-medium">{toDelete.description}</p>
              <p className="text-muted-foreground">
                <Amount fils={toDelete.amountFils} /> · {formatDate(toDelete.date)} · paid by {name(toDelete.paidBy)}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={deleting} onClick={confirmDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
