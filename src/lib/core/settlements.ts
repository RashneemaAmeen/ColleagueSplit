import type { Settlement, SettlementInput } from "../types";

/**
 * Settlement lifecycle (mirrors supabase/migrations/0006_settlement_confirmation.sql):
 *
 *   recorded by one side ──► awaiting confirmation ──► confirmed
 *                                   │                      │
 *                                   └────── undone ◄───────┘
 *
 * IMPORTANT: balances count every settlement that is not undone, from the moment it is recorded.
 * Confirming therefore never changes a balance — it only marks the other party's agreement.
 */
export type SettlementStatus = "awaiting" | "confirmed" | "undone";

export function settlementStatus(s: Pick<Settlement, "undoneAt" | "confirmedAt">): SettlementStatus {
  if (s.undoneAt) return "undone";
  return s.confirmedAt ? "confirmed" : "awaiting";
}

export const STATUS_LABELS: Record<SettlementStatus, string> = {
  awaiting: "Awaiting confirmation",
  confirmed: "Confirmed",
  undone: "Undone",
};

/** People who may confirm: the payer and/or receiver, but never the person who recorded it. */
export function confirmers(s: Pick<Settlement, "fromUser" | "toUser" | "createdBy">): string[] {
  return [s.fromUser, s.toUser].filter((id) => id !== s.createdBy);
}

export function canConfirm(
  s: Pick<Settlement, "fromUser" | "toUser" | "createdBy" | "undoneAt" | "confirmedAt">,
  userId: string,
): boolean {
  return settlementStatus(s) === "awaiting" && confirmers(s).includes(userId);
}

/**
 * If `actorId` records a payment that the OTHER side already recorded (same direction, same
 * amount, still unconfirmed and not undone), that call is a confirmation of the existing record,
 * not a second payment. Different amounts (partial payments) or an already-confirmed payment
 * never match, so legitimate separate payments are not blocked. Oldest match wins.
 */
export function findMergeCandidate(
  settlements: Settlement[],
  input: Pick<SettlementInput, "groupId" | "fromUser" | "toUser" | "amountFils">,
  actorId: string,
): Settlement | undefined {
  if (actorId !== input.fromUser && actorId !== input.toUser) return undefined;
  return settlements
    .filter(
      (s) =>
        s.groupId === input.groupId &&
        s.fromUser === input.fromUser &&
        s.toUser === input.toUser &&
        s.amountFils === input.amountFils &&
        settlementStatus(s) === "awaiting" &&
        s.createdBy !== actorId,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
}
