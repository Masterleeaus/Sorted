const SCHEMA = 'titan.workforce.starter.invoicing.financial-integrity-certification.v1';
function text(v){return typeof v==='string'&&v.trim()?v.trim():null;}
function company(v){const c=text(v);if(!c)throw new TypeError('company_id is required');return c;}
function auth(){return Object.freeze({company_boundary:'company_id',identity_grants_authority:false,authority_granted:false,grants_authority:false,execution_permitted:false,canonical_financial_mutation_permitted:false});}
function assertCompany(c,obj,label){if(obj==null)return;if(obj.company_id!==c)throw new Error(`company_boundary_mismatch:${label}`);}
function check(name,passed,detail=null){return Object.freeze({name,passed:passed===true,detail});}

export function certifyInvoicingFinancialIntegrity({company_id,readiness=null,exact_money_result=null,review_gate=null,issue_send_proposal=null,payment_monitoring=null,correction_proposal=null}={}){
  const c=company(company_id);
  assertCompany(c,readiness,'readiness'); assertCompany(c,exact_money_result,'exact_money'); assertCompany(c,review_gate,'review_gate'); assertCompany(c,issue_send_proposal,'issue_send'); assertCompany(c,payment_monitoring,'payment_monitoring'); assertCompany(c,correction_proposal,'correction');
  const checks=[];
  if(readiness) checks.push(check('readiness_no_execution_authority',readiness.authority?.execution_permitted===false));
  if(exact_money_result){
    checks.push(check('exact_money_certified',exact_money_result.schema==='titan.workforce.starter.invoicing.exact-money.v1'&&exact_money_result.exact_money_certified===true));
    checks.push(check('integer_minor_units_only',exact_money_result.arithmetic?.representation==='integer_minor_units'&&exact_money_result.arithmetic?.binary_float_used===false));
    checks.push(check('exact_money_reconciled',exact_money_result.reconciliation?.line_sum_matches_subtotal===true&&exact_money_result.reconciliation?.subtotal_discount_tax_matches_total===true));
  }
  if(review_gate) checks.push(check('review_never_grants_worker_execution',review_gate.authority?.execution_permitted===false));
  if(issue_send_proposal){
    checks.push(check('send_is_command_bus_only',issue_send_proposal.issue?.command_bus_required===true&&issue_send_proposal.authority?.direct_provider_send_permitted===false));
    checks.push(check('send_has_idempotent_identity',Boolean(text(issue_send_proposal.identity?.operation_id)&&text(issue_send_proposal.identity?.idempotency_key)&&text(issue_send_proposal.identity?.external_reference_key))));
  }
  if(payment_monitoring){
    checks.push(check('payment_projection_only',payment_monitoring.authority?.canonical_payment_mutation_permitted===false&&payment_monitoring.authority?.execution_permitted===false));
    checks.push(check('payment_balance_is_integer_string',/^-?\d+$/.test(String(payment_monitoring.observed?.balance_due_minor??''))));
  }
  if(correction_proposal){
    checks.push(check('correction_preserves_original',correction_proposal.source_invoice?.immutable_source_record===true&&correction_proposal.governance?.original_invoice_delete_permitted===false&&correction_proposal.governance?.original_invoice_financial_fields_edit_permitted===false));
    checks.push(check('correction_no_refund_authority',correction_proposal.authority?.refund_execution_permitted===false));
  }
  const failed=checks.filter(x=>!x.passed).map(x=>x.name);
  return Object.freeze({schema:SCHEMA,company_id:c,worker:'Invoicing Agent',certified:failed.length===0,checks:Object.freeze(checks),blocking_invariants:Object.freeze(failed),authority:auth()});
}
export {SCHEMA as FINANCIAL_INTEGRITY_CERTIFICATION_SCHEMA};
