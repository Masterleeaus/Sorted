export type VerticalProfileInput={profile_id:string;version:number;display_name:string;capabilities:readonly string[];terminology:Record<string,string>;source_ref:string;core_version:string};
export type CompiledVerticalProfile=VerticalProfileInput&{schema:"titan.vertical-profile.v1";generated_at:string;capabilities:readonly string[]};
const req=(v:unknown,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x;};
export function compileVerticalProfile(input:VerticalProfileInput,knownCapabilities:readonly string[],now=new Date().toISOString()):CompiledVerticalProfile{
  if(!Number.isInteger(input.version)||input.version<1)throw new Error("profile-version-invalid");
  const profile_id=req(input.profile_id,"profile_id"),display_name=req(input.display_name,"display_name"),source_ref=req(input.source_ref,"source_ref"),core_version=req(input.core_version,"core_version");
  if(!Number.isFinite(Date.parse(now)))throw new Error("generated_at-invalid");
  const capabilities=[...new Set(input.capabilities.map(v=>req(v,"capability")))];
  const unknown=capabilities.filter(v=>!knownCapabilities.includes(v)); if(unknown.length)throw new Error(`unknown-capability:${unknown.join(",")}`);
  const terminology=Object.fromEntries(Object.entries(input.terminology??{}).map(([k,v])=>[req(k,"term-key"),req(v,"term-value")]));
  return Object.freeze({schema:"titan.vertical-profile.v1",profile_id,version:input.version,display_name,capabilities:Object.freeze(capabilities),terminology,source_ref,core_version,generated_at:now});
}
export function exposeVerticalCapabilities(profile:CompiledVerticalProfile,entitledCapabilities:readonly string[]):readonly string[]{
  return Object.freeze(profile.capabilities.filter(capability=>entitledCapabilities.includes(capability)));
}
