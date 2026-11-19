"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useApp, useName } from "@/components/app-provider";
import { Amount } from "@/components/amount";
import { CATEGORY_ICONS } from "@/components/expense-row";
import { EmptyState } from "@/components/empty-state";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { currentMonthKey, monthLabel, shiftMonth } from "@/lib/core/dates";
import { formatAed } from "@/lib/core/money";
import { summarizeMonth, summaryToCsv } from "@/lib/core/reports";
import { downloadText } from "@/lib/download";
import { CATEGORY_LABELS } from "@/lib/types";
import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  const { data, members, balances, me } = useApp();
  const name = useName();
  const [month, setMonth] = React.useState(currentMonthKey());

  const summary = React.useMemo(
    () => summarizeMonth(month, data?.expenses ?? [], members.map((m) => m.userId)),
    [month, data, members],
  );
  if (!data || !me) return null;

  const isCurrent = month === currentMonthKey();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Report</h1>
        <Button variant="outline" size="sm" onClick={() => downloadText(`colleaguesplit-summary-${month}.csv`, summaryToCsv(summary, members, balances))}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      <div className="flex items-center justify-between rounded-2xl border bg-card p-1 shadow-card">
        <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="font-semibold">{monthLabel(month)}</span>
        <Button variant="ghost" size="icon" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {summary.expenseCount === 0 ? (
        <EmptyState icon={BarChart3} title="Nothing spent this month" description="Try another month, or add an expense." />
      ) : (
        <>
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Total group spending</p>
            <p className="tabular text-3xl font-bold">{formatAed(summary.totalFils)}</p>
            <p className="text-sm text-muted-foreground">
              {summary.expenseCount} {summary.expenseCount === 1 ? "expense" : "expenses"} · settlements are not counted as spending
            </p>
          </Card>

          <section aria-labelledby="people-h">
            <h2 id="people-h" className="mb-2 font-semibold">
              By person
            </h2>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Member</th>
                    <th className="p-3 text-right font-medium">Paid</th>
                    <th className="p-3 text-right font-medium">Share</th>
                    <th className="p-3 text-right font-medium">Owes / gets</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {summary.perMember.map((m) => {
                    const profile = members.find((x) => x.userId === m.userId)?.profile;
                    const bal = balances[m.userId] ?? 0;
                    return (
                      <tr key={m.userId}>
                        <td className="p-3">
                          <span className="flex items-center gap-2">
                            {profile && <MemberAvatar profile={profile} size="xs" />}
                            <span className="font-medium">{name(m.userId)}</span>
                          </span>
                        </td>
                        <td className="tabular p-3 text-right">{formatAed(m.paidFils)}</td>
                        <td className="tabular p-3 text-right">{formatAed(m.shareFils)}</td>
                        <td className="p-3 text-right">{bal === 0 ? <span className="text-muted-foreground">settled</span> : <Amount fils={bal} signed />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            <p className="mt-1.5 text-xs text-muted-foreground">
              “Owes / gets” is each person&apos;s current outstanding balance across all time, after settlements.
            </p>
          </section>

          <section aria-labelledby="cat-h">
            <h2 id="cat-h" className="mb-2 font-semibold">
              By category
            </h2>
            <Card className="space-y-3 p-4">
              {summary.byCategory.map((c) => {
                const Icon = CATEGORY_ICONS[c.category];
                const pct = Math.round((c.totalFils / summary.totalFils) * 100);
                return (
                  <div key={c.category}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" aria-hidden /> {CATEGORY_LABELS[c.category]}
                      </span>
                      <span className="tabular">
                        {formatAed(c.totalFils)} <span className="text-muted-foreground">· {pct}%</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct}% of spending`}>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
