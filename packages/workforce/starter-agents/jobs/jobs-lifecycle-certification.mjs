const clean=v=>typeof v==='string'?v.trim():'';
export function certifyJobsLifecycle(input={}){
 for(const k of ['tenant_id','tenantId','tenant_company_id'])if(input?.[k]!=null)throw new Error(`jobs-certification-legacy-tenant-forbidden:${k}`);
 const company_id=clean(input.company_id);if(!company_id)throw new Error('jobs-certification-company-id-required');
 const checks={
  booking_or_schedule_reference:Boolean(clean(input.booking_id)||clean(input.appointment_id)||clean(input.service_request_id)),
  titan_field_owner:input.canonical_owner==='Titan Field',
  create_capability:input.create_capability==='crm.work_order.create',
  update_capability:input.update_capability==='crm.work_order.update',
  complete_capability:input.complete_capability==='crm.work_order.complete',
  command_bus_required:input.requires_command_bus===true,
  execution_receipt_required:input.requires_execution_receipt===true,
  post_verification_required:input.requires_post_verification===true,
  invoice_handoff_authority_neutral:input.invoice_handoff_execution_permitted===false,
  customer_care_handoff_authority_neutral:input.customer_care_handoff_execution_permitted===false,
  no_parallel_database:input.creates_parallel_database===false,
  ai_identity_not_authority:input.ai_identity_confers_authority===false
 };
 const failed=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
 return {schema:'titan.zero.jobs.lifecycle-certification.v1',company_id,worker:'Jobs Agent',status:failed.length?'NOT_CERTIFIED':'JOBS_READY_ADJACENT_LANES_ACTIVE',checks,failed_checks:failed,adjacent_lane_status:{booking:clean(input.booking_lane_status)||'ACTIVE',invoicing:clean(input.invoicing_lane_status)||'ACTIVE',customer_care:clean(input.customer_care_lane_status)||'ACTIVE'},live_cross_agent_certified:false,contract_compatibility_certified:failed.length===0,authority_granted:false,execution_permitted:false};
}
