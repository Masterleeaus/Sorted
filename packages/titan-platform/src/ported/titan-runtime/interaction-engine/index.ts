// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interaction-engine/index.mjs
export { reasonWithLocalBrain, LOCALBRAIN_VERSION, DEFAULT_LOCALBRAIN_MIN_CONFIDENCE } from "./localbrain.js";
import { freezeEnvelope } from "../boundary.js";
export { CANONICAL_SURFACES, INTERACTION_SCHEMA_VERSION, canonicalSurface, createInteractionContext, createEntity, createGoal, createCapabilityRequirement, createAmbiguity } from "./contracts.js";
export { createInteractionInterpretation, interpretationRequiresDecision } from "./interpretation.js";
export { classifyDeterministicIntent, listDeterministicIntentRules, DETERMINISTIC_CLASSIFIER_VERSION, DEFAULT_INTENT_THRESHOLD, DEFAULT_AMBIGUITY_MARGIN } from "./deterministic-intent-classifier.js";
export { createInteractionPresentationIntent } from "./presentation-intent.js";
export { createConversationState, createJourneyState } from "./state.js";
export { createConversationStateRuntime, CONVERSATION_STATE_RUNTIME_SCHEMA, CONVERSATION_STATE_MODULE_ID, CONVERSATION_STATE_COLLECTIONS } from "./conversation-state-runtime.js";
export { createZeroInteraction, ZERO_INTERACTION_SCHEMA } from "./zero-interaction.js";
export { zeroChatEventFromRuntime, ZERO_RUNTIME_EVENT_SCHEMA } from "./zero-runtime-events.js";
export { createZeroAuthorityRequest, dispatchZeroAuthorityRequest, assertZeroOfflineExecutionBoundary, ZERO_AUTHORITY_BRIDGE_SCHEMA } from "./zero-authority-bridge.js";
export const RUNTIME_ID = "interaction-engine";
export const RUNTIME_NAME = "Interaction Engine";
export const RUNTIME_KIND = "intent";
export const RUNTIME_PURPOSE = "Owns understanding, conversation, journeys, wizards and PresentationIntent; never grants execution authority.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;
export function createInteractionEngineEnvelope(input) { const envelope = freezeEnvelope(input); return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_conferred_by_activation: false }); }
export const runtimeDescriptor = Object.freeze({ id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE, authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION });
export { createJourneyRuntime, createJourneyDefinition, JOURNEY_RUNTIME_SCHEMA, JOURNEY_DEFINITION_SCHEMA, JOURNEY_INSTANCE_SCHEMA, JOURNEY_COLLECTION, JOURNEY_MODULE_ID } from './journey-runtime.js';
export { createWizardRuntime, createWizardDefinition, WIZARD_RUNTIME_SCHEMA, WIZARD_DEFINITION_SCHEMA, WIZARD_SESSION_SCHEMA, WIZARD_COLLECTION, WIZARD_MODULE_ID } from './wizard-runtime.js';
export { validatePresentationMetadata } from './presentation-guard.js';
export { presentWizardSession } from './generated-ui-presenter.js';
export { renderWizardConversational, renderWizardStructured, renderWizardHybrid } from './wizard-renderers.js';
export { assertGovernedWizardCompletion, mapWizardCompletionToCommand } from './governed-completion.js';
export { createVectorClock, tickVectorClock, mergeVectorClocks, compareVectorClocks, resolveCausalInteractionState, createBehavioralMemory } from './local-intelligence.js';
export { createTemporalIntelligence, createPredictiveCompletion, createAdaptiveReweighting } from './adaptive-intelligence.js';
export { routeInteractionCapability, createGovernedCapabilityIntent, dispatchGovernedCapabilityIntent } from './capability-intent-bridge.js';
export { createInteractionOfflineCommandBridge } from './offline-command-bridge.js';
export { createInteractionTemplateDefinition, createInteractionTemplateRuntime, INTERACTION_TEMPLATE_SCHEMA, INTERACTION_TEMPLATE_RUNTIME_SCHEMA } from './template-runtime.js';
export { createQuestionResolver } from './question-resolver.js';
export { createInteractionEventBridge } from './interaction-event-bridge.js';
export { assertInteractionSecurityBoundary, assertInteractionReplayBoundary, assertInteractionPresentationBoundary, assertInteractionSurfaceTransition } from './security-boundary-hardening.js';
