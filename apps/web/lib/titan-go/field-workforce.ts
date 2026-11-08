export type FieldWorkforceGroupId = "operations" | "quality" | "assets" | "standards" | "insight";

export type FieldWorkerDefinition = Readonly<{
  name: string;
  purpose: string;
}>;

export type FieldSpecialistDefinition = Readonly<{
  id: string;
  name: string;
  purpose: string;
  group: FieldWorkforceGroupId;
  runtimeAgentKey?: "scheduling" | "dispatch" | "jobs";
  workers: readonly FieldWorkerDefinition[];
}>;

export type FieldWorkforceGroup = Readonly<{
  id: FieldWorkforceGroupId;
  name: string;
  description: string;
  outcome: string;
  leadSpecialistId: string;
  specialists: readonly FieldSpecialistDefinition[];
}>;

function worker(name: string, purpose: string): FieldWorkerDefinition {
  return Object.freeze({ name, purpose });
}

function specialist(input: FieldSpecialistDefinition): FieldSpecialistDefinition {
  return Object.freeze({ ...input, workers: Object.freeze([...input.workers]) });
}

export const FIELD_WORKFORCE_GROUPS: readonly FieldWorkforceGroup[] = Object.freeze([
  Object.freeze({
    id: "operations",
    name: "Operations & Delivery",
    description: "Plan the day, allocate work, move crews and keep jobs progressing.",
    outcome: "Plan, allocate and deliver today’s work.",
    leadSpecialistId: "dispatch",
    specialists: Object.freeze([
      specialist({
        id: "scheduling",
        name: "Scheduling Specialist",
        purpose: "Builds practical schedules around availability, skills, dependencies and service windows.",
        group: "operations",
        runtimeAgentKey: "scheduling",
        workers: [
          worker("Scheduling Worker", "Creates and adjusts bounded schedule placements."),
          worker("Gap-Fill Worker", "Finds recoverable capacity after cancellations or delays."),
          worker("Recurring Work Worker", "Maintains recurring work patterns and future visits."),
        ],
      }),
      specialist({
        id: "dispatch",
        name: "Dispatch Specialist",
        purpose: "Coordinates active field work and resolves same-day delivery exceptions.",
        group: "operations",
        runtimeAgentKey: "dispatch",
        workers: [
          worker("Dispatch Worker", "Issues bounded dispatch actions and status updates."),
          worker("Assignment Worker", "Matches suitable workers to field work."),
          worker("Access Worker", "Checks site access instructions before arrival."),
          worker("Weather Recovery Worker", "Prepares safe recovery actions for weather disruption."),
        ],
      }),
      specialist({
        id: "routing",
        name: "Routing Specialist",
        purpose: "Reduces unnecessary travel and sequences field movement efficiently.",
        group: "operations",
        workers: [
          worker("Route Worker", "Builds and updates travel sequences for assigned work."),
          worker("Travel Intelligence Worker", "Compares travel time and route constraints."),
        ],
      }),
      specialist({
        id: "capacity",
        name: "Capacity Specialist",
        purpose: "Balances workload, identifies available capacity and protects service commitments.",
        group: "operations",
        workers: [
          worker("Capacity Worker", "Calculates available operational capacity."),
          worker("Workload Balance Worker", "Flags overloaded or underused teams."),
        ],
      }),
      specialist({
        id: "workforce",
        name: "Workforce Specialist",
        purpose: "Coordinates availability, skills and workforce readiness for delivery.",
        group: "operations",
        workers: [
          worker("Availability Worker", "Checks working availability and assignment constraints."),
          worker("Notification Worker", "Delivers bounded operational workforce notifications."),
        ],
      }),
      specialist({
        id: "jobs",
        name: "Job Specialist",
        purpose: "Keeps jobs, work orders, visits and field scope aligned through completion.",
        group: "operations",
        runtimeAgentKey: "jobs",
        workers: [
          worker("Checklist Worker", "Applies service and completion checklists."),
          worker("Variation Worker", "Prepares scope-change and variation records."),
          worker("Service Report Worker", "Assembles completion and service reporting evidence."),
        ],
      }),
      specialist({
        id: "field-support",
        name: "Field Support Specialist",
        purpose: "Supports workers during active jobs when something changes or blocks delivery.",
        group: "operations",
        workers: [
          worker("Field Support Worker", "Handles bounded field-support tasks and escalations."),
          worker("Job Notes Worker", "Records structured site and job context."),
        ],
      }),
    ]),
  }),
  Object.freeze({
    id: "quality",
    name: "Quality & Evidence",
    description: "Prove the work, inspect quality and recover defects before they become customer problems.",
    outcome: "Prove completion and protect service quality.",
    leadSpecialistId: "quality",
    specialists: Object.freeze([
      specialist({
        id: "quality",
        name: "Quality Specialist",
        purpose: "Monitors delivery quality, defects, rework and completion standards.",
        group: "quality",
        workers: [
          worker("Quality Worker", "Runs bounded quality checks against service requirements."),
          worker("Visual Review Worker", "Reviews visual evidence for obvious completion or quality issues."),
          worker("Corrective Action Worker", "Prepares corrective work after a verified nonconformance."),
        ],
      }),
      specialist({
        id: "evidence",
        name: "Evidence Specialist",
        purpose: "Ensures required photos, signatures and completion evidence are present and attributable.",
        group: "quality",
        workers: [
          worker("Evidence Worker", "Collects and validates required job evidence."),
          worker("Photo Review Worker", "Checks photo evidence against required capture rules."),
        ],
      }),
    ]),
  }),
  Object.freeze({
    id: "assets",
    name: "Assets & Supply",
    description: "Keep materials, equipment and supply readiness aligned to scheduled work.",
    outcome: "Keep every job supplied and equipment-ready.",
    leadSpecialistId: "supply",
    specialists: Object.freeze([
      specialist({
        id: "materials",
        name: "Materials Specialist",
        purpose: "Tracks materials and consumables required and used on field work.",
        group: "assets",
        workers: [worker("Materials Worker", "Records and checks job material requirements and usage.")],
      }),
      specialist({
        id: "inventory",
        name: "Inventory Specialist",
        purpose: "Maintains stock visibility and flags shortages affecting delivery.",
        group: "assets",
        workers: [worker("Inventory Worker", "Updates bounded inventory and stock movements.")],
      }),
      specialist({
        id: "equipment",
        name: "Equipment Specialist",
        purpose: "Tracks equipment custody, condition and job readiness.",
        group: "assets",
        workers: [worker("Equipment Worker", "Checks equipment assignment, custody and readiness.")],
      }),
      specialist({
        id: "maintenance",
        name: "Maintenance Specialist",
        purpose: "Keeps service equipment available through planned and exception maintenance.",
        group: "assets",
        workers: [worker("Maintenance Worker", "Prepares and tracks equipment maintenance tasks.")],
      }),
      specialist({
        id: "supply",
        name: "Supply Specialist",
        purpose: "Coordinates replenishment and supplier actions that protect field readiness.",
        group: "assets",
        workers: [
          worker("Supplier Order Worker", "Prepares bounded supplier-order actions."),
          worker("Goods Receipt Worker", "Records received field materials and equipment."),
        ],
      }),
    ]),
  }),
  Object.freeze({
    id: "standards",
    name: "Standards, Safety & Capability",
    description: "Titan Standards is included in Field: SOPs, safety, compliance, training and audit control.",
    outcome: "Keep work safe, compliant and repeatable.",
    leadSpecialistId: "standards",
    specialists: Object.freeze([
      specialist({
        id: "safety",
        name: "Safety Specialist",
        purpose: "Coordinates field safety requirements, incidents and safe-work controls.",
        group: "standards",
        workers: [worker("Safety Worker", "Records and checks bounded safety actions and incidents.")],
      }),
      specialist({
        id: "standards",
        name: "Standards Specialist",
        purpose: "Owns service standards, SOP alignment and work-instruction coverage.",
        group: "standards",
        workers: [worker("Standards Worker", "Checks work against the applicable SOP and service standard.")],
      }),
      specialist({
        id: "compliance",
        name: "Compliance Specialist",
        purpose: "Tracks licences, certifications, requirements and expiry-sensitive compliance.",
        group: "standards",
        workers: [worker("Compliance Worker", "Checks bounded compliance requirements and expiry states.")],
      }),
      specialist({
        id: "training",
        name: "Training Specialist",
        purpose: "Maintains training, competency and refresher readiness for field work.",
        group: "standards",
        workers: [worker("Training Worker", "Tracks training and competency actions.")],
      }),
      specialist({
        id: "audit",
        name: "Audit Specialist",
        purpose: "Coordinates job, safety and operational audits with evidence-backed findings.",
        group: "standards",
        workers: [worker("Audit Worker", "Runs bounded audit checks and records findings.")],
      }),
      specialist({
        id: "improvement",
        name: "Continuous Improvement Specialist",
        purpose: "Turns recurring defects and operational friction into governed improvement work.",
        group: "standards",
        workers: [worker("Improvement Worker", "Prepares root-cause and improvement follow-up actions.")],
      }),
    ]),
  }),
  Object.freeze({
    id: "insight",
    name: "Operations Intelligence",
    description: "Explain performance, expose risk and anticipate operational pressure without granting authority.",
    outcome: "Explain performance and anticipate pressure early.",
    leadSpecialistId: "analytics",
    specialists: Object.freeze([
      specialist({
        id: "analytics",
        name: "Operations Analytics Specialist",
        purpose: "Explains capacity, utilisation, travel, lateness, quality and field performance.",
        group: "insight",
        workers: [worker("Operations Metrics Worker", "Builds bounded operational performance measurements.")],
      }),
      specialist({
        id: "predictive",
        name: "Predictive Operations Specialist",
        purpose: "Anticipates workload, disruption and quality risk so authorised responses can start earlier.",
        group: "insight",
        workers: [
          worker("Demand Forecast Worker", "Forecasts likely field workload and capacity pressure."),
          worker("Risk Signal Worker", "Identifies likely operational exceptions for review."),
        ],
      }),
    ]),
  }),
]);

export const FIELD_SPECIALISTS = Object.freeze(FIELD_WORKFORCE_GROUPS.flatMap((group) => group.specialists));
export const FIELD_WORKERS = Object.freeze(FIELD_SPECIALISTS.flatMap((entry) => entry.workers));
export const FIELD_RUNTIME_AGENT_KEYS = Object.freeze(["scheduling", "dispatch", "jobs"] as const);

export function fieldWorkforceCounts() {
  return Object.freeze({
    managers: 1,
    specialists: FIELD_SPECIALISTS.length,
    workers: FIELD_WORKERS.length,
    portfolios: FIELD_WORKFORCE_GROUPS.length,
    teams: FIELD_WORKFORCE_GROUPS.length,
  });
}
