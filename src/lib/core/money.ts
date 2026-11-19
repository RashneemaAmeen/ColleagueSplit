import type { SplitMethod } from "../types";

/** Largest single expense we accept: AED 1,000,000.00 (in fils). */
export const MAX_AMOUNT_FILS = 100_000_000;

/** Parse "12", "12.5", "1,234.50" into integer fils. Returns null if invalid. */
export function parseAmountToFils(input: string): number | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const fils = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(fils) ? fils : null;
}

/** Parse "33.33" into basis points (3333). Returns null if invalid. */
export function parsePercentToBp(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function bpToPercentString(bp: number): string {
  const s = (bp / 100).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** Plain decimal string for inputs/CSV: 12345 -> "123.45". */
export function filsToDecimal(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(fils);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const aedFormatter = new Intl.NumberFormat("en-AE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "AED 1,234.50". Negative values render with a leading minus. */
export function formatAed(fils: number): string {
  const abs = Math.abs(fils);
  const str = `AED ${aedFormatter.format(abs / 100)}`;
  return fils < 0 ? `-${str}` : str;
}

/** Same as formatAed but without the currency prefix, always unsigned. */
export function formatAmount(fils: number): string {
  return aedFormatter.format(Math.abs(fils) / 100);
}

export interface ShareResult {
  ok: boolean;
  error?: string;
  shares: { userId: string; shareFils: number; percentBp?: number }[];
}

/**
 * Split `total` fils across `userIds` as evenly as possible.
 * Leftover fils (total mod n) go one-each to the first users, so the shares
 * always add up to exactly `total`. `offset` rotates who gets the extra fils.
 */
export function splitEqual(total: number, userIds: string[], offset = 0): ShareResult["shares"] {
  const n = userIds.length;
  if (n === 0) return [];
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return userIds.map((userId, i) => {
    const rotated = (i - (offset % n) + n) % n;
    return { userId, shareFils: base + (rotated < remainder ? 1 : 0) };
  });
}

/**
 * Split by basis-point percentages using the largest-remainder method, so the
 * shares sum to exactly `total`. Percentages must sum to 10000 bp (100%).
 */
export function splitByPercent(
  total: number,
  entries: { userId: string; percentBp: number }[],
): ShareResult {
  const sum = entries.reduce((a, e) => a + e.percentBp, 0);
  if (entries.length === 0) return { ok: false, error: "Select at least one person", shares: [] };
  if (sum !== 10000) {
    return {
      ok: false,
      error: `Percentages add up to ${bpToPercentString(sum)}%, they must total 100%`,
      shares: [],
    };
  }
  const rows = entries.map((e, index) => {
    const exact = total * e.percentBp; // scaled by 10000
    return { ...e, index, floor: Math.floor(exact / 10000), rem: exact % 10000 };
  });
  let leftover = total - rows.reduce((a, r) => a + r.floor, 0);
  const byRemainder = [...rows].sort((a, b) => b.rem - a.rem || a.index - b.index);
  const extra = new Map<number, number>();
  for (const r of byRemainder) {
    if (leftover <= 0) break;
    extra.set(r.index, 1);
    leftover -= 1;
  }
  return {
    ok: true,
    shares: rows.map((r) => ({
      userId: r.userId,
      percentBp: r.percentBp,
      shareFils: r.floor + (extra.get(r.index) ?? 0),
    })),
  };
}

/** Validate that exact amounts add up to the total. */
export function checkExact(
  total: number,
  entries: { userId: string; shareFils: number }[],
): ShareResult {
  if (entries.length === 0) return { ok: false, error: "Select at least one person", shares: [] };
  const sum = entries.reduce((a, e) => a + e.shareFils, 0);
  if (sum !== total) {
    const diff = total - sum;
    return {
      ok: false,
      error:
        diff > 0
          ? `${formatAed(diff)} still to be assigned`
          : `Amounts exceed the total by ${formatAed(-diff)}`,
      shares: [],
    };
  }
  return { ok: true, shares: entries.map((e) => ({ ...e })) };
}

export interface ComputeSharesInput {
  method: SplitMethod;
  totalFils: number;
  participantIds: string[];
  /** For "exact": userId -> fils. For "percent": userId -> basis points. */
  custom?: Record<string, number>;
}

/** Single entry-point used by the form preview and by tests. */
export function computeShares(input: ComputeSharesInput): ShareResult {
  const { method, totalFils, participantIds, custom = {} } = input;
  if (participantIds.length === 0)
    return { ok: false, error: "Select at least one person", shares: [] };
  if (!Number.isSafeInteger(totalFils) || totalFils <= 0)
    return { ok: false, error: "Enter an amount greater than zero", shares: [] };
  if (method === "equal") return { ok: true, shares: splitEqual(totalFils, participantIds) };
  if (method === "exact")
    return checkExact(
      totalFils,
      participantIds.map((userId) => ({ userId, shareFils: custom[userId] ?? 0 })),
    );
  return splitByPercent(
    totalFils,
    participantIds.map((userId) => ({ userId, percentBp: custom[userId] ?? 0 })),
  );
}
