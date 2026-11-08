export type CapsuleManifest={schema:"titan.capsule-manifest.v1";capsule_id:string;company_id:string;source_revision:string;constitution_version:string;runtime_version:string;provider_refs:readonly string[];encrypted_secret_refs:readonly string[];content_checksums:Readonly<Record<string,string>>;created_at:string};
const req=(v:unknown,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x;};
export function createTitanCapsuleManifest(input:Omit<CapsuleManifest,"schema"|"created_at">&{created_at?:string}):CapsuleManifest{
 const created_at=input.created_at??new Date().toISOString(); if(!Number.isFinite(Date.parse(created_at)))throw new Error("created_at-invalid");
 const checksums=Object.fromEntries(Object.entries(input.content_checksums??{}).map(([k,v])=>[req(k,"content-key"),req(v,"content-checksum")]));
 if(!Object.keys(checksums).length)throw new Error("content-checksums-required");
 return Object.freeze({schema:"titan.capsule-manifest.v1",capsule_id:req(input.capsule_id,"capsule_id"),company_id:req(input.company_id,"company_id"),source_revision:req(input.source_revision,"source_revision"),constitution_version:req(input.constitution_version,"constitution_version"),runtime_version:req(input.runtime_version,"runtime_version"),provider_refs:Object.freeze((input.provider_refs??[]).map(v=>req(v,"provider_ref"))),encrypted_secret_refs:Object.freeze((input.encrypted_secret_refs??[]).map(v=>req(v,"secret_ref"))),content_checksums:checksums,created_at});
}
export function validateTitanCapsule(manifest:CapsuleManifest,input:{company_id:string;runtime_version:string;constitution_version:string;available_checksums:Record<string,string>;revoked_secret_refs?:readonly string[]}):{valid:boolean;reason:"valid"|"company-mismatch"|"runtime-incompatible"|"constitution-incompatible"|"checksum-mismatch"|"secret-revoked"}{
 if(manifest.company_id!==req(input.company_id,"company_id"))return {valid:false,reason:"company-mismatch"};
 if(manifest.runtime_version!==req(input.runtime_version,"runtime_version"))return {valid:false,reason:"runtime-incompatible"};
 if(manifest.constitution_version!==req(input.constitution_version,"constitution_version"))return {valid:false,reason:"constitution-incompatible"};
 if((manifest.encrypted_secret_refs??[]).some(v=>input.revoked_secret_refs?.includes(v)))return {valid:false,reason:"secret-revoked"};
 for(const [key,checksum] of Object.entries(manifest.content_checksums))if(input.available_checksums[key]!==checksum)return {valid:false,reason:"checksum-mismatch"};
 return {valid:true,reason:"valid"};
}
