import { createHash } from 'node:crypto';

const SCHEMA = 'titan.workforce.starter.invoicing.payment-monitoring.v1';
const RECONCILIATION_SCHEMA = 'titan.workforce.starter.invoicing.payment-reconciliation-proposal.v1';
const REMINDER_SCHEMA = 'titan.workforce.starter.invoicing.payment-reminder-proposal.v1';
const VALID_RECONCILIATION_CAPABILITIES = new Set(['finance.payment.reconcile']);
const VALID_REMINDER_CAPABILITIES = new Set(['crm.invoice.reminder.send', 'governed.communication.send']);
const CLOSED_INVOICE_STATES = new Set(['paid', 'void', 'voided', 'cancelled', 'canceled']);

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }
function clean(v) { return nonEmpty(v) ? v.trim() : null; }
function requireCompany(v) { if (!nonEmpty(v)) throw new TypeError('company_id is required'); return v.trim(); }
function requireIntegerString(v, label) {
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) throw new TypeError(`${label}_must_be_integer_minor_units_string`);
  return BigInt(v);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}
function digest(v) { return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex'); }
function authorityEnvelope() {
  return {
    company_boundary: 'company_id', identity_grants_authority: false, authority_granted: false,
    grants_authority: false, execution_permitted: false, canonical_payment_mutation_permitted: false,
    direct_provider_action_permitted: false, collections_authority: false, command_bus_required_for_effects: true
  };
}
function verifiedTool(tool, allowed, label) {
  if (!tool || tool.verified !== true) throw new Error(`${label}_tool_not_verified`);
  if (!nonEmpty(tool.capability) || !allowed.has(tool.capability.trim())) throw new Error(`${label}_capability_not_allowed`);
  if (!nonEmpty(tool.provider_ref)) throw new Error(`${label}_provider_ref_required`);
  if (tool.command_bus_required !== true) throw new Error(`${label}_command_bus_required`);
  return { capability: tool.capability.trim(), provider_ref: tool.provider_ref.trim(), verified: true, command_bus_required: true };
}
function dayDiff(dueAt, asOf) {
  const due = new Date(dueAt); const now = new Date(asOf);
  if (Number.isNaN(due.valueOf()) || Number.isNaN(now.valueOf())) return null;
  return Math.floor((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()) - Date.UTC(due.getUTCFullYear(),due.getUTCMonth(),due.getUTCDate())) / 86400000);
}

export function projectPaymentMonitoring({ company_id, invoice = {}, payments = [], as_of = new Date().toISOString() } = {}) {
  const company = requireCompany(company_id);
  if (invoice.company_id && invoice.company_id !== company) throw new Error('company_boundary_mismatch:invoice');
  if (!nonEmpty(invoice.invoice_ref)) throw new Error('invoice_ref_required');
  if (!nonEmpty(invoice.currency)) throw new Error('currency_required');
  const invoiceTotal = requireIntegerString(invoice.total_minor, 'invoice_total_minor');
  if (invoiceTotal < 0n) throw new Error('invoice_total_cannot_be_negative');
  const status = clean(invoice.status)?.toLowerCase() || 'unknown';
  let verifiedPaid = 0n;
  const paymentRefs = [];
  const blockers = [];
  for (const payment of payments || []) {
    if (!payment || payment.verified !== true) { blockers.push('unverified_payment_record'); continue; }
    if (payment.company_id && payment.company_id !== company) throw new Error('company_boundary_mismatch:payment');
    if (!nonEmpty(payment.payment_ref)) { blockers.push('payment_ref_missing'); continue; }
    if (payment.currency !== invoice.currency) { blockers.push('payment_currency_mismatch'); continue; }
    const amount = requireIntegerString(payment.amount_minor, 'payment_amount_minor');
    if (amount < 0n) { blockers.push('negative_payment_not_reconciled'); continue; }
    if (!['settled','cleared','posted','received'].includes(clean(payment.status)?.toLowerCase())) { blockers.push('payment_not_settled'); continue; }
    verifiedPaid += amount;
    paymentRefs.push(payment.payment_ref.trim());
  }
  const balance = invoiceTotal - verifiedPaid;
  const daysOverdue = nonEmpty(invoice.due_at) ? dayDiff(invoice.due_at, as_of) : null;
  const overdue = !CLOSED_INVOICE_STATES.has(status) && balance > 0n && daysOverdue !== null && daysOverdue > 0;
  let paymentState = 'unpaid';
  if (verifiedPaid === 0n) paymentState = 'unpaid';
  else if (balance > 0n) paymentState = 'partial';
  else if (balance === 0n) paymentState = 'paid';
  else paymentState = 'overpaid';
  return {
    schema: SCHEMA,
    company_id: company,
    worker: 'Invoicing Agent',
    invoice: { invoice_ref: invoice.invoice_ref.trim(), status, currency: invoice.currency, due_at: clean(invoice.due_at), system_of_record: 'Titan CRM' },
    observed: {
      invoice_total_minor: invoiceTotal.toString(), verified_paid_minor: verifiedPaid.toString(), balance_due_minor: balance.toString(),
      payment_state: paymentState, verified_payment_refs: paymentRefs, overdue, days_overdue: daysOverdue
    },
    blockers: [...new Set(blockers)],
    source_of_truth: { invoice: 'Titan CRM revenue document authority', payments: 'Titan CRM / owning payment provider', projection_only: true },
    collections: { owned_by_worker: false, escalation_permitted: false, handoff_required: true },
    evaluated_at: as_of,
    authority: authorityEnvelope()
  };
}

