// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/pagestudio-donor/registry.mjs
export const PAGESTUDIO_PROVIDER_ID='donor.pagestudio';
export const PAGESTUDIO_CONTRIBUTIONS=Object.freeze([
{id:'builder.pagestudio.templates',kind:'presentation',provider_id:PAGESTUDIO_PROVIDER_ID,operations:['discover','compose'],capabilities:['builder.templates','interaction.templates'],permissions:[],offline_support:true,metadata:{source:'PageStudio',authority_neutral:true}},
{id:'builder.pagestudio.themes',kind:'visual',provider_id:PAGESTUDIO_PROVIDER_ID,operations:['discover','preview'],capabilities:['builder.themes','visual.theme_profile'],permissions:[],offline_support:true,metadata:{source:'PageStudio',authority_neutral:true}},
{id:'builder.pagestudio.components',kind:'presentation',provider_id:PAGESTUDIO_PROVIDER_ID,operations:['discover','compose'],capabilities:['builder.components','presentation.primitives'],permissions:[],offline_support:true,metadata:{source:'PageStudio',authority_neutral:true}},
{id:'builder.pagestudio.wizards',kind:'capability',provider_id:PAGESTUDIO_PROVIDER_ID,operations:['discover','plan'],capabilities:['builder.wizard_definitions','builder.output_schemas'],permissions:[],offline_support:true,metadata:{source:'PageStudio',authority_neutral:true}},
{id:'builder.pagestudio.lifecycle',kind:'capability',provider_id:PAGESTUDIO_PROVIDER_ID,operations:['version','publish','rollback'],capabilities:['builder.versioning','builder.publish','builder.rollback'],permissions:[],offline_support:false,metadata:{source:'PageStudio',authority_neutral:true,execution_requires_host_authority:true}}
]);
export function registerPageStudioContributions(registry,{company_id}={}){if(!registry||typeof registry.registerMany!=='function') throw new TypeError('registry-required'); if(!String(company_id??registry.company_id??'').trim()) throw new Error('company_id-required'); return registry.registerMany(PAGESTUDIO_CONTRIBUTIONS.map(x=>({...x,company_id:String(company_id??registry.company_id).trim()})));}
