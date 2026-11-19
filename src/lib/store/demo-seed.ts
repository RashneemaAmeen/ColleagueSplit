import { computeShares } from "../core/money";
import { currentMonthKey, shiftMonth, todayISO } from "../core/dates";
import type {
  Activity,
  Category,
  Expense,
  Group,
  Member,
  Profile,
  Settlement,
  SplitMethod,
} from "../types";

export interface DemoInvite {
  code: string;
  groupId: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
}

export type DemoExpense = Expense & { deletedAt: string | null };

export interface DemoState {
  version: 1;
  currentUserId: string | null;
  users: Profile[];
  groups: Group[];
  members: (Member & { groupId: string })[];
  expenses: DemoExpense[];
  settlements: Settlement[];
  activity: Activity[];
  invites: DemoInvite[];
  /** `${groupId}:${clientRequestId}` -> entity id (idempotency). */
  idempotency: Record<string, string>;
}

export const DEMO_GROUP_ID = "g-office";

const USERS: Profile[] = [
  { id: "u-aisha", name: "Aisha", colorIndex: 0 },
  { id: "u-omar", name: "Omar", colorIndex: 3 },
  { id: "u-priya", name: "Priya", colorIndex: 5 },
  { id: "u-rashid", name: "Rashid", colorIndex: 7 },
  // Not a member of any group — used to try the invite flow and unauthorized access.
  { id: "u-sam", name: "Sam (outsider)", colorIndex: 2 },
];

function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayISO(d);
}

interface SeedExpense {
  desc: string;
  amount: number; // fils
  date: string;
  paidBy: string;
  category: Category;
  method: SplitMethod;
  participants: string[];
  custom?: Record<string, number>;
  notes?: string;
}

export function createSeedState(): DemoState {
  const now = new Date().toISOString();
  const all = ["u-aisha", "u-omar", "u-priya", "u-rashid"];
  const prev = shiftMonth(currentMonthKey(), -1);

  const seeds: SeedExpense[] = [
    { desc: "Lunch at Zaatar w Zeit", amount: 12000, date: dayOffset(0), paidBy: "u-aisha", category: "lunch", method: "equal", participants: all },
    { desc: "Morning coffee run", amount: 4650, date: dayOffset(1), paidBy: "u-omar", category: "coffee", method: "equal", participants: all },
    { desc: "Office snacks", amount: 8735, date: dayOffset(2), paidBy: "u-priya", category: "groceries", method: "equal", participants: ["u-priya", "u-rashid", "u-aisha"] },
    { desc: "Team dinner", amount: 31000, date: dayOffset(4), paidBy: "u-rashid", category: "dinner", method: "percent", participants: all, custom: { "u-rashid": 4000, "u-aisha": 2000, "u-omar": 2000, "u-priya": 2000 }, notes: "Rashid had the steak" },
    { desc: "Taxi to client meeting", amount: 5500, date: dayOffset(5), paidBy: "u-aisha", category: "transport", method: "exact", participants: ["u-aisha", "u-omar"], custom: { "u-aisha": 1500, "u-omar": 4000 } },
    { desc: "Breakfast croissants", amount: 6400, date: dayOffset(6), paidBy: "u-omar", category: "breakfast", method: "equal", participants: all },
    { desc: "Friday lunch", amount: 14300, date: `${prev}-27`, paidBy: "u-priya", category: "lunch", method: "equal", participants: all },
    { desc: "Coffee beans for the pantry", amount: 9900, date: `${prev}-21`, paidBy: "u-rashid", category: "coffee", method: "equal", participants: all },
    { desc: "Shawarma", amount: 7600, date: `${prev}-14`, paidBy: "u-omar", category: "lunch", method: "equal", participants: ["u-omar", "u-priya", "u-rashid"] },
    { desc: "Afternoon snacks", amount: 3350, date: `${prev}-09`, paidBy: "u-aisha", category: "snacks", method: "equal", participants: all },
  ];

  const expenses: DemoExpense[] = seeds.map((s, i) => {
    const r = computeShares({
      method: s.method,
      totalFils: s.amount,
      participantIds: s.participants,
      custom: s.custom,
    });
    return {
      id: `e-seed-${i + 1}`,
      groupId: DEMO_GROUP_ID,
      description: s.desc,
      amountFils: s.amount,
      date: s.date,
      paidBy: s.paidBy,
      category: s.category,
      splitMethod: s.method,
      notes: s.notes ?? "",
      receiptPath: null,
      createdBy: s.paidBy,
      createdAt: now,
      updatedAt: now,
      splits: r.shares.map((x) => ({ userId: x.userId, shareFils: x.shareFils, percentBp: x.percentBp ?? null })),
      deletedAt: null,
    };
  });

  const members = USERS.slice(0, 4).map((u, i) => ({
    groupId: DEMO_GROUP_ID,
    userId: u.id,
    role: i === 0 ? ("admin" as const) : ("member" as const),
    joinedAt: now,
    profile: u,
  }));

  const settlements: Settlement[] = [
    {
      id: "s-seed-1",
      groupId: DEMO_GROUP_ID,
      fromUser: "u-priya",
      toUser: "u-rashid",
      amountFils: 3000,
      method: "cash",
      date: dayOffset(3),
      note: "Part of dinner",
      createdBy: "u-priya",
      createdAt: now,
      undoneAt: null,
      undoneBy: null,
      undoReason: null,
    },
  ];

  const activity: Activity[] = [
    {
      id: "a-seed-0",
      groupId: DEMO_GROUP_ID,
      actorId: "u-aisha",
      action: "group_created",
      entityType: "group",
      entityId: DEMO_GROUP_ID,
      summary: 'Created the group "Lunch Crew"',
      createdAt: now,
    },
  ];

  return {
    version: 1,
    currentUserId: "u-aisha",
    users: USERS.map((u) => ({ ...u })),
    groups: [
      { id: DEMO_GROUP_ID, name: "Lunch Crew", currency: "AED", createdBy: "u-aisha", createdAt: now },
    ],
    members,
    expenses,
    settlements,
    activity,
    invites: [],
    idempotency: {},
  };
}
