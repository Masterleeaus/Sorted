import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDispatchActionIntent,toGovernedDispatchSubmission,summarizeDispatchActionIntent} from '../titan-workforce/dispatch/dispatch-action-runtime.mjs';
const rec={schema:'titan.workforce.dispatch.recommendation.v1',dispatch_recommendation_id:'dr-1',company_id:'co-a',work_item_id:'job-1',state:'RECOMMENDED',selected_candidate:{worker_id:'w-2'}};
const job={company_id:'co-a',work_item_id:'job-1',state:'ready'};
const authority={company_id:'co-a',worker:{worker_id:'human-manager'},permissions:['business.dispatch.assign'],entitlements:['workforce'],policy_allows:true,governance_allows:true,assurance_allows:true,requirement:{minimum_autonomy_score:0},approval:{company_id:'co-a',status:'approved',approver_id:'human-manager',approval_scope:'placeholder'}};
test('manual assign stays pending until explicit confirmation and never mutates directly',()=>{
 const pending=buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:job,recommendation:rec});
 assert.equal(pending.state,'AWAITING_CONFIRMATION');assert.equal(pending.workcore_action_key,'workcore.dispatch.assign');assert.equal(pending.required_permission,'business.dispatch.assign');assert.equal(pending.direct_mutation,false);assert.equal(pending.execution_permitted,false);assert.equal(pending.grants_authority,false);
 assert.throws(()=>toGovernedDispatchSubmission(pending,{actor_id:'human-manager',authority_context:authority}),/confirmation-required/);
});
test('confirmed manual assign emits governed WorkCore submission rather than a database mutation',()=>{
 const intent=buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:job,recommendation:rec,confirmed:true,confirmation_refs:['confirm-1']});
 const sub=toGovernedDispatchSubmission(intent,{actor_id:'human-manager',authority_context:authority,evidence_refs:['dr-1']});
 assert.equal(sub.capability,'workcore.dispatch.assign');assert.deepEqual(sub.payload,{work_item_id:'job-1',worker_id:'w-2'});assert.equal(sub.proposal_lifecycle.state,'approved');assert.deepEqual(sub.proposal_lifecycle.approval_refs,['confirm-1']);assert.equal(sub.authority_context.requirement.effect,'write');assert.deepEqual(sub.authority_context.requirement.required_permissions,['business.dispatch.assign']);assert.equal(sub.requires_fresh_authority_evaluation,true);assert.equal(sub.requires_authoritative_receipt,true);assert.equal(sub.direct_mutation,false);
});
test('reassignment requires an existing assignment and produces canonical reassign action',()=>{
 const existing={company_id:'co-a',assignment_id:'as-1',work_item_id:'job-1',worker_id:'w-1',state:'assigned'};
 const intent=buildDispatchActionIntent({company_id:'co-a',action:'REASSIGN',work_item:job,assignment:existing,target_worker_id:'w-2',confirmed:true,confirmation_refs:['confirm-2']});
 assert.equal(intent.current_worker_id,'w-1');assert.equal(intent.assignment_id,'as-1');assert.equal(intent.workcore_action_key,'workcore.dispatch.reassign');assert.equal(intent.required_permission,'business.dispatch.reassign');
 const sub=toGovernedDispatchSubmission(intent,{actor_id:'human-manager',authority_context:{...authority,permissions:['business.dispatch.reassign']}});
 assert.deepEqual(sub.payload,{assignment_id:'as-1',work_item_id:'job-1',worker_id:'w-2',previous_worker_id:'w-1'});assert.equal(sub.capability,'workcore.dispatch.reassign');assert.equal(summarizeDispatchActionIntent(intent).execution_permitted,false);
});
test('assign cannot overwrite an active assignment and reassign cannot invent one',()=>{
 const existing={company_id:'co-a',assignment_id:'as-1',work_item_id:'job-1',worker_id:'w-1',state:'assigned'};
 assert.throws(()=>buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:job,assignment:existing,target_worker_id:'w-2'}),/existing-assignment-requires-reassign/);
 assert.throws(()=>buildDispatchActionIntent({company_id:'co-a',action:'REASSIGN',work_item:job,target_worker_id:'w-2'}),/existing-assignment-required/);
 assert.throws(()=>buildDispatchActionIntent({company_id:'co-a',action:'REASSIGN',work_item:job,assignment:existing,target_worker_id:'w-1'}),/target-unchanged/);
});
test('cross-company and stale recommendation evidence fail closed',()=>{
 assert.throws(()=>buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:{...job,company_id:'evil'},target_worker_id:'w-2'}),/cross-company-work-item/);
 assert.throws(()=>buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:job,recommendation:{...rec,company_id:'evil'}}),/cross-company-recommendation/);
 assert.throws(()=>buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:job,recommendation:{...rec,state:'NO_ELIGIBLE_CANDIDATE'}}),/recommendation-not-ready/);
});
test('recommendation-selected worker cannot be silently substituted',()=>{
 assert.throws(()=>buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:job,recommendation:rec,target_worker_id:'w-9'}),/target-not-selected-recommendation/);
});
test('authority context is actor and company bound',()=>{
 const intent=buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:job,target_worker_id:'w-2',confirmed:true,confirmation_refs:['confirm-3']});
 assert.throws(()=>toGovernedDispatchSubmission(intent,{actor_id:'human-manager',authority_context:{...authority,company_id:'evil'}}),/cross-company-authority-context/);
 assert.throws(()=>toGovernedDispatchSubmission(intent,{actor_id:'human-manager',authority_context:{...authority,worker:{worker_id:'other'}}}),/authority-actor-mismatch/);
});
test('terminal work cannot be assigned',()=>{assert.throws(()=>buildDispatchActionIntent({company_id:'co-a',action:'ASSIGN',work_item:{...job,state:'completed'},target_worker_id:'w-2'}),/terminal-work-item/);});
