// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/lens-assignment.mjs
export const CANONICAL_LENSES = Object.freeze([
  'meaning-context',
  'provenance-reality',
  'temporal',
  'relational',
  'consequence',
  'anomaly'
]);

export const LENS_TEAM_ROUTES = Object.freeze({
  'meaning-context': Object.freeze({ team: 'A', analysis_lens: 'meaning-context' }),
  'provenance-reality': Object.freeze({ team: 'B', analysis_lens: 'provenance-reality' }),
  temporal: Object.freeze({ team: 'A', analysis_lens: 'temporal-causal' }),
  relational: Object.freeze({ team: 'B', analysis_lens: 'relational-consistency' }),
  consequence: Object.freeze({ team: 'A', analysis_lens: 'consequence-state-transition' }),
  anomaly: Object.freeze({ team: 'B', analysis_lens: 'anomaly-signature' })
});

const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, exceptional: 3 });

function str(value, code) {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw new Error(code);
  return text;
}
function bool(value) { return value === true; }
function count(value) { return Array.isArray(value) ? value.length : Number(value || 0); }
function uniq(items) { return [...new Set(items)]; }
function riskLevel(input) {
  const value = String(input?.risk_assessment?.level || input?.risk_level || 'low').trim().toLowerCase();
  if (!(value in RISK_ORDER)) throw new Error('lens-assignment-risk-level-invalid');
  return value;
}
function contamination(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value)) {
    const k = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['teama','teamb','teamc','teamaanlysis','teambanalysis','teamcanalysis','conclusions','interpretation','comparison','convergence','divergence'].includes(k)) return true;
    if (contamination(nested)) return true;
  }
  return false;
}
function addReason(map, lens, reason) {
  const current = map.get(lens) || [];
  if (!current.includes(reason)) current.push(reason);
  map.set(lens, current);
}
function hasAny(flags, names) { return names.some(name => bool(flags?.[name])); }

export function assignIntelligenceLenses(input = {}) {
  if (contamination(input.team_outputs) || contamination(input.prior_analysis) || contamination(input.analysis_context)) {
    throw new Error('lens-assignment-analysis-contaminated');
  }
  const company_id = str(input.company_id, 'lens-assignment-company-id-required');
  const item_id = input.item_id == null ? null : String(input.item_id);
  const revision_id = input.revision_id == null ? null : String(input.revision_id);
  const level = riskLevel(input);
  const flags = input.characteristics || input.flags || {};
  const reasons = new Map();

  addReason(reasons, 'meaning-context', 'baseline-event-meaning-required');

  if (hasAny(flags, ['external_source','source_uncertain','authenticity_uncertain','identity_claim','imported_data','cross_system']) || count(input.sources) > 1) {
    addReason(reasons, 'provenance-reality', 'origin-or-authenticity-requires-independent-check');
  }
  if (hasAny(flags, ['has_timestamp','sequence_sensitive','deadline_sensitive','stale_possible','revision_sensitive','causal_order_matters']) || count(input.timeline) > 0) {
    addReason(reasons, 'temporal', 'time-order-or-causality-material');
  }
  if (hasAny(flags, ['cross_domain','relationship_change','reference_integrity','dependency_change','multi_entity','graph_relevant']) || count(input.related_entities) > 0) {
    addReason(reasons, 'relational', 'relationships-or-cross-domain-consistency-material');
  }
  if (hasAny(flags, ['state_change','financial_effect','safety_effect','legal_effect','privacy_effect','destructive_change','irreversible_change','downstream_effect']) || count(input.expected_effects) > 0) {
    addReason(reasons, 'consequence', 'downstream-state-or-impact-material');
  }
  if (hasAny(flags, ['unexpected','outlier','signature_shift','conflict','duplicate_suspected','tamper_suspected','pattern_break','novel_behavior']) || count(input.anomaly_signals) > 0) {
    addReason(reasons, 'anomaly', 'anomaly-or-signature-deviation-present');
  }

  if (RISK_ORDER[level] >= RISK_ORDER.medium) {
    addReason(reasons, 'provenance-reality', `risk-${level}-requires-origin-check`);
    addReason(reasons, 'consequence', `risk-${level}-requires-impact-check`);
  }
  if (RISK_ORDER[level] >= RISK_ORDER.high) {
    addReason(reasons, 'temporal', `risk-${level}-requires-sequence-check`);
    addReason(reasons, 'relational', `risk-${level}-requires-relationship-check`);
    addReason(reasons, 'anomaly', `risk-${level}-requires-anomaly-check`);
  }
  if (level === 'exceptional') {
    for (const lens of CANONICAL_LENSES) addReason(reasons, lens, 'exceptional-risk-full-lens-coverage');
  }

  for (const lens of uniq(input.required_lenses || [])) {
    if (!CANONICAL_LENSES.includes(lens)) throw new Error(`lens-assignment-required-lens-invalid:${lens}`);
    addReason(reasons, lens, 'explicit-structured-requirement');
  }

  const selected = CANONICAL_LENSES.filter(lens => reasons.has(lens)).map((lens, index) => Object.freeze({
    lens,
    priority: index + 1,
    reasons: Object.freeze([...reasons.get(lens)]),
    route: LENS_TEAM_ROUTES[lens]
  }));
  const omitted = CANONICAL_LENSES.filter(lens => !reasons.has(lens));
  const team_a = selected.filter(x => x.route.team === 'A').map(x => Object.freeze({ canonical_lens: x.lens, analysis_lens: x.route.analysis_lens }));
  const team_b = selected.filter(x => x.route.team === 'B').map(x => Object.freeze({ canonical_lens: x.lens, analysis_lens: x.route.analysis_lens }));

  return Object.freeze({
    schema_version: 1,
    company_id,
    item_id,
    revision_id,
    risk_level: level,
    deterministic: true,
    model_used: false,
    pre_analysis: true,
    conclusions_consumed: false,
    canonical_lenses: CANONICAL_LENSES,
    selected: Object.freeze(selected),
    omitted: Object.freeze(omitted),
    team_routes: Object.freeze({ A: Object.freeze(team_a), B: Object.freeze(team_b) }),
    assigned_at: Number(input.assigned_at || Date.now())
  });
}

export function validateLensAssignment(assignment) {
  if (!assignment || assignment.pre_analysis !== true || assignment.conclusions_consumed !== false) return false;
  if (!assignment.company_id || !Array.isArray(assignment.selected)) return false;
  const seen = new Set();
  for (const entry of assignment.selected) {
    if (!CANONICAL_LENSES.includes(entry?.lens) || seen.has(entry.lens)) return false;
    if (entry?.route?.team !== LENS_TEAM_ROUTES[entry.lens].team) return false;
    if (entry?.route?.analysis_lens !== LENS_TEAM_ROUTES[entry.lens].analysis_lens) return false;
    seen.add(entry.lens);
  }
  return true;
}
