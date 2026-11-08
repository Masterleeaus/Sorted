// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/registry.mjs
import { runtimeDescriptor as core } from "./core/index.js";
import { runtimeDescriptor as interaction_engine } from "./interaction-engine/index.js";
import { runtimeDescriptor as decision_engine } from "./decision-engine/index.js";
import { runtimeDescriptor as prime } from "./prime/index.js";
import { runtimeDescriptor as authority } from "./authority/index.js";
import { runtimeDescriptor as safety } from "./safety/index.js";
import { runtimeDescriptor as execution } from "./execution/index.js";
import { runtimeDescriptor as knowledge } from "./knowledge/index.js";
import { runtimeDescriptor as outcome } from "./outcome/index.js";
import { runtimeDescriptor as interface_runtime } from "./interface-runtime/index.js";
import { runtimeDescriptor as visual_runtime } from "./visual-runtime/index.js";

export const runtimeDescriptors = Object.freeze([core, interaction_engine, decision_engine, prime, authority, safety, execution, knowledge, outcome, interface_runtime, visual_runtime]);
export const runtimeById = Object.freeze(Object.fromEntries(runtimeDescriptors.map((d) => [d.id, d])));
export function getRuntimeDescriptor(id) { return runtimeById[id] ?? null; }
