import { formatAed } from "@/lib/core/money";
import { cn } from "@/lib/utils";

/**
 * Money display. With `signed`, positive amounts are green ("+AED 30.00") and
 * negative amounts red ("-AED 30.00"); zero is neutral.
 */
export function Amount({
  fils,
  signed = false,
  className,
}: {
  fils: number;
  signed?: boolean;
  className?: string;
}) {
  const tone = !signed || fils === 0 ? "" : fils > 0 ? "text-positive" : "text-negative";
  const prefix = signed && fils > 0 ? "+" : "";
  return <span className={cn("tabular font-semibold", tone, className)}>{prefix + formatAed(fils)}</span>;
}
