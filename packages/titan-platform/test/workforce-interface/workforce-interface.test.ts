import {strict as assert} from "node:assert";
import {createWorkforcePresentationBridge} from "../../src/workforce-interface/index.js";
const base={company_id:"c1",agent_id:"a1",canonical_name:"Booking Specialist",position:"Specialist" as const,surface:"zero" as const,purpose:"resolve booking exception",outcome_ids:["o1"],capability_ids:["cap1"],actions:[{intent:"booking.prepare",label:"Prepare"}]};
const x=createWorkforcePresentationBridge(base);
assert.equal(x.presentation.chat_first,true);assert.equal(x.presentation.max_primary_cards,3);assert.equal(x.presentation.semantic_component,"specialist_analysis");
assert.equal(x.presentation.creates_identity,false);assert.equal(x.presentation.authority_granted,false);assert.equal(x.interaction.authority_effect,false);