export function buildPaymentReconciliationProposal({ company_id, monitoring, unmatched_payment = {}, tool = {} } = {}) {
  const company = requireCompany(company_id);
  if (!monitoring || monitoring.schema !== SCHEMA) throw new TypeError('valid payment monitoring projection required');
  if (monitoring.company_id !== company) throw new Error('company_boundary_mismatch:monitoring');
  const binding = verifiedTool(tool, VALID_RECONCILIATION_CAPABILITIES, 'reconciliation');
  if (!unmatched_payment || unmatched_payment.verified !== true) throw new Error('verified_unmatched_payment_required');
  if (unmatched_payment.company_id && unmatched_payment.company_id !== company) throw new Error('company_boundary_mismatch:unmatched_payment');
  if (!nonEmpty(unmatched_payment.payment_ref)) throw new Error('payment_ref_required');
  if (unmatched_payment.currency !== monitoring.invoice.currency) throw new Error('payment_currency_mismatch');
  const amount = requireIntegerString(unmatched_payment.amount_minor, 'payment_amount_minor');
  if (amount <= 0n) throw new Error('payment_amount_must_be_positive');
  const identity = { company_id: company, invoice_ref: monitoring.invoice.invoice_ref, payment_ref: unmatched_payment.payment_ref.trim(), amount_minor: amount.toString(), currency: unmatched_payment.currency };
  const hash = digest(identity);
  return {
    schema: RECONCILIATION_SCHEMA,
    company_id: company,
    invoice_ref: monitoring.invoice.invoice_ref,
    payment_ref: unmatched_payment.payment_ref.trim(),
    amount_minor: amount.toString(), currency: unmatched_payment.currency,
    capability: binding.capability, provider_ref: binding.provider_ref,
    operation_id: `payment-reconcile:${hash.slice(0,32)}`,
    idempotency_key: `tz:${company}:payment-reconcile:${hash}`,
    governance: { user_only_workflow_observed: true, command_bus_required: true, proposal_only: true },
    authority: authorityEnvelope()
  };
}

