"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Users } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Card, Input, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export default function WelcomePage() {
  const { repo, me, reloadAll, selectGroup, groups, signOut } = useApp();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState<"create" | "join" | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!repo || busy) return;
    setBusy("create");
    try {
      const id = await repo.createGroup(name);
      await reloadAll();
      await selectGroup(id);
      toast.success("Group created");
      router.replace("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create group");
    } finally {
      setBusy(null);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!repo || busy) return;
    setBusy("join");
    try {
      const id = await repo.joinGroup(code);
      await reloadAll();
      await selectGroup(id);
      toast.success("You're in!");
      router.replace("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not join group");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {groups.length > 0 ? "Add another group" : `Hi ${me?.name ?? "there"} 👋`}
        </h1>
        <p className="text-muted-foreground">Create a group for your team, or join one with an invite code.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={create} className="space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <Users className="h-5 w-5 text-primary" /> Create a group
          </div>
          <div>
            <Label htmlFor="gname">Group name</Label>
            <Input id="gname" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Lunch Crew" />
          </div>
          <Button type="submit" className="w-full" loading={busy === "create"}>
            Create group
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <form onSubmit={join} className="space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-5 w-5 text-primary" /> Have an invite code?
          </div>
          <div>
            <Label htmlFor="code">Invite code</Label>
            <Input
              id="code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A3F09C21B7D4"
              autoCapitalize="characters"
              autoComplete="off"
              className="font-mono tracking-wider"
            />
          </div>
          <Button type="submit" variant="outline" className="w-full" loading={busy === "join"}>
            Join group
          </Button>
        </form>
      </Card>

      {groups.length > 0 && (
        <Button variant="ghost" className="w-full" onClick={() => router.replace("/")}>
          Cancel
        </Button>
      )}

      <button onClick={() => signOut().then(() => router.replace("/login"))} className="block w-full text-center text-sm text-muted-foreground underline">
        Sign out
      </button>
    </div>
  );
}
