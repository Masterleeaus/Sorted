// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-runtime/interaction-engine/deterministic-intent-classifier.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { createInteractionContext } from "./contracts.js";
import { createInteractionInterpretation } from "./interpretation.js";

export const DETERMINISTIC_CLASSIFIER_VERSION = "1.1.0";
export const DEFAULT_INTENT_THRESHOLD = 0.68;
export const DEFAULT_AMBIGUITY_MARGIN = 0.12;

const RULES = Object.freeze([
  rule("settings.list", [phrase("show me my settings", 8), phrase("show my settings", 8), phrase("list my settings", 8), phrase("open my settings", 6), phrase("what settings", 5)], "settings.list", "List current settings"),
  rule("settings.read", [phrase("what is my", 3), phrase("what's my", 3), phrase("current setting", 5), phrase("setting is", 4), word("setting", 2), word("settings", 1)], "settings.read", "Read a setting"),
  rule("settings.change", [phrase("dark mode", 8), phrase("light mode", 8), phrase("system theme", 8), phrase("turn on", 3), phrase("turn off", 3), word("enable", 4), word("disable", 4), word("setting", 2), word("settings", 1), word("theme", 3)], "settings.change", "Change a setting"),
  rule("booking.cancel", [phrase("cancel my booking", 5), phrase("cancel booking", 5), phrase("cancel appointment", 5), word("cancel", 2), word("booking", 2), word("appointment", 2)], "booking.cancel", "Cancel a booking"),
  rule("booking.reschedule", [phrase("reschedule my booking", 5), phrase("change my booking", 4), phrase("move my booking", 4), phrase("change appointment", 4), word("reschedule", 4), word("booking", 1), word("appointment", 1)], "booking.reschedule", "Reschedule a booking"),
  rule("booking.create", [phrase("book a", 4), phrase("book an", 4), phrase("make a booking", 5), phrase("schedule a", 4), phrase("schedule an", 4), word("book", 2), word("booking", 2), word("appointment", 2), word("schedule", 2)], "booking.create", "Create a booking"),
  rule("quote.request", [phrase("get a quote", 5), phrase("need a quote", 5), phrase("request a quote", 5), word("quote", 3), word("estimate", 3), word("price", 1)], "quote.create", "Prepare a quote"),
  rule("invoice.pay", [phrase("pay invoice", 5), phrase("pay my invoice", 5), phrase("make payment", 4), word("invoice", 2), word("pay", 3), word("payment", 2)], "payment.prepare", "Prepare an invoice payment"),
  rule("invoice.status", [phrase("invoice status", 5), phrase("where is my invoice", 5), phrase("invoice paid", 4), word("invoice", 3), word("status", 2), word("paid", 1)], "invoice.read", "Check invoice status"),
  rule("job.status", [phrase("job status", 5), phrase("where is the worker", 5), phrase("when will you arrive", 5), phrase("where is my job", 5), word("job", 2), word("arrival", 2), word("status", 2)], "job.read", "Check job status"),
  rule("job.complete", [phrase("complete the job", 5), phrase("finish the job", 5), phrase("mark complete", 5), word("complete", 3), word("finish", 2), word("job", 2)], "job.complete", "Complete a job"),
  rule("issue.report", [phrase("report an issue", 5), phrase("there is a problem", 4), phrase("something is wrong", 4), word("issue", 3), word("problem", 2), word("fault", 2), word("damage", 2)], "issue.report", "Report an issue"),
  rule("evidence.add", [phrase("add a photo", 5), phrase("upload a photo", 5), phrase("attach a photo", 5), phrase("add evidence", 5), word("photo", 2), word("picture", 2), word("evidence", 3)], "evidence.add", "Add evidence"),
  rule("customer.contact", [phrase("contact the customer", 5), phrase("message the customer", 5), phrase("call the customer", 5), word("customer", 2), word("message", 2), word("call", 2), word("email", 2)], "connect.message.prepare", "Prepare customer contact"),
  rule("browser.extract", [phrase("extract this page", 5), phrase("get the data from this page", 5), phrase("read this page", 4), word("extract", 3), word("scrape", 3), word("page", 1)], "browser.extract", "Extract page information"),
  rule("browser.form_fill", [phrase("fill this form", 5), phrase("enter these details", 5), phrase("complete this form", 5), word("form", 2), word("fill", 3), word("enter", 1), word("details", 1)], "browser.form.fill", "Prepare form filling"),
  rule("browser.navigate", [phrase("go to the website", 5), phrase("open the website", 5), phrase("navigate to", 5), phrase("go to", 3), word("open", 2), word("website", 2), word("page", 1)], "browser.navigate", "Navigate the browser"),
  rule("browser.research", [phrase("research this", 5), phrase("find out", 4), phrase("look up", 4), phrase("search the web", 5), word("research", 3), word("search", 2), word("compare", 1)], "browser.research", "Research information"),
  rule("document.create", [phrase("create a document", 5), phrase("make a document", 5), phrase("write a document", 5), word("document", 3), word("doc", 2)], "document.create", "Create a document"),
  rule("spreadsheet.create", [phrase("create a spreadsheet", 5), phrase("make a spreadsheet", 5), phrase("create a sheet", 4), word("spreadsheet", 4), word("sheet", 2)], "spreadsheet.create", "Create a spreadsheet"),
  rule("page.summarize", [phrase("summarize this page", 5), phrase("summarise this page", 5), phrase("summarize this", 4), phrase("summarise this", 4), word("summarize", 3), word("summarise", 3)], "browser.extract", "Summarize page content"),
]);

