"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { LogoMark } from "@/components/logo";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Card, Input, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { DemoRepo } from "@/lib/store/demo";

/** Only allow same-site relative redirects (prevents open-redirect via ?next=). */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { repo, isDemo, reloadAll, ready, me } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const next = safeNext(params.get("next"));
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    if (ready && me) router.replace(next);
  }, [ready, me, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo || busy) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        if (password.length < 8) throw new Error("Password must be at least 8 characters");
        const { needsConfirmation } = await repo.signUp(email, password, name || email.split("@")[0]);
        if (needsConfirmation) {
          setSent(true);
          return;
        }
      } else {
        await repo.signIn(email, password);
      }
      await reloadAll();
      router.replace(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <LogoMark size={64} />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">ColleagueSplit</h1>
        <p className="text-muted-foreground">Spend together. Split smarter.</p>
      </div>

      {isDemo ? (
        <DemoPicker onPick={async (id) => {
          if (!(repo instanceof DemoRepo)) return;
          repo.switchUser(id);
          await reloadAll();
          router.replace(next);
        }} />
      ) : sent ? (
        <Card className="p-6 text-center">
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a confirmation link to <strong>{email}</strong>. Open it on this device to finish signing up.
          </p>
        </Card>
      ) : (
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4">
            <h2 className="text-lg font-semibold">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
            {mode === "signup" && (
              <div>
                <Label htmlFor="name">Your name</Label>
                <Input id="name" autoComplete="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Aisha" />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              {mode === "login" ? "Log in" : "Sign up"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                New here?{" "}
                <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>
                  Log in
                </Link>
              </>
            )}
          </p>
        </Card>
      )}
    </div>
  );
}

function DemoPicker({ onPick }: { onPick: (id: string) => Promise<void> }) {
  const { repo } = useApp();
  const users = repo instanceof DemoRepo ? repo.listDemoUsers() : [];
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
        <FlaskConical className="h-4 w-4" /> Demo mode
      </div>
      <h2 className="text-lg font-semibold">Choose who to be</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Supabase isn&apos;t configured, so you&apos;re previewing with sample data stored in this browser. Switch users any time from Profile.
      </p>
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id}>
            <button
              onClick={() => onPick(u.id)}
              className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted"
            >
              <MemberAvatar profile={u} />
              <span className="font-medium">{u.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
