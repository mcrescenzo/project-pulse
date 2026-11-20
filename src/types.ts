export const MILESTONE_STATUSES = [
  "planned",
  "active",
  "shipped",
  "archived",
] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const FEATURE_STATUSES = [
  "planned",
  "in-progress",
  "shipped",
  "paused",
  "cut",
] as const;

export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export interface ShipCriterion {
  id: string;
  text: string;
  done: boolean;
}

export interface FeatureUpdate {
  at: string;
  note: string;
}

export interface PulseConfig {
  version: number;
  project: {
    name: string;
    summary: string;
  };
  defaults: {
    milestone: string;
  };
  integrations: {
    beads: {
      enabled: boolean;
    };
  };
}

export interface Milestone {
  id: string;
  title: string;
  order: number;
  status: MilestoneStatus;
  target?: string;
  description: string;
}

export interface Feature {
  id: string;
  title: string;
  milestone: string;
  order: number;
  status: FeatureStatus;
  area?: string;
  depends_on: string[];
  refs: string[];
  ship_criteria: ShipCriterion[];
  updates: FeatureUpdate[];
  description: string;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  entityId?: string;
}

export interface BeadStatusInfo {
  ref: string;
  id: string;
  available: boolean;
  found: boolean;
  status?: string;
  title?: string;
  error?: string;
}

export interface CheckResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  beads?: Record<string, BeadStatusInfo[]>;
}

export interface SummaryFeatureItem {
  id: string;
  title: string;
  milestone: string;
  status: FeatureStatus;
  area?: string;
  criteriaDone: number;
  criteriaTotal: number;
  depends_on: string[];
  refs: string[];
  latestUpdate?: FeatureUpdate;
}

export interface SummaryMilestoneItem {
  id: string;
  title: string;
  status: MilestoneStatus | "backlog";
  target?: string;
  totalFeatures: number;
  shippedFeatures: number;
  features: SummaryFeatureItem[];
}

export interface SummaryResult {
  project: {
    name: string;
    summary: string;
  };
  totals: {
    milestones: number;
    features: number;
    shipped: number;
    inProgress: number;
    planned: number;
    paused: number;
    cut: number;
  };
  milestones: SummaryMilestoneItem[];
}

export interface ShowFeatureResult {
  feature: Feature;
  milestone?: Milestone;
  beads: BeadStatusInfo[];
}
