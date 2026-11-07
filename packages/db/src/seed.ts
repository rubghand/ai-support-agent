import type { Db } from "./client";
import { customers, orders, tickets } from "./schema";

type Customer = typeof customers.$inferInsert;
type Order = typeof orders.$inferInsert;
type Ticket = typeof tickets.$inferInsert;

export interface SeedData {
  customers: Customer[];
  orders: Order[];
  tickets: Ticket[];
}

/** Prices in cents, matching knowledge-base/billing/plans-and-pricing.md and add-ons.md. */
export const PLAN_PRICES = {
  starter: { monthly: 1200, annual: 12000 },
  growth: { monthly: 3900, annual: 38400 },
  scale: { monthly: 9900, annual: 98400 },
} as const;

export const ADDON_PRICES = {
  "Extra seats": 600,
  "SMS reminders": 900,
  "Advanced reports": 1500,
  "Priority support": 2900,
  "Data migration": 14900,
} as const;

const SEED_NOW = new Date("2026-11-01T12:00:00Z");
const DAY_MS = 86_400_000;

const PEOPLE: Array<[name: string, company: string]> = [
  ["Maya Patel", "Bright Pixel Studio"],
  ["Lucas Moreau", "Moreau Consulting"],
  ["Aisha Bello", "Bello Bakery"],
  ["Tom Becker", "Becker Builds"],
  ["Sofia Rossi", "Rossi Design"],
  ["Daniel Kim", "Kim & Co Accounting"],
  ["Elena Petrova", "Northwind Translations"],
  ["James O'Neill", "O'Neill Photography"],
  ["Priya Nair", "Nair Health Coaching"],
  ["Mateo Garcia", "Garcia Plumbing"],
  ["Hannah Schmidt", "Schmidt Legal"],
  ["Kwame Mensah", "Mensah Media"],
  ["Chloe Martin", "Martin Events"],
  ["Ravi Shah", "Shah Software"],
  ["Ingrid Larsen", "Larsen Architecture"],
  ["Omar Haddad", "Haddad Imports"],
  ["Grace Liu", "Liu Tutoring"],
  ["Noah Williams", "Williams Fitness"],
  ["Zara Ahmed", "Ahmed Marketing"],
  ["Ben Carter", "Carter Landscaping"],
];

/**
 * Hand-written orders with known facts, referenced by eval cases and tool tests.
 * Keep in sync with evals/golden.jsonl when it exists.
 */
const FIXTURE_ORDERS: Order[] = [
  {
    id: "ORD-1042",
    customerId: "CUS-001",
    kind: "addon",
    item: "Priority support",
    amountCents: ADDON_PRICES["Priority support"],
    status: "paid",
    createdAt: new Date("2026-10-25T09:30:00Z"),
  },
  {
    id: "ORD-1043",
    customerId: "CUS-002",
    kind: "plan",
    item: "Growth (annual)",
    amountCents: PLAN_PRICES.growth.annual,
    status: "paid",
    createdAt: new Date("2026-10-15T14:00:00Z"),
  },
  {
    id: "ORD-1044",
    customerId: "CUS-003",
    kind: "plan",
    item: "Starter (monthly)",
    amountCents: PLAN_PRICES.starter.monthly,
    status: "failed",
    createdAt: new Date("2026-10-28T08:00:00Z"),
  },
  {
    id: "ORD-1045",
    customerId: "CUS-001",
    kind: "addon",
    item: "Data migration",
    amountCents: ADDON_PRICES["Data migration"],
    status: "refunded",
    createdAt: new Date("2026-09-02T11:00:00Z"),
  },
];

/** Small deterministic PRNG (mulberry32) so every seed run produces identical data. */
function createRandom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  return { next, pick };
}

function customerId(index: number): string {
  return `CUS-${String(index + 1).padStart(3, "0")}`;
}

