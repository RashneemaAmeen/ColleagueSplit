"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ExpenseForm } from "@/components/expense-form";
import { Button } from "@/components/ui/button";

export default function NewExpensePage() {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">Add expense</h1>
      </div>
      <ExpenseForm />
    </div>
  );
}
