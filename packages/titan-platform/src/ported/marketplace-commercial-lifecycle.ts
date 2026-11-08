// Titan Zero Marketplace Commercialisation — Pass 1
// Reconciles legacy cleaning marketplace product state with the governed Titan Modules lifecycle.
// company_id is Titan's canonical logical company identity. Provider-local physical isolation may add stronger boundaries. This compatibility adapter does not grant authority or execute spend.

const clone = <T>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value));
const COMPANY_ID=/^[A-Za-z0-9._:-]{2,128}$/;
const ACTIVE = new Set(['using','purchased','installed','included','enabled']);
const TERMINAL = new Set(['cancelled','removed','retired','uninstalled']);

export function normalizeMarketplaceCompanyId(value: unknown){
  if(value && typeof value === 'object'){
    if('tenant_id' in value || 'tenant_company_id' in value || 'organisation_id' in value ||
       'organization_id' in value || 'workspace_tenant_id' in value){
      throw new Error('legacy tenant identifiers are not accepted here; normalize to canonical company_id before marketplace lifecycle use');
    }
    value=(value as Record<string, unknown>).company_id;
  }
  const id=String(value??'').trim();
  if(!COMPANY_ID.test(id)) throw new Error('A valid company_id is required for marketplace lifecycle state');
  return id;
}

export function marketplaceSubjectKey(kind: unknown,id: unknown){
  const k=String(kind??'').trim().toLowerCase();
  const v=String(id??'').trim().toLowerCase();
  if(!['software','workforce','growth','module','bundle'].includes(k) || !v) throw new Error('A valid marketplace subject is required');
  return `${k}:${v}`;
}

export function deriveCommercialState({kind,id,legacyState,moduleState,packageVerification,valueEvidence,renewalEvidence}: any = {}){
  const key=marketplaceSubjectKey(kind,id);
  const legacy=clone(legacyState||{});
  const module=clone(moduleState||{});
  const legacyStatus=String(legacy.status||'').toLowerCase();
  const installed=ACTIVE.has(legacyStatus) || Boolean(module.installed_at) || module.enabled===true;
  const removed=TERMINAL.has(legacyStatus) || Boolean(module.uninstalled_at);
  const verified=packageVerification?.verified===true || packageVerification?.ok===true;
  const authority={
    grants_authority:false, approves_spend:false, purchases:false, renews:false,
    cancels:false, removes_workers:false, installs_without_governed_runtime:false
  };
  let lifecycle='available';
  if(removed) lifecycle='removed';
  else if(installed && verified) lifecycle='installed_verified';
  else if(installed) lifecycle='installed_unverified_legacy';
  else if(legacyStatus==='purchased') lifecycle='purchased_pending_install';
  const evidence={
    value: clone(valueEvidence||null),
    renewal: clone(renewalEvidence||null)
  };
  return Object.freeze({
    key, kind:String(kind).toLowerCase(), id:String(id).toLowerCase(),
    lifecycle, installed, verified, legacy_status:legacyStatus||null,
    module_state:module, evidence, authority,
    needs_governed_reconciliation: installed && !verified,
    source_of_install_authority: verified ? 'titan_modules_governed_runtime' : installed ? 'legacy_state_observation_only' : null
  });
}

export function createMarketplaceCommercialLifecycle({moduleManager,marketplaceRuntime,readLegacyState,readEvidence,clock=()=>Date.now()}: any = {}){
  if(!moduleManager || typeof moduleManager.listStates!=='function') throw new Error('moduleManager is required');
  if(!marketplaceRuntime || typeof marketplaceRuntime.install!=='function') throw new Error('marketplaceRuntime is required');
  if(typeof readLegacyState!=='function') throw new Error('readLegacyState is required');
  if(typeof readEvidence!=='function') throw new Error('readEvidence is required');

  async function snapshot(company_id: unknown,subjects: any[]=[]){
    const company=normalizeMarketplaceCompanyId(company_id);
    const states=await moduleManager.listStates(company);
    const evidence=await readEvidence(company);
    const rows=[];
    for(const subject of subjects){
      const key=marketplaceSubjectKey(subject.kind,subject.id);
      const legacy=await readLegacyState(company,subject);
      const moduleId=subject.module_id||subject.id;
      rows.push(deriveCommercialState({
        ...subject,
        legacyState:legacy,
        moduleState:states[moduleId]||{},
        packageVerification:subject.package_verification,
        valueEvidence:evidence?.value?.[key],
        renewalEvidence:evidence?.renewal?.[key]
      }));
    }
    return Object.freeze({company_id:company,generated_at:new Date(clock()).toISOString(),items:rows,
      grants_authority:false,executes_purchases:false,executes_renewals:false});
  }

  /** @deprecated Compatibility lifecycle only. `approved=true` is not Titan execution authority; canonical installs must traverse effective authority + ExecutionGateway/Foundry. */
  async function governedInstall(company_id: unknown,itemId: string,options: any={}){
    const company=normalizeMarketplaceCompanyId(company_id);
    if(options.approved!==true) throw new Error('Compatibility approval marker required; canonical effective authority must be evaluated by the execution owner');
    const result=await marketplaceRuntime.install(itemId,options);
    return Object.freeze({company_id:company,item_id:itemId,result:clone(result),
      authority_source:'compatibility_marker_only_not_canonical_execution_authority'});
  }

  return Object.freeze({snapshot,governedInstall});
}
