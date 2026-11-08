import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDispatchSettings, applyDispatchSettingsToExceptionInput, summarizeDispatchSettings } from '../titan-workforce/dispatch/dispatch-settings-runtime.mjs';
const company_id='co-1';

test('safe defaults preserve manual governed dispatch and local-first travel',()=>{const p=projectDispatchSettings({company_id});assert.equal(p.travel.mode,'LOCAL_GEOMETRY');assert.equal(p.travel.external_provider_enabled,false);assert.equal(p.manual_confirmation_required,true);assert.equal(p.automatic_assignment,false);assert.equal(p.automatic_reassignment,false);assert.equal(p.execution_permitted,false);});

test('exception thresholds are deterministic and no-show cannot precede late threshold',()=>{const p=projectDispatchSettings({company_id,dispatchSettings:{late_after_minutes:45,no_show_after_minutes:10,overrun_grace_minutes:20,unassigned_lead_minutes:15}});assert.deepEqual(p.exception_thresholds,{late_after_minutes:45,no_show_after_minutes:45,overrun_grace_minutes:20,unassigned_lead_minutes:15,urgent_priority_floor:4});});

test('role and worker overrides use existing workforceAgentOverrides seam without changing authority',()=>{const p=projectDispatchSettings({company_id,worker_id:'dispatch-1',workforceAgentOverrides:{roles:{dispatch:{late_after_minutes:20}},workers:{'dispatch-1':{late_after_minutes:5,automatic_reassignment:true}}}});assert.equal(p.exception_thresholds.late_after_minutes,5);assert.equal(p.automatic_reassignment,false);assert.equal(p.settings_source,'titan.settings.workforce-agent-overrides.v1');assert.equal(p.settings_can_grant_authority,false);});

test('BYO provider settings remain gated and never bill Titan',()=>{const off=projectDispatchSettings({company_id,dispatchSettings:{travel_mode:'BYO_PROVIDER'}});assert.equal(off.travel.external_provider_enabled,false);const on=projectDispatchSettings({company_id,dispatchSettings:{travel_mode:'BYO_PROVIDER',allow_external_provider:true}});assert.equal(on.travel.external_provider_enabled,true);assert.equal(on.travel.requires_byo_credential_ref,true);assert.equal(on.travel.requires_cost_acknowledgement,true);assert.equal(on.travel.billable_to_titan,false);assert.equal(on.travel.travel_time_may_be_inferred,false);});

test('same-day/customer settings can suppress projections but can never authorize send',()=>{const p=projectDispatchSettings({company_id,dispatchSettings:{same_day_change_projection:false,customer_update_projection:false,automatic_send:true,automatic_customer_contact:true}});assert.equal(p.same_day_changes.enabled,false);assert.equal(p.same_day_changes.customer_projection_enabled,false);assert.equal(p.same_day_changes.automatic_send,false);assert.equal(p.automatic_customer_contact,false);});

test('settings can never enable assignment cancellation replay or execution',()=>{const p=projectDispatchSettings({company_id,dispatchSettings:{automatic_assignment:true,automatic_reassignment:true,automatic_cancellation:true,automatic_effect_replay:true,execution_permitted:true,grants_authority:true}});for(const k of ['automatic_assignment','automatic_reassignment','automatic_cancellation','automatic_effect_replay','execution_permitted','grants_authority'])assert.equal(p[k],false);assert.equal(p.manual_confirmation_required,true);assert.equal(p.requires_fresh_authority_evaluation,true);assert.equal(p.requires_authoritative_receipt,true);});

test('legacy tenant keys fail closed recursively',()=>{assert.throws(()=>projectDispatchSettings({company_id,dispatchSettings:{nested:{tenant_company_id:'legacy'}}}),/legacy-company-boundary/);});

test('exception input adapter rejects cross-company use',()=>{const p=projectDispatchSettings({company_id});assert.throws(()=>applyDispatchSettingsToExceptionInput(p,{company_id:'co-2'}),/cross-company/);const x=applyDispatchSettingsToExceptionInput(p,{company_id});assert.equal(x.late_after_minutes,10);assert.equal(x.no_show_after_minutes,30);});

test('summary remains authority neutral',()=>{const s=summarizeDispatchSettings(projectDispatchSettings({company_id}));assert.deepEqual(s,{company_id,travel_mode:'LOCAL_GEOMETRY',external_provider_enabled:false,manual_confirmation_required:true,automatic_assignment:false,automatic_reassignment:false,automatic_customer_contact:false,execution_permitted:false,grants_authority:false});});
