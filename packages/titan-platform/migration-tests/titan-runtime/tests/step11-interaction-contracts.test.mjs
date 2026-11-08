import assert from "node:assert/strict";
import { createInteractionContext, createInteractionInterpretation, createInteractionPresentationIntent, createConversationState, createJourneyState, canonicalSurface } from "../interaction-engine/index.mjs";

const context = createInteractionContext({ company_id:"company-a", surface:"owner", actor_id:"u1", operation_id:"op1", request_id:"req1", conversation_id:"conv1" });
assert.equal(context.surface,"zero"); assert.equal(context.company_id,"company-a"); assert.equal(context.authority_neutral,true);
assert.throws(()=>createInteractionContext({tenant_id:"company-a",surface:"zero"}),/legacy tenant authority field|company_id/i);
assert.equal(canonicalSurface("worker"),"go"); assert.equal(canonicalSurface("customer"),"hub");

const packet=createInteractionInterpretation({company_id:"company-a",context,intent:{name:"book_service",confidence:0.91},normalized:"book a cleaner tomorrow",goals:[{description:"Book service"}],entities:[{name:"date",type:"relative_date",value:"tomorrow",confidence:0.9}],preferences:{time:"morning"},ambiguities:[{field:"address",question:"Which address?",blocking:true}],capability_requirements:[{capability:"booking.create",operation:"prepare",offline_preferred:true}]});
assert.equal(packet.intent.name,"book_service"); assert.equal(packet.needs_clarification,true); assert.equal(packet.execution_authority,false); assert.equal(packet.capability_requirements[0].capability,"booking.create");

const pi=createInteractionPresentationIntent({presentation_id:"p1",company_id:"company-a",surface:"zero",purpose:"clarify booking",semantic_components:["question"],data_requirements:["address"],actions:[{intent:"booking.address.answer"}]});
assert.equal(pi.payload.schema,"titan.apps.presentation-intent.v1"); assert.equal(pi.authority_neutral,true); assert.equal(pi.execution_authority,false); assert.equal(pi.actions[0].governed_intent,true); assert.throws(()=>createInteractionPresentationIntent({presentation_id:"p2",company_id:"company-a",surface:"zero",purpose:"bad",actions:[{intent:"x",execute:true}]}),/cannot-directly-execute/);

const cs=createConversationState({company_id:"company-a",surface:"zero",conversation_id:"conv1",turn:2,last_intent:"book_service"}); assert.equal(cs.turn,2);
const js=createJourneyState({company_id:"company-a",surface:"go",journey_id:"job-completion",wizards:["before","complete"]}); assert.equal(js.wizard_ids.length,2);
assert.throws(()=>createJourneyState({company_id:"company-a",tenant_company_id:"company-a",surface:"go",journey_id:"x"}),/authority boundary|company_id/i);
console.log("Step 11 interaction contract tests PASS");
