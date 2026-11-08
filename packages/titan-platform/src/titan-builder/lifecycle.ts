import { resolveBuilderSurface, sanitizeBuilderProjection } from "./index.js";
import { TitanBuilderWorkspace, type BuilderDocument } from "./editor.js";

export type BuilderLifecycleRecord = Readonly<{
  schema:"titan.builder.lifecycle-record/v1";
  company_id:string;
  surface:"zero"|"go"|"hub";
  document_id:string;
  revision:number;
  parent_revision:number|null;
  status:"draft"|"published"|"superseded";
  document:BuilderDocument;
  created_at:string;
  authority_granted:false;
}>;

export type BuilderLifecycleStore = {
  loadLatest(input:{company_id:string;document_id:string}):Promise<BuilderLifecycleRecord|null>;
  loadRevision(input:{company_id:string;document_id:string;revision:number}):Promise<BuilderLifecycleRecord|null>;
  append(record:BuilderLifecycleRecord):Promise<void>;
};

function assertBoundary(document:BuilderDocument, company_id:string, surface?:string){
  if(document.company_id!==company_id) throw new Error("builder_lifecycle_company_mismatch");
  const canonical=resolveBuilderSurface(document.surface);
  if(surface && canonical!==resolveBuilderSurface(surface)) throw new Error("builder_lifecycle_surface_mismatch");
  return canonical;
}
function clean(document:BuilderDocument){return sanitizeBuilderProjection(document) as BuilderDocument;}

export async function persistBuilderDraft(input:{store:BuilderLifecycleStore;document:BuilderDocument;company_id:string;surface?:string}){
  const surface=assertBoundary(input.document,input.company_id,input.surface);
  const latest=await input.store.loadLatest({company_id:input.company_id,document_id:input.document.id});
  if(latest && latest.company_id!==input.company_id) throw new Error("builder_lifecycle_company_mismatch");
  if(latest && latest.surface!==surface) throw new Error("builder_lifecycle_surface_mismatch");
  if(latest && input.document.revision<latest.revision) throw new Error("builder_lifecycle_stale_revision");
  const record:BuilderLifecycleRecord=Object.freeze({schema:"titan.builder.lifecycle-record/v1",company_id:input.company_id,surface,document_id:input.document.id,revision:input.document.revision,parent_revision:latest?.revision??null,status:"draft",document:clean({...input.document,status:"draft"}),created_at:new Date().toISOString(),authority_granted:false});
  await input.store.append(record);return record;
}

export async function publishBuilderRevision(input:{store:BuilderLifecycleStore;document:BuilderDocument;company_id:string;surface?:string;preview_revision:number;approved:boolean}){
  if(input.approved!==true) throw new Error("builder_explicit_approval_required");
  const surface=assertBoundary(input.document,input.company_id,input.surface);
  if(input.preview_revision!==input.document.revision) throw new Error("builder_preview_stale");
  const latest=await input.store.loadLatest({company_id:input.company_id,document_id:input.document.id});
  if(latest && latest.revision>input.document.revision) throw new Error("builder_lifecycle_stale_revision");
  const workspace=TitanBuilderWorkspace.restore(input.document);const published=workspace.publish().document;
  const record:BuilderLifecycleRecord=Object.freeze({schema:"titan.builder.lifecycle-record/v1",company_id:input.company_id,surface,document_id:published.id,revision:published.revision,parent_revision:input.document.revision,status:"published",document:clean(published),created_at:new Date().toISOString(),authority_granted:false});
  await input.store.append(record);return record;
}

export async function rewindBuilderRevision(input:{store:BuilderLifecycleStore;company_id:string;surface:string;document_id:string;target_revision:number;expected_current_revision:number;approved:boolean}){
  if(input.approved!==true) throw new Error("builder_explicit_approval_required");
  const surface=resolveBuilderSurface(input.surface);
  const latest=await input.store.loadLatest({company_id:input.company_id,document_id:input.document_id});
  if(!latest) throw new Error("builder_lifecycle_not_found");
  if(latest.company_id!==input.company_id||latest.surface!==surface) throw new Error("builder_lifecycle_boundary_mismatch");
  if(latest.revision!==input.expected_current_revision) throw new Error("builder_lifecycle_conflict");
  const target=await input.store.loadRevision({company_id:input.company_id,document_id:input.document_id,revision:input.target_revision});
  if(!target) throw new Error("builder_revision_not_found");
  if(target.company_id!==input.company_id||target.surface!==surface) throw new Error("builder_lifecycle_boundary_mismatch");
  const restored=clean({...target.document,revision:latest.revision+1,status:"draft",updated_at:new Date().toISOString()});
  const record:BuilderLifecycleRecord=Object.freeze({schema:"titan.builder.lifecycle-record/v1",company_id:input.company_id,surface,document_id:input.document_id,revision:restored.revision,parent_revision:latest.revision,status:"draft",document:restored,created_at:new Date().toISOString(),authority_granted:false});
  await input.store.append(record);return Object.freeze({...record,rewound_from_revision:latest.revision,rewound_to_revision:target.revision,requires_preview_before_publish:true});
}
