// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-onboarding/runtime/onboarding-journey-state.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from '../../titan-runtime/boundary.js';

export const ONBOARDING_JOURNEY_ID = 'owner-business-setup';
export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({ id: 'business_identity', required: true }),
  Object.freeze({ id: 'operations', required: true }),
  Object.freeze({ id: 'cleaning_services', required: true }),
  Object.freeze({ id: 'workforce', required: true }),
  Object.freeze({ id: 'payments_communications', required: false }),
  Object.freeze({ id: 'import_data', required: false }),
  Object.freeze({ id: 'readiness', required: true }),
]);
export const ONBOARDING_STATUSES = Object.freeze(['not_started', 'in_progress', 'completed']);

const STEP_IDS = new Set(ONBOARDING_STEPS.map((step) => step.id));
const REQUIRED_STEP_IDS = ONBOARDING_STEPS.filter((step) => step.required).map((step) => step.id);
const clone = (value) => value == null ? value : globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function assertStorage(storage) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    throw new TypeError('onboarding storage must provide async get() and set()');
  }
  return storage;
}

function canonicalContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('onboarding context must be an object');
  rejectLegacyTenantAuthority(input, 'onboarding');
  return Object.freeze({ company_id: assertCanonicalCompanyId(input.company_id) });
}

function storageKey(companyId) {
  return `tz.onboarding.company.${encodeURIComponent(companyId)}.${ONBOARDING_JOURNEY_ID}`;
}

function assertStep(stepId) {
  const value = String(stepId ?? '').trim();
  if (!STEP_IDS.has(value)) throw new TypeError(`unsupported onboarding step: ${value || '<empty>'}`);
  return value;
}

function defaultState(companyId) {
  return Object.freeze({
    schema: 'titan-zero-onboarding-journey-state/v1',
    journey_id: ONBOARDING_JOURNEY_ID,
    company_id: companyId,
    status: 'not_started',
    current_step: ONBOARDING_STEPS[0].id,
    completed_steps: [],
    skipped_optional_steps: [],
    revision: 0,
    started_at: null,
    updated_at: null,
    completed_at: null,
    grants_authority: false,
  });
}

function normalizeStoredState(raw, companyId) {
  if (!raw) return defaultState(companyId);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('stored onboarding state must be an object');
  rejectLegacyTenantAuthority(raw, 'stored_onboarding_state');
  if (assertCanonicalCompanyId(raw.company_id) !== companyId) throw new TypeError('stored onboarding state company_id mismatch');
  if (raw.journey_id !== ONBOARDING_JOURNEY_ID) throw new TypeError('stored onboarding journey_id mismatch');
  if (!ONBOARDING_STATUSES.includes(raw.status)) throw new TypeError('stored onboarding status is invalid');
  const completed = [...new Set((raw.completed_steps || []).map(assertStep))];
  const skipped = [...new Set((raw.skipped_optional_steps || []).map(assertStep))];
  for (const stepId of skipped) {
    const descriptor = ONBOARDING_STEPS.find((step) => step.id === stepId);
    if (descriptor?.required) throw new TypeError(`required onboarding step cannot be skipped: ${stepId}`);
  }
  if (!Number.isInteger(raw.revision) || raw.revision < 0) throw new TypeError('stored onboarding revision is invalid');
  return Object.freeze({
    schema: 'titan-zero-onboarding-journey-state/v1',
    journey_id: ONBOARDING_JOURNEY_ID,
    company_id: companyId,
    status: raw.status,
    current_step: raw.current_step == null ? null : assertStep(raw.current_step),
    completed_steps: completed,
    skipped_optional_steps: skipped,
    revision: raw.revision,
    started_at: raw.started_at ?? null,
    updated_at: raw.updated_at ?? null,
    completed_at: raw.completed_at ?? null,
    grants_authority: false,
  });
}

function nextIncompleteStep(state) {
  const completed = new Set(state.completed_steps);
  const skipped = new Set(state.skipped_optional_steps);
  return ONBOARDING_STEPS.find((step) => !completed.has(step.id) && !skipped.has(step.id))?.id ?? null;
}

