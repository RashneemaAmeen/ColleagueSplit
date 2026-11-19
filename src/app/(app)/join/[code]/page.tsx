"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

/** Invite link landing page: /join/<code>. Joining always requires an explicit tap. */
export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const { repo, reloadAll, selectGroup, me } = useApp();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function join() {
    if (!repo || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await repo.joinGroup(decodeURIComponent(code));
      await reloadAll();
      await selectGroup(id);
      toast.success("Welcome to the group!");
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <UserPlus className="h-6 w-6" />
      </span>
      <h1 className="text-xl font-bold">You&apos;ve been invited</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Join as <strong>{me?.name}</strong> to start sharing expenses.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-negative">
          {error}
        </p>
      )}
      <Button className="mt-5 w-full" size="lg" onClick={join} loading={busy}>
        Join group
      </Button>
      <Button variant="ghost" className="mt-2 w-full" onClick={() => router.replace("/")}>
        Not now
      </Button>
    </Card>
  );
}
