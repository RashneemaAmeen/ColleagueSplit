"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, KeyRound, Plus } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Header control to switch between the groups you belong to, or create / join another. */
export function GroupSwitcher() {
  const { groups, groupId, data, selectGroup } = useApp();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const current = groups.find((g) => g.id === groupId) ?? data?.group;

  async function pick(id: string) {
    setOpen(false);
    if (id !== groupId) {
      await selectGroup(id);
      router.push("/");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Switch group"
        className="flex max-w-[11rem] items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <span className="truncate">{current?.name ?? "Group"}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Your groups">
          <ul className="space-y-1">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => pick(g.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-3 text-left font-medium hover:bg-muted",
                    g.id === groupId && "bg-primary/10 text-primary",
                  )}
                >
                  <span className="truncate">{g.name}</span>
                  {g.id === groupId && <Check className="h-4 w-4" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => { setOpen(false); router.push("/welcome"); }}>
              <Plus className="h-4 w-4" /> New group
            </Button>
            <Button variant="outline" onClick={() => { setOpen(false); router.push("/welcome"); }}>
              <KeyRound className="h-4 w-4" /> Join with code
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
