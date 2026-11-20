"use client";

import {
  Car,
  Coffee,
  Cookie,
  Receipt,
  ShoppingBasket,
  Sunrise,
  Utensils,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useApp, useName } from "@/components/app-provider";
import { Amount } from "@/components/amount";
import { formatDate } from "@/lib/core/dates";
import { wasEdited } from "@/lib/core/revisions";
import { Badge } from "@/components/ui/primitives";
import { CATEGORY_LABELS } from "@/lib/types";
import type { Category, Expense } from "@/lib/types";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  lunch: UtensilsCrossed,
  breakfast: Sunrise,
  dinner: Utensils,
  coffee: Coffee,
  snacks: Cookie,
  groceries: ShoppingBasket,
  transport: Car,
  other: Receipt,
};

/** What this expense means for the signed-in user. Positive = they are owed, negative = they owe. */
export function myPosition(e: Expense, myId: string): number {
  const share = e.splits.find((s) => s.userId === myId)?.shareFils ?? 0;
  return (e.paidBy === myId ? e.amountFils : 0) - share;
}

export function ExpenseRow({ expense, onClick, className }: { expense: Expense; onClick?: () => void; className?: string }) {
  const { me } = useApp();
  const name = useName();
  const Icon = CATEGORY_ICONS[expense.category];
  const position = me ? myPosition(expense, me.id) : 0;
  const involved = me ? expense.paidBy === me.id || expense.splits.some((s) => s.userId === me.id) : false;
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      onClick={onClick}
      className={cn("flex w-full items-center gap-3 p-3 text-left", onClick && "transition-colors hover:bg-muted/60", className)}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{expense.description}</span>
          {wasEdited(expense) && <Badge className="shrink-0">edited</Badge>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {name(expense.paidBy)} paid · {formatDate(expense.date)} · {CATEGORY_LABELS[expense.category]}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <Amount fils={expense.amountFils} className="block text-sm" />
        {involved ? (
          position === 0 ? (
            <span className="text-xs text-muted-foreground">settled</span>
          ) : (
            <span className={cn("text-xs font-medium", position > 0 ? "text-positive" : "text-negative")}>
              {position > 0 ? "you lent" : "you owe"} {Math.abs(position / 100).toFixed(2)}
            </span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">not involved</span>
        )}
      </span>
    </Tag>
  );
}