export function generateSeedData(seed = 42): SeedData {
  const random = createRandom(seed);
  const paidPlans = ["starter", "growth", "scale"] as const;
  const cycles = ["monthly", "annual"] as const;

  const seededCustomers: Customer[] = PEOPLE.map(([name, company], index) => {
    const first = name
      .split(" ")[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    const domain = company.toLowerCase().replace(/[^a-z]+/g, "") + ".example";
    return {
      id: customerId(index),
      name,
      email: `${first}@${domain}`,
      company,
      plan: index === 19 ? "free" : random.pick(paidPlans),
      billingCycle: random.pick(cycles),
      createdAt: new Date(SEED_NOW.getTime() - (200 + Math.floor(random.next() * 500)) * DAY_MS),
    };
  });
  // Fixture customers need plans that match their fixture orders.
  Object.assign(seededCustomers[0]!, { plan: "growth", billingCycle: "monthly" });
  Object.assign(seededCustomers[1]!, { plan: "growth", billingCycle: "annual" });
  Object.assign(seededCustomers[2]!, { plan: "starter", billingCycle: "monthly" });

  const fixtures = new Map(FIXTURE_ORDERS.map((order) => [order.id, order]));
  const payingCustomers = seededCustomers.filter((c) => c.plan !== "free");
  const addonNames = Object.keys(ADDON_PRICES) as Array<keyof typeof ADDON_PRICES>;
  const statuses = ["paid", "paid", "paid", "paid", "paid", "paid", "pending", "failed", "refunded"] as const;

  const seededOrders: Order[] = [];
  for (let n = 1001; n <= 1100; n++) {
    const id = `ORD-${n}`;
    const fixture = fixtures.get(id);
    if (fixture) {
      seededOrders.push(fixture);
      continue;
    }
    const customer = random.pick(payingCustomers);
    const createdAt = new Date(SEED_NOW.getTime() - Math.floor(random.next() * 180) * DAY_MS);
    const status = random.pick(statuses);
    if (random.next() < 0.6) {
      const plan = customer.plan as (typeof paidPlans)[number];
      const cycle = customer.billingCycle!;
      seededOrders.push({
        id,
        customerId: customer.id,
        kind: "plan",
        item: `${plan[0]!.toUpperCase()}${plan.slice(1)} (${cycle})`,
        amountCents: PLAN_PRICES[plan][cycle],
        status,
        createdAt,
      });
    } else {
      const addon = random.pick(addonNames);
      seededOrders.push({
        id,
        customerId: customer.id,
        kind: "addon",
        item: addon,
        amountCents: ADDON_PRICES[addon],
        status,
        createdAt,
      });
    }
  }

  const seededTickets: Ticket[] = [
    {
      customerId: "CUS-003",
      subject: "Card declined on subscription renewal",
      body: "My Starter renewal failed (ORD-1044). I updated my card, can you retry?",
      status: "open",
      priority: "high",
      createdAt: new Date("2026-10-28T10:00:00Z"),
    },
    {
      customerId: "CUS-005",
      subject: "QuickBooks sync error: duplicate document number",
      body: "Invoices INV-0102 to INV-0105 fail to sync to QuickBooks.",
      status: "pending",
      priority: "normal",
      createdAt: new Date("2026-10-20T15:30:00Z"),
    },
    {
      customerId: "CUS-001",
      subject: "Data migration refund",
      body: "Migration was never started, please refund ORD-1045.",
      status: "closed",
      priority: "normal",
      createdAt: new Date("2026-09-03T09:00:00Z"),
    },
    {
      customerId: "CUS-012",
      subject: "How do I add a second template?",
      body: "I'm on Starter and can't find where to add another invoice template.",
      status: "closed",
      priority: "low",
      createdAt: new Date("2026-08-11T13:00:00Z"),
    },
    {
      customerId: "CUS-008",
      subject: "Payout missing",
      body: "My payout from Monday hasn't arrived yet.",
      status: "open",
      priority: "normal",
      createdAt: new Date("2026-10-30T07:45:00Z"),
    },
  ];

  return { customers: seededCustomers, orders: seededOrders, tickets: seededTickets };
}

/** Replaces all product data (customers, orders, tickets) with the deterministic seed. */
export async function seedDatabase(db: Db, data: SeedData = generateSeedData()) {
  await db.transaction(async (tx) => {
    await tx.delete(tickets);
    await tx.delete(orders);
    await tx.delete(customers);
    await tx.insert(customers).values(data.customers);
    await tx.insert(orders).values(data.orders);
    await tx.insert(tickets).values(data.tickets);
  });
  return { customers: data.customers.length, orders: data.orders.length, tickets: data.tickets.length };
}