function rule(intent, signals, capability, goal) {
  return Object.freeze({ intent, signals: Object.freeze(signals), capability, goal });
}
function phrase(value, weight) { return Object.freeze({ kind: "phrase", value, weight }); }
function word(value, weight) { return Object.freeze({ kind: "word", value, weight }); }

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9@.$%+'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text) {
  return new Set(text.split(" ").filter(Boolean));
}

function scoreRule(ruleDef, normalized, tokens) {
  let raw = 0;
  const matched = [];
  for (const signal of ruleDef.signals) {
    const hit = signal.kind === "phrase" ? normalized.includes(signal.value) : tokens.has(signal.value);
    if (hit) {
      raw += signal.weight;
      matched.push(signal.value);
    }
  }
  // Cap raw score so a broad keyword pile cannot manufacture certainty.
  const confidence = raw <= 0 ? 0 : Math.min(0.99, 0.42 + (1 - Math.exp(-raw / 4)) * 0.57);
  return Object.freeze({ intent: ruleDef.intent, raw_score: raw, confidence, matched: Object.freeze(matched), capability: ruleDef.capability, goal: ruleDef.goal });
}

function rankCandidates(normalized) {
  const tokens = tokenSet(normalized);
  return Object.freeze(RULES.map((r) => scoreRule(r, normalized, tokens))
    .filter((r) => r.raw_score > 0)
    .sort((a, b) => b.confidence - a.confidence || b.raw_score - a.raw_score || a.intent.localeCompare(b.intent)));
}

export function classifyDeterministicIntent(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("deterministic-intent-input-object-required");
  rejectLegacyTenantAuthority(input, "deterministic-intent-input");
  const context = createInteractionContext(input.context ?? input);
  const company_id = assertCanonicalCompanyId(input.company_id ?? context.company_id);
  if (company_id !== context.company_id) throw new TypeError("deterministic-intent-company-mismatch");
  const normalized = normalizeText(input.text ?? input.message ?? input.normalized ?? input.normalized_text);
  if (!normalized) throw new TypeError("deterministic-intent-text-required");

  const threshold = Number(options.threshold ?? input.threshold ?? DEFAULT_INTENT_THRESHOLD);
  const ambiguityMargin = Number(options.ambiguity_margin ?? input.ambiguity_margin ?? DEFAULT_AMBIGUITY_MARGIN);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new TypeError("deterministic-intent-threshold-invalid");
  if (!Number.isFinite(ambiguityMargin) || ambiguityMargin < 0 || ambiguityMargin > 1) throw new TypeError("deterministic-intent-ambiguity-margin-invalid");

  const candidates = rankCandidates(normalized);
  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  const ambiguous = Boolean(best && second && best.intent !== second.intent && (best.confidence - second.confidence) < ambiguityMargin);
  const resolved = Boolean(best && best.confidence >= threshold && !ambiguous);
  const intentName = resolved ? best.intent : "unknown";
  const confidence = best?.confidence ?? 0;
  const escalationRequested = !resolved;
  const escalationReason = !best ? "no-deterministic-match" : ambiguous ? "deterministic-ambiguity" : "below-confidence-threshold";

  const ambiguities = ambiguous ? [{
    field: "intent",
    question: "Which outcome do you want?",
    blocking: true,
    options: candidates.slice(0, 3).map((c) => c.intent),
  }] : [];

  const interpretation = createInteractionInterpretation({
    company_id,
    context,
    normalized,
    intent: { name: intentName, confidence, source: "deterministic-rules" },
    goals: resolved && best.goal ? [{ description: best.goal }] : [],
    ambiguities,
    capability_requirements: resolved && best.capability ? [{ capability: best.capability, offline_preferred: true, reason: `intent:${best.intent}` }] : [],
    needs_clarification: ambiguous,
  });

  return Object.freeze({
    schema: "titan.interaction.deterministic-intent-classification.v1",
    classifier_version: DETERMINISTIC_CLASSIFIER_VERSION,
    company_id,
    normalized,
    resolved,
    intent: interpretation.intent,
    candidates: Object.freeze(candidates.slice(0, 5)),
    threshold,
    ambiguity_margin: ambiguityMargin,
    ambiguity_detected: ambiguous,
    escalation: Object.freeze({
      requested: escalationRequested,
      reason: escalationRequested ? escalationReason : null,
      preferred_order: Object.freeze(["localbrain", "on-device-model", "byo-cloud-model"]),
      classifier_invokes_model: false,
      policy_authorization_required: true,
    }),
    interpretation,
    authority_neutral: true,
    execution_authority: false,
  });
}

export function listDeterministicIntentRules() {
  return Object.freeze(RULES.map((r) => Object.freeze({ intent: r.intent, capability: r.capability, goal: r.goal })));
}