function requiredComplete(state) {
  const completed = new Set(state.completed_steps);
  return REQUIRED_STEP_IDS.every((stepId) => completed.has(stepId));
}

export function createOnboardingJourneyStore({ storage, clock = () => Date.now() } = {}) {
  const persistence = assertStorage(storage);
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  async function load(contextInput) {
    const context = canonicalContext(contextInput);
    const key = storageKey(context.company_id);
    const result = await persistence.get(key);
    return normalizeStoredState(result?.[key], context.company_id);
  }

  async function write(context, prior, patch, { expected_revision = prior.revision } = {}) {
    if (!Number.isInteger(expected_revision) || expected_revision < 0) throw new TypeError('expected_revision must be a non-negative integer');
    if (expected_revision !== prior.revision) throw new Error('onboarding_revision_conflict');
    const now = Number(clock());
    const next = normalizeStoredState({
      ...clone(prior),
      ...clone(patch),
      company_id: context.company_id,
      journey_id: ONBOARDING_JOURNEY_ID,
      revision: prior.revision + 1,
      updated_at: now,
      grants_authority: false,
    }, context.company_id);
    await persistence.set({ [storageKey(context.company_id)]: next });
    return next;
  }

  return Object.freeze({
    kind: 'titan-onboarding-journey-store',
    company_boundary: 'company_id',
    grants_authority: false,
    async load(contextInput) {
      return load(contextInput);
    },
    async start(contextInput, options = {}) {
      const context = canonicalContext(contextInput);
      const prior = await load(context);
      if (prior.status !== 'not_started') return prior;
      const now = Number(clock());
      return write(context, prior, { status: 'in_progress', started_at: now, current_step: nextIncompleteStep(prior) }, options);
    },
    async setCurrentStep(contextInput, stepId, options = {}) {
      const context = canonicalContext(contextInput);
      const prior = await load(context);
      if (prior.status === 'completed') throw new Error('onboarding_already_completed');
      return write(context, prior, { status: 'in_progress', current_step: assertStep(stepId), started_at: prior.started_at ?? Number(clock()) }, options);
    },
    async completeStep(contextInput, stepId, options = {}) {
      const context = canonicalContext(contextInput);
      const prior = await load(context);
      if (prior.status === 'completed') return prior;
      const step = assertStep(stepId);
      const completed = [...new Set([...prior.completed_steps, step])];
      const skipped = prior.skipped_optional_steps.filter((id) => id !== step);
      const interim = { ...prior, completed_steps: completed, skipped_optional_steps: skipped };
      return write(context, prior, {
        status: 'in_progress',
        started_at: prior.started_at ?? Number(clock()),
        completed_steps: completed,
        skipped_optional_steps: skipped,
        current_step: nextIncompleteStep(interim),
      }, options);
    },
    async skipOptionalStep(contextInput, stepId, options = {}) {
      const context = canonicalContext(contextInput);
      const prior = await load(context);
      const step = assertStep(stepId);
      const descriptor = ONBOARDING_STEPS.find((candidate) => candidate.id === step);
      if (descriptor.required) throw new Error('required_onboarding_step_cannot_be_skipped');
      const skipped = [...new Set([...prior.skipped_optional_steps, step])];
      const interim = { ...prior, skipped_optional_steps: skipped };
      return write(context, prior, {
        status: 'in_progress',
        started_at: prior.started_at ?? Number(clock()),
        skipped_optional_steps: skipped,
        current_step: nextIncompleteStep(interim),
      }, options);
    },
    async completeJourney(contextInput, options = {}) {
      const context = canonicalContext(contextInput);
      const prior = await load(context);
      if (prior.status === 'completed') return prior;
      if (!requiredComplete(prior)) throw new Error('required_onboarding_steps_incomplete');
      const now = Number(clock());
      return write(context, prior, { status: 'completed', current_step: null, completed_at: now }, options);
    },
  });
}
