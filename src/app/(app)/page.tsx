"use client";

import Link from "next/link";
import * as React from "react";
import { ArrowRight, ChevronRight, Plus, Receipt, Scale } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { ExpenseRow } from "@/components/expense-row";
import { MemberAvatar } from "@/components/member-avatar";
import { MemberBalanceDialog } from "@/components/member-balance-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { currentMonthKey, monthLabel, shiftMonth } from "@/lib/core/dates";
import { formatAed } from "@/lib/core/money";
import { summarizeMonth } from "@/lib/core/reports";
import { CATEGORY_LABELS } from "@/lib/types";

export default function DashboardPage() {
  const { me, data, members, balances, totalFils } = useApp();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  if (!me || !data) return null;

  const mine = balances[me.id] ?? 0;
  const iOwe = Math.max(-mine, 0);
  const owedToMe = Math.max(mine, 0);

  const thisMonth = currentMonthKey();
  const ids = members.map((m) => m.userId);
  const cur = summarizeMonth(thisMonth, data.expenses, ids);
  const prev = summarizeMonth(shiftMonth(thisMonth, -1), data.expenses, ids);
  const topCategory = cur.byCategory[0];
  const delta = cur.totalFils - prev.totalFils;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">{data.group.name}</p>
        <h1 className="text-2xl font-bold tracking-tight">Welcome back, {me.name.split(" ")[0]}</h1>
      </div>

      {/* Balance hero */}
      <section
        aria-label="Your balance"
        className="rounded-2xl bg-gradient-to-br from-teal-700 to-emerald-600 p-5 text-white shadow-card dark:from-teal-800 dark:to-emerald-800"
      >
        <p className="text-sm text-white/80">
          {mine === 0 ? "You're all settled up" : mine > 0 ? "You are owed overall" : "You owe overall"}
        </p>
        <p className="tabular mt-1 text-4xl font-bold">{formatAed(Math.abs(mine))}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/15 p-3">
            <p className="text-xs text-white/80">You owe</p>
            <p className="tabular text-lg font-semibold">{formatAed(iOwe)}</p>
          </div>
          <div className="rounded-xl bg-white/15 p-3">
            <p className="text-xs text-white/80">Owed to you</p>
            <p className="tabular text-lg font-semibold">{formatAed(owedToMe)}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button asChild size="lg" className="bg-white text-teal-800 hover:bg-white/90">
            <Link href="/expenses/new">
              <Plus className="h-5 w-5" /> Add Expense
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/15">
            <Link href="/settle">
              <Scale className="h-5 w-5" /> Settle Up
            </Link>
          </Button>
        </div>
      </section>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total group expenses</p>
          <Amount fils={totalFils} className="text-xl" />
          <p className="text-xs text-muted-foreground">{data.expenses.length} expenses</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{monthLabel(thisMonth)}</p>
          <Amount fils={cur.totalFils} className="text-xl" />
          <p className="text-xs text-muted-foreground">
            {prev.totalFils === 0 && cur.totalFils === 0
              ? "No spending yet"
              : delta === 0
                ? "Same as last month"
                : `${delta > 0 ? "▲" : "▼"} ${formatAed(Math.abs(delta))} vs last month`}
          </p>
        </Card>
      </div>

      {/* Member balances */}
      <section aria-labelledby="balances-h">
        <h2 id="balances-h" className="mb-2 font-semibold">
          Balances
        </h2>
        <Card className="divide-y">
          {members.map((m) => {
            const b = balances[m.userId] ?? 0;
            return (
              <button
                key={m.userId}
                type="button"
                onClick={() => setSelectedId(m.userId)}
                aria-label={`View ${m.profile.name}'s balance details`}
                className="flex w-full items-center gap-3 p-3 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/60"
              >
                <MemberAvatar profile={m.profile} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.profile.name}
                    {m.userId === me.id && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {b === 0 ? "settled up" : b > 0 ? "gets back" : "owes"}
                  </p>
                </div>
                {b === 0 ? (
                  <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <Amount fils={b} signed />
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            );
          })}
        </Card>
        <MemberBalanceDialog memberId={selectedId} onClose={() => setSelectedId(null)} />
      </section>

      {/* Monthly summary */}
      <section aria-labelledby="month-h">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="month-h" className="font-semibold">
            This month
          </h2>
          <Link href="/reports" className="flex items-center gap-1 text-sm font-medium text-primary">
            Full report <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <Card className="p-4">
          {cur.expenseCount === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing spent yet in {monthLabel(thisMonth)}.</p>
          ) : (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Group spending</p>
                  <Amount fils={cur.totalFils} className="text-lg" />
                </div>
                {topCategory && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Top category</p>
                    <p className="font-semibold">{CATEGORY_LABELS[topCategory.category]}</p>
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-2">
                {cur.byCategory.slice(0, 3).map((c) => (
                  <div key={c.category}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{CATEGORY_LABELS[c.category]}</span>
                      <span className="tabular text-muted-foreground">{formatAed(c.totalFils)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (c.totalFils / cur.totalFils) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </section>

      {/* Recent expenses */}
      <section aria-labelledby="recent-h">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="recent-h" className="font-semibold">
            Recent expenses
          </h2>
          <Link href="/expenses" className="flex items-center gap-1 text-sm font-medium text-primary">
            See all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {data.expenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No expenses yet"
            description="Add your first shared lunch or coffee and ColleagueSplit does the maths."
            action={
              <Button asChild>
                <Link href="/expenses/new">
                  <Plus className="h-4 w-4" /> Add expense
                </Link>
              </Button>
            }
          />
        ) : (
          <Card className="divide-y overflow-hidden">
            {data.expenses.slice(0, 5).map((e) => (
              <ExpenseRow key={e.id} expense={e} />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
