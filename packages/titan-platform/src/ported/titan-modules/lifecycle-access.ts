// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/lifecycle-access.mjs
const MUTATIONS = new Set([
  'installManifest','installPackage','installBundle','installMarketplace',
  'setEnabled','setBundleState','setCompanyEnabled','updateCompanyConfig',
  'uninstall','uninstallBundle','rollbackInstall','rollbackModule','rollbackBundle',
  'rollbackCompanyActivation','recoverModule','issueGrant','revokeGrant',
]);

export function isLifecycleMutation(action){
  return MUTATIONS.has(String(action||''));
}

export function isTrustedLifecycleSender(sender={}, extensionBase=''){
  const url=String(sender?.url||sender?.documentUrl||'').trim();
  if(!url) return true; // service worker/internal callers and deterministic test harnesses
  const base=String(extensionBase||'').trim();
  if(base && url.startsWith(base)) return true;
  return /^chrome-extension:\/\//i.test(url);
}

export function assertLifecycleActionSender(action,sender={},options={}){
  if(!isLifecycleMutation(action)) return true;
  if(!isTrustedLifecycleSender(sender,options.extensionBase||'')){
    throw new Error(`Module Platform Manager action requires a trusted extension context: ${String(action||'unknown')}`);
  }
  return true;
}

export const PLATFORM_MANAGER_LIFECYCLE_ACTIONS=Object.freeze([...MUTATIONS]);
