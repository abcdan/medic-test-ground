/** Domain types shared across the CRM. */

export type DealStage =
  | "lead"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";

export const DEAL_STAGES: DealStage[] = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

export const STAGE_LABELS: Record<DealStage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal sent",
  negotiation: "Negotiation",
  won: "Closed won",
  lost: "Closed lost",
};

/** Probability of closing, used for the weighted pipeline. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  lead: 0.1,
  qualified: 0.25,
  proposal: 0.5,
  negotiation: 0.75,
  won: 1,
  lost: 0,
};

export type ActivityKind = "call" | "email" | "meeting" | "note" | "task";

export interface Company {
  id: string;
  name: string;
  domain: string;
  industry: string;
  employeeCount: number;
  country: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  annualRevenue: number;
  website: string;
}

export interface Contact {
  id: string;
  companyId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  ownerId: string;
  lifecycleStage: "subscriber" | "lead" | "customer" | "evangelist";
  createdAt: string;
  updatedAt: string;
  lastContactedAt: string | null;
  tags: string[];
  /** Rich text, entered in the notes editor. */
  notes: string;
  optedOut: boolean;
}

export interface Deal {
  id: string;
  title: string;
  companyId: string;
  primaryContactId: string | null;
  stage: DealStage;
  /** Amount in cents, in the deal's currency. */
  amount: number;
  currency: string;
  ownerId: string;
  expectedCloseDate: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: string;
  lostReason: string | null;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  subject: string;
  body: string;
  contactId: string | null;
  dealId: string | null;
  companyId: string | null;
  ownerId: string;
  occurredAt: string;
  durationMinutes: number;
  completed: boolean;
  dueAt: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: "rep" | "manager" | "admin";
  quotaCents: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SortSpec<T> {
  key: keyof T;
  direction: "asc" | "desc";
}

export interface FilterSpec {
  search: string;
  ownerId: string | null;
  stage: DealStage | null;
  tags: string[];
  createdAfter: string | null;
  createdBefore: string | null;
}

export const EMPTY_FILTER: FilterSpec = {
  search: "",
  ownerId: null,
  stage: null,
  tags: [],
  createdAfter: null,
  createdBefore: null,
};
