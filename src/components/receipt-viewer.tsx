"use client";

import * as React from "react";
import { Paperclip } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** Fetches a short-lived signed URL only when opened — receipts are never public. */
export function ReceiptViewer({ path }: { path: string }) {
  const { repo } = useApp();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [imgFailed, setImgFailed] = React.useState(false);

  React.useEffect(() => {
    if (!open || !repo) return;
    setUrl(null);
    setError(null);
    setImgFailed(false);
    repo
      .getReceiptUrl(path)
      .then((u) => (u ? setUrl(u) : setError("Receipt is not available in this browser session.")))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load receipt"));
  }, [open, repo, path]);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Paperclip className="h-4 w-4" /> Receipt
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Receipt">
          {error ? (
            <p className="text-sm text-negative">{error}</p>
          ) : !url ? (
            <div className="h-48 animate-pulse rounded-xl bg-muted" />
          ) : imgFailed ? (
            <Button asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open file
              </a>
            </Button>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Receipt" onError={() => setImgFailed(true)} className="max-h-[70dvh] w-full rounded-xl object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
