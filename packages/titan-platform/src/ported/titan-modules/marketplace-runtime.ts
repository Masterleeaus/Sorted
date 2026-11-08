// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/marketplace-runtime.mjs
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
export function createMarketplaceRuntime({fetchJson,verifyPackage,installModule,installBundle}={}){
  if(typeof fetchJson!=='function'||typeof verifyPackage!=='function'||typeof installModule!=='function'||typeof installBundle!=='function')throw new Error('Marketplace runtime dependencies are required');
  async function list(catalogPath='titan-modules/marketplace/catalog.json'){
    const catalog=await fetchJson(catalogPath);
    if(catalog?.schema!=='titan-marketplace/v1'||!Array.isArray(catalog.items))throw new Error('Marketplace catalog is invalid');
    return clone(catalog);
  }
  async function install(itemId,{catalogPath='titan-modules/marketplace/catalog.json'}={}){
    const catalog=await list(catalogPath);const item=catalog.items.find(entry=>String(entry.id)===String(itemId));
    if(!item)throw new Error(`Marketplace item not found: ${itemId}`);
    const envelope=await fetchJson(item.package);
    const verification=await verifyPackage(envelope);
    const packageType=verification.package_type||envelope.package_type;
    let result;
    if(packageType==='module')result=await installModule(verification.payload,{packageVerification:verification});
    else if(packageType==='bundle')result=await installBundle(verification.payload,{packageVerification:verification});
    else throw new Error(`Unsupported marketplace package type: ${packageType}`);
    return {item:clone(item),verified:true,publisher_id:verification.publisher_id,digest:verification.digest,result:clone(result)};
  }
  return Object.freeze({list,install});
}
