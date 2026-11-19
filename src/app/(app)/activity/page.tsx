"use client";

import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { useApp, useName } from "@/components/app-provider";
import { EmptyState } from "@/components/empty-state";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/core/dates";

export default function ActivityPage() {
  const { data, memberById } = useApp();
  const name = useName();
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link href="/profile">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold">Activity log</h1>
      </div>
      {data.activity.length === 0 ? (
        <EmptyState icon={History} title="No activity yet" />
      ) : (
        <Card className="divide-y">
          {data.activity.map((a) => {
            const actor = memberById(a.actorId)?.profile;
            return (
              <div key={a.id} className="flex items-start gap-3 p-3">
                {actor && <MemberAvatar profile={actor} size="sm" />}
                <div className="min-w-0">
                  <p className="text-sm">
                    <strong>{name(a.actorId)}</strong> · {a.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
