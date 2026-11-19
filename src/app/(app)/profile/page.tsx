"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, Camera, Check, ChevronRight, Copy, History, LogOut, RotateCcw, UserPlus } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { MemberAvatar } from "@/components/member-avatar";
import { ThemeToggle } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { Badge, Card, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { resizeImage } from "@/lib/download";
import { DemoRepo } from "@/lib/store/demo";
import { AVATAR_COLORS, cn } from "@/lib/utils";

export default function ProfilePage() {
  const { me, repo, data, members, reloadAll, signOut, isDemo } = useApp();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = React.useState(me?.name ?? "");
  const [saving, setSaving] = React.useState(false);
  const [invite, setInvite] = React.useState<{ code: string; link: string; expiresAt: string } | null>(null);
  const [inviting, setInviting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setName(me?.name ?? ""), [me?.name]);
  if (!me || !data || !repo) return null;
  const isAdmin = members.find((m) => m.userId === me.id)?.role === "admin";

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!repo || saving || name.trim() === me?.name) return;
    setSaving(true);
    try {
      await repo.updateProfile({ name });
      await reloadAll();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setSaving(false);
    }
  }

  async function setColor(i: number) {
    try {
      await repo!.updateProfile({ colorIndex: i });
      await reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update colour");
    }
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image");
    try {
      await repo!.updateProfile({ avatar: await resizeImage(file) });
      await reloadAll();
      toast.success("Photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload photo");
    }
  }

  async function createInvite() {
    if (!repo || inviting) return;
    setInviting(true);
    try {
      const { code, expiresAt } = await repo.createInvitation(data!.group.id);
      setInvite({ code, expiresAt, link: `${window.location.origin}/join/${code}` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create invitation");
    } finally {
      setInviting(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select and copy manually");
    }
  }

  async function logout() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>

      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <MemberAvatar profile={me} size="lg" />
            <button
              type="button"
              aria-label="Change photo"
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{me.name}</p>
            {me.email && <p className="truncate text-sm text-muted-foreground">{me.email}</p>}
            {me.avatarUrl && (
              <button className="text-xs text-primary" onClick={() => repo.updateProfile({ avatar: null }).then(reloadAll)}>
                Remove photo
              </button>
            )}
          </div>
        </div>

        <form onSubmit={saveName} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="pname">Display name</Label>
            <Input id="pname" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === me.name}>
            Save
          </Button>
        </form>

        {!me.avatarUrl && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Avatar colour</p>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${i + 1}`}
                  aria-pressed={me.colorIndex === i}
                  onClick={() => setColor(i)}
                  className={cn("flex h-8 w-8 items-center justify-center rounded-full text-white", me.colorIndex === i && "ring-2 ring-ring ring-offset-2 ring-offset-card")}
                  style={{ backgroundColor: c }}
                >
                  {me.colorIndex === i && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <section aria-labelledby="grp-h">
        <h2 id="grp-h" className="mb-2 font-semibold">
          {data.group.name} · {members.length} members
        </h2>
        <Card className="divide-y">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 p-3">
              <MemberAvatar profile={m.profile} size="sm" />
              <span className="flex-1 truncate font-medium">{m.profile.name}</span>
              {m.role === "admin" && <Badge tone="primary">admin</Badge>}
            </div>
          ))}
        </Card>

        {isAdmin ? (
          <div className="mt-3">
            {invite ? (
              <Card className="space-y-3 p-4">
                <p className="text-sm font-medium">Share this with your colleague</p>
                <div className="flex items-center gap-2 rounded-xl bg-muted p-2">
                  <code className="flex-1 truncate px-1 text-xs">{invite.link}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(invite.link)}>
                    <Copy className="h-4 w-4" /> Link
                  </Button>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-muted p-2">
                  <code className="flex-1 px-1 font-mono text-base tracking-widest">{invite.code}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(invite.code)}>
                    <Copy className="h-4 w-4" /> Code
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Single-group invite · expires {new Date(invite.expiresAt).toLocaleDateString("en-GB")} · up to 10 people. Only share it with people you trust.
                </p>
              </Card>
            ) : (
              <Button variant="outline" className="w-full" onClick={createInvite} loading={inviting}>
                <UserPlus className="h-4 w-4" /> Invite a colleague
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Only group admins can create invitations.</p>
        )}
      </section>

      <Card className="divide-y">
        <Link href="/reports" className="flex items-center gap-3 p-4 hover:bg-muted/60">
          <BarChart3 className="h-5 w-5 text-primary" /> <span className="flex-1 font-medium">Monthly reports</span> <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link href="/activity" className="flex items-center gap-3 p-4 hover:bg-muted/60">
          <History className="h-5 w-5 text-primary" /> <span className="flex-1 font-medium">Activity log</span> <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </Card>

      <Card className="space-y-3 p-4">
        <p className="font-medium">Appearance</p>
        <ThemeToggle />
      </Card>

      {isDemo && repo instanceof DemoRepo && (
        <Card className="space-y-3 border-amber-300 p-4 dark:border-amber-700">
          <p className="font-medium">Demo tools</p>
          <div>
            <Label htmlFor="demo-user">Switch demo user</Label>
            <Select
              id="demo-user"
              value={me.id}
              onChange={async (e) => {
                (repo as DemoRepo).switchUser(e.target.value);
                await reloadAll();
                toast.success("Switched user");
                router.replace("/");
              }}
            >
              {(repo as DemoRepo).listDemoUsers().map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              (repo as DemoRepo).reset();
              await reloadAll();
              toast.success("Demo data reset");
              router.replace("/");
            }}
          >
            <RotateCcw className="h-4 w-4" /> Reset demo data
          </Button>
        </Card>
      )}

      <Button variant="outline" className="w-full text-negative" onClick={logout}>
        <LogOut className="h-4 w-4" /> {isDemo ? "Switch account" : "Log out"}
      </Button>
    </div>
  );
}
