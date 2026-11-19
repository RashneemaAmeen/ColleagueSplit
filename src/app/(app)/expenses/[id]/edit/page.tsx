"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ExpenseForm } from "@/components/expense-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Receipt } from "lucide-react";

export default function EditExpensePage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useApp();
  const router = useRouter();
  const expense = data?.expenses.find((e) => e.id === id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">Edit expense</h1>
      </div>
      {expense ? (
        // key resets the form state if the expense identity changes
        <ExpenseForm key={expense.id} expense={expense} />
      ) : (
        <EmptyState
          icon={Receipt}
          title="Expense not found"
          description="It may have been deleted."
          action={<Button onClick={() => router.replace("/expenses")}>Back to expenses</Button>}
        />
      )}
    </div>
  );
}