export function buildPaymentReminderProposal({ company_id, monitoring, recipient = {}, tool = {}, prior_reminders = [], cadence = {} } = {}) {
  const company = requireCompany(company_id);
  if (!monitoring || monitoring.schema !== SCHEMA) throw new TypeError('valid payment monitoring projection required');
  if (monitoring.company_id !== company) throw new Error('company_boundary_mismatch:monitoring');
  const binding = verifiedTool(tool, VALID_REMINDER_CAPABILITIES, 'reminder');
  const invoiceStatus = monitoring.invoice.status;
  if (CLOSED_INVOICE_STATES.has(invoiceStatus)) throw new Error('closed_invoice_reminder_blocked');
  if (monitoring.observed.payment_state === 'paid' || monitoring.observed.balance_due_minor === '0') throw new Error('paid_invoice_reminder_blocked');
  if (monitoring.observed.overdue !== true) throw new Error('invoice_not_overdue');
  if (monitoring.blockers?.length) throw new Error('payment_state_unresolved');
  if (!nonEmpty(recipient.recipient_ref) || recipient.safely_resolved !== true) throw new Error('safely_resolved_recipient_required');
  if (!nonEmpty(recipient.channel)) throw new Error('recipient_channel_required');
  if (recipient.suppressed === true || recipient.consent_denied === true) throw new Error('recipient_not_contactable');
  const minDays = Number.isInteger(cadence.minimum_days_between_reminders) && cadence.minimum_days_between_reminders >= 0 ? cadence.minimum_days_between_reminders : 3;
  const asOf = new Date(monitoring.evaluated_at);
  for (const prior of prior_reminders || []) {
    if (!prior || prior.company_id !== company || prior.invoice_ref !== monitoring.invoice.invoice_ref) continue;
    if (!['accepted','sent','delivered'].includes(prior.status)) continue;
    if (!nonEmpty(prior.occurred_at)) continue;
    const then = new Date(prior.occurred_at);
    if (!Number.isNaN(then.valueOf()) && !Number.isNaN(asOf.valueOf())) {
      const elapsed = Math.floor((asOf - then) / 86400000);
      if (elapsed < minDays) throw new Error('reminder_cadence_not_elapsed');
    }
  }
  const identity = {
    company_id: company, invoice_ref: monitoring.invoice.invoice_ref, balance_due_minor: monitoring.observed.balance_due_minor,
    currency: monitoring.invoice.currency, recipient_ref: recipient.recipient_ref.trim(), channel: recipient.channel.trim(),
    days_overdue: monitoring.observed.days_overdue, cadence_days: minDays
  };
  const hash = digest(identity);
  return {
    schema: REMINDER_SCHEMA,
    company_id: company,
    invoice_ref: monitoring.invoice.invoice_ref,
    balance_due_minor: monitoring.observed.balance_due_minor,
    currency: monitoring.invoice.currency,
    days_overdue: monitoring.observed.days_overdue,
    recipient: { recipient_ref: recipient.recipient_ref.trim(), channel: recipient.channel.trim(), safely_resolved: true },
    capability: binding.capability, provider_ref: binding.provider_ref,
    operation_id: `invoice-reminder:${hash.slice(0,32)}`,
    idempotency_key: `tz:${company}:invoice-reminder:${hash}`,
    cadence: { minimum_days_between_reminders: minDays },
    collections: { escalation_included: false, threats_or_penalties_included: false, payment_plan_commitment_included: false, handoff_required_for_collections: true },
    governance: { command_bus_required: true, proposal_only: true, normalized_provider_receipt_required: true },
    authority: authorityEnvelope()
  };
}

export function buildCollectionsHandoff(monitoring, { reason = 'overdue_balance_requires_separate_collections_policy' } = {}) {
  if (!monitoring || monitoring.schema !== SCHEMA) throw new TypeError('valid payment monitoring projection required');
  return {
    schema: 'titan.workforce.starter.invoicing.collections-handoff.v1',
    company_id: monitoring.company_id,
    invoice_ref: monitoring.invoice.invoice_ref,
    balance_due_minor: monitoring.observed.balance_due_minor,
    currency: monitoring.invoice.currency,
    reason,
    target_role: 'Collections / Accounts Receivable authority',
    worker_can_collect: false,
    worker_can_commit_payment_plan: false,
    worker_can_add_penalty_or_late_fee: false,
    authority: authorityEnvelope()
  };
}

export { SCHEMA as PAYMENT_MONITORING_SCHEMA, RECONCILIATION_SCHEMA as PAYMENT_RECONCILIATION_PROPOSAL_SCHEMA, REMINDER_SCHEMA as PAYMENT_REMINDER_PROPOSAL_SCHEMA };
