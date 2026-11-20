"use client";

import * as React from "react";
import { ArrowRight, History } from "lucide-react";
import { useApp, useName } from "@/components/app-provider";
import { Badge } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/core/dates";
import { formatAed } from "@/lib/core/money";
import { buildHistory } from "@/lib/core/revisions";
import type { ExpenseRevision, RevisionAction } from "@/lib/types";

const ACTION_LABEL: Record<RevisionAction, string> = {
  baseline: "History starts here",
  created: "Created",
  edited: "Edited",
  deleted: "Deleted",
};

/**
 * Change history for one expense: who changed what, when, with before → after values.
 * Loaded on demand from the append-only history; nobody can edit or remove these entries.
 */
export function ExpenseHistory({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const { repo } = useApp();
  const name = useName();
  const [open, setOpen] = React.useState(false);
  const [revisions, setRevisions] = React.useState<ExpenseRevision[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !repo) return;
    let cancelled = false;
    setError(null);
    repo
      .loadExpenseHistory(groupId, expenseId)
      .then((r) => !cancelled && setRevisions(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load history"));
    return () => {
      cancelled = true;
    };
  }, [open, repo, groupId, expenseId]);

  const entries = React.useMemo(
    () => (revisions ? buildHistory(revisions, (id) => name(id)) : []),
    [revisions, name],
  );
  const actor = (by: string | null) => (by ? name(by) : "Direct database change");

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-medium text-primary"
      >
        <History className="h-4 w-4" aria-hidden /> {open ? "Hide change history" : "Change history"}
      </button>

      {open && (
        <div className="mt-2">
          {error ? (
            <p className="text-sm text-negative">{error}</p>
          ) : !revisions ? (
            <div className="h-16 animate-pulse rounded-xl bg-muted" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history recorded for this expense.</p>
          ) : (
            <ol className="space-y-3 border-l-2 pl-4">
              {entries.map(({ revision: r, changes, isFirst }) => (
                <li key={r.id} className="relative">
                  <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.action === "deleted" ? "negative" : r.action === "edited" ? "primary" : "muted"}>
                      {ACTION_LABEL[r.action]}
                    </Badge>
                    <span className="text-sm font-medium">{actor(r.changedBy)}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.changedAt)}</span>
                  </div>

                  {isFirst && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatAed(r.snapshot.amountFils)} · paid by {name(r.snapshot.paidBy)} · {formatDate(r.snapshot.date)}
                      {r.action === "baseline" && " · edits made before tracking began aren't itemised"}
                    </p>
                  )}
                  {!isFirst && r.action === "deleted" && changes.length === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">Removed from balances.</p>
                  )}
                  {!isFirst && r.action === "edited" && changes.length === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">Saved with no changes.</p>
                  )}
                  {changes.length > 0 && (
                    <ul className="mt-1 space-y-1 text-sm">
                      {changes.map((c) => (
                        <li key={c.field}>
                          <span className="text-muted-foreground">{c.label}: </span>
                          <span className="break-words text-negative line-through decoration-1">{c.before}</span>
                          <ArrowRight className="mx-1 inline h-3 w-3 text-muted-foreground" aria-hidden />
                          <span className="break-words font-medium text-positive">{c.after}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
