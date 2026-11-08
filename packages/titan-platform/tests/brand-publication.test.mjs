import test from "node:test";
import assert from "node:assert/strict";
import { createBrandPublication, promoteBrandPublication, createBrandRollbackIntent, reconcileBrandRollbackObservation, createBrandRendererHandoff, compileMicroweberPageDraft, compileMicroweberSiteDraft, reconcileBrandRendererObservation, assertBrandRendererRequest, createBrandStudioProjection, assertBrandStudioProjection, summarizeBrandStudioProjection, createBrandActionBinding, computeBrandPublicationIdempotencyKey, computeBrandBuilderSnapshotHash, createMicroweberSitemapDraft } from "../.test-dist/brand-publication.js";
const base={publication_id:"pub-1",company_id:"co-1",site_id:"site-1",version:1,source_snapshot_hash:"hash-1",route_manifest:["/","/contact"],created_at:"2026-02-01T00:00:00Z"};
test("keeps draft/preview separate from live",()=>{const d=createBrandPublication(base); assert.equal(d.environment,"preview"); const a=createBrandPublication({...base,status:"approved"}); const live=promoteBrandPublication(a,{company_id:"co-1",approved_snapshot_hash:"hash-1"}); assert.equal(live.status,"published");});
test("rejects unapproved live, invalid publication state, snapshot mismatch, and unsafe renderer routes",()=>{assert.throws(()=>createBrandPublication({...base,environment:"live"}),/not-approved/); assert.throws(()=>createBrandPublication({...base,status:"surprise"}),/status-invalid/); assert.throws(()=>createBrandPublication({...base,environment:"production"}),/environment-invalid/); const a=createBrandPublication({...base,status:"approved"}); assert.throws(()=>promoteBrandPublication(a,{company_id:"co-1",approved_snapshot_hash:"bad"}),/snapshot-mismatch/); for(const route of ["/../private","//attacker.test/path","/page?admin=1","/%2e%2e/private","/bad%2fpath"]) assert.throws(()=>createBrandPublication({...base,route_manifest:[route]}),/route-invalid/);});
test("creates an idempotent rollback intent scoped by source and target versions",async()=>{const good=createBrandPublication({...base,status:"published",environment:"live"}); const bad=createBrandPublication({...base,publication_id:"pub-2",version:2,status:"published",environment:"live"}); const intent=await createBrandRollbackIntent(bad,good); assert.equal(intent.idempotency_key,"sha256:2543f2ab41de9151151e1e3a557497ad684446a0a873b5131c21037309c4bf10"); assert.equal((await createBrandRollbackIntent(bad,good)).idempotency_key,intent.idempotency_key); const newer=createBrandPublication({...base,publication_id:"pub-3",version:3,status:"published",environment:"live"}); assert.notEqual((await createBrandRollbackIntent(newer,good)).idempotency_key,intent.idempotency_key);});
test("creates a proposed rollback intent delegated to Surface Manager without claiming a state change",async()=>{const good=createBrandPublication({...base,status:"published",environment:"live"}); const bad=createBrandPublication({...base,publication_id:"pub-2",version:2,status:"published",environment:"live"}); const intent=await createBrandRollbackIntent(bad,good); assert.deepEqual(intent,{schema:"titan.brand-rollback-intent/v1",company_id:"co-1",site_id:"site-1",source_publication_id:"pub-2",source_version:2,target_publication_id:"pub-1",target_version:1,target_snapshot_hash:"hash-1",target_routes:["/","/contact"],idempotency_key:"sha256:2543f2ab41de9151151e1e3a557497ad684446a0a873b5131c21037309c4bf10",surface_intent:{surface_id:"site-1",company_id:"co-1",intent:"rollback",authorityGranted:false,delegated_to:"deployment-owner"},state:"proposed",authority_granted:false}); assert.equal(bad.status,"published"); assert.equal(good.status,"published"); await assert.rejects(createBrandRollbackIntent(bad,{...good,company_id:"co-2"})); await assert.rejects(createBrandRollbackIntent(good,good),/rollback-target-not-older/); await assert.rejects(createBrandRollbackIntent({...bad,status:"draft"},good),/published-publication-required/);});
test("verifies a rollback only when the observed renderer matches the known-good target",async()=>{const good=createBrandPublication({...base,status:"published",environment:"live"}); const bad=createBrandPublication({...base,publication_id:"pub-2",version:2,status:"published",environment:"live"}); const intent=await createBrandRollbackIntent(bad,good); assert.deepEqual(await reconcileBrandRollbackObservation(intent,{accepted:true},null),{status:"pending",reason:"awaiting-provider-observation"}); assert.deepEqual(await reconcileBrandRollbackObservation(intent,{accepted:false},null),{status:"degraded",reason:"provider-rejected"}); assert.deepEqual(await reconcileBrandRollbackObservation(intent,{accepted:true},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"live",routes:["/","/contact"],reachable:true}),{status:"verified"}); assert.deepEqual(await reconcileBrandRollbackObservation({...intent,idempotency_key:"sha256:bad"},{accepted:true},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"live",routes:["/","/contact"],reachable:true}),{status:"degraded",reason:"observed-publication-mismatch"}); assert.deepEqual(await reconcileBrandRollbackObservation(intent,{accepted:true},{company_id:"co-1",site_id:"site-1",version:2,snapshot_hash:"hash-1",environment:"live",routes:["/","/contact"],reachable:true}),{status:"degraded",reason:"observed-publication-mismatch"}); assert.deepEqual(await reconcileBrandRollbackObservation(intent,{accepted:true},{company_id:"co-2",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"live",routes:["/","/contact"],reachable:true}),{status:"degraded",reason:"observed-publication-mismatch"});});

test("projects a company-scoped Builder snapshot to a declarative renderer handoff and Surface Manager descriptor",async()=>{
 const root={id:"root",type:"stack",children:[{id:"home",type:"text",props:{responsive:{mobile:"stack",tablet:"grid",desktop:"grid"}},children:[]}]};
 const result=await createBrandRendererHandoff({
  company_id:"co-1",publication_id:"pub-2",site_id:"site-1",version:7,source_snapshot_hash:"sha256:290d1fe47cbf3a0053b790a24b33e9d8c6144ed1bb094f8b6bf3a70817356443",
  renderer:"microweber",environment:"preview",route_manifest:["/","/services"],verifyCurrentSnapshot:async()=>true,
  snapshot:{id:"builder-site-1",company_id:"co-1",surface:"go",title:"Services",revision:6,status:"published",updated_at:"2026-10-03T00:00:00Z",root},
 });
 assert.equal(result.provider_request.schema,"titan.brand-renderer-request/v1");
 assert.match(result.provider_request.idempotency_key,/^sha256:[a-f0-9]{64}$/);
 assert.equal(result.provider_request.renderer,"microweber");
 assert.equal(result.provider_request.source.revision,6);
 assert.equal(result.provider_request.source.snapshot_hash,"sha256:290d1fe47cbf3a0053b790a24b33e9d8c6144ed1bb094f8b6bf3a70817356443");
 assert.equal(result.provider_request.authority_granted,false);
 assert.deepEqual(result.provider_request.routes,["/","/services"]);
 assert.equal(result.surface_descriptor.company_id,"co-1");
 assert.equal(result.surface_descriptor.surface_class,"PUBLIC_WEB");
 assert.equal(result.surface_descriptor.provenance_ref,"pub-2");
 assert.equal(result.surface_descriptor.authorityGranted,false);
 assert.equal(result.surface_descriptor.state,"DECLARED");
 assert.equal((await assertBrandRendererRequest(result.provider_request,undefined,async()=>true)).publication_id,"pub-2");
 await assert.rejects(assertBrandRendererRequest({...result.provider_request,schema:"titan.brand-renderer-request/v2"}),/schema-unsupported/);
 await assert.rejects(assertBrandRendererRequest({...result.provider_request,execute_php:"<?php"}),/unknown-field/);
 await assert.rejects(assertBrandRendererRequest({...result.provider_request,company_id:"co-2"}),/company-mismatch/);
 await assert.rejects(assertBrandRendererRequest({...result.provider_request,idempotency_key:"sha256:bad"},undefined,async()=>true),/idempotency-key-mismatch/);
 await assert.rejects(createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-2",site_id:"site-1",version:7,source_snapshot_hash:"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot:{id:"builder-site-1",company_id:"co-1",surface:"go",title:"Services",revision:6,status:"published",updated_at:"2026-10-03T00:00:00Z",root},verifyCurrentSnapshot:async()=>true}),/snapshot-hash-mismatch/);
 await assert.rejects(createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-4",site_id:"site-1",version:7,source_snapshot_hash:"sha256:290d1fe47cbf3a0053b790a24b33e9d8c6144ed1bb094f8b6bf3a70817356443",renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot:{id:"builder-site-1",company_id:"co-1",surface:"go",title:"Services",revision:6,status:"published",updated_at:"2026-10-03T00:00:00Z",root},verifyCurrentSnapshot:async()=>false}),/snapshot-stale/);
 await assert.rejects(createBrandRendererHandoff({company_id:"co-2",publication_id:"pub-2",site_id:"site-1",version:7,source_snapshot_hash:"sha256:290d1fe47cbf3a0053b790a24b33e9d8c6144ed1bb094f8b6bf3a70817356443",renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot:{id:"builder-site-1",company_id:"co-1",surface:"go",title:"Services",revision:6,status:"published",updated_at:"2026-10-03T00:00:00Z",root}}),/company-mismatch/);
 await assert.rejects(createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-3",site_id:"site-1",version:8,source_snapshot_hash:"sha256:bad",renderer:"wordpress",environment:"preview",route_manifest:["/"],snapshot:{id:"builder-site-1",company_id:"co-1",surface:"go",title:"Unsafe",revision:7,status:"draft",updated_at:"2026-10-03T00:00:00Z",root:{id:"root",type:"stack",children:[{id:"home",type:"text",props:{html:"<script>alert(1)</script>",responsive:{mobile:"stack",tablet:"grid",desktop:"grid"}},children:[]}]}}}),/active_content_denied/);
});

test("compiles only a verified single-route Builder snapshot into inert Microweber page content",async()=>{
 const responsive={mobile:"stack",tablet:"grid",desktop:"grid"};
 const snapshot={id:"builder-static-page",company_id:"co-1",surface:"go",title:"Services & support",revision:3,status:"draft",updated_at:"2026-10-03T00:00:00Z",root:{id:"root",type:"stack",children:[
  {id:"heading",type:"heading",props:{text:"Local services",responsive},children:[]},
  {id:"copy",type:"text",props:{text:"Reliable & <care>",responsive},children:[]},
  {id:"cta",type:"button",props:{label:"Contact us",href:"/contact",responsive},children:[]},
 ]}};
 const source_snapshot_hash=await computeBrandBuilderSnapshotHash(snapshot);
 const request=(await createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-static",site_id:"site-static",version:3,source_snapshot_hash,renderer:"microweber",environment:"preview",route_manifest:["/services"],snapshot,verifyCurrentSnapshot:async()=>true})).provider_request;
 const page=await compileMicroweberPageDraft(request,{verifyCurrentSnapshot:async()=>true});
 assert.deepEqual(page,{schema:"titan.microweber-page-draft/v1",company_id:"co-1",publication_id:"pub-static",site_id:"site-static",version:3,route:"/services",title:"Services & support",content_html:"<div><h2>Local services</h2><p>Reliable &amp; &lt;care&gt;</p><a href=\"/contact\">Contact us</a></div>",source_snapshot_hash,authority_granted:false});
 await assert.rejects(compileMicroweberPageDraft({...request,routes:["/services","/about"]},{verifyCurrentSnapshot:async()=>true}),/single-route-snapshot-required/);
 await assert.rejects(compileMicroweberPageDraft({...request,renderer:"wordpress"},{verifyCurrentSnapshot:async()=>true}),/microweber-renderer-request-required/);
 const unsupported={...snapshot,root:{id:"root",type:"stack",children:[{id:"form",type:"form-input",props:{label:"Email",responsive},children:[]}]}};
 const unsupportedHash=await computeBrandBuilderSnapshotHash(unsupported);
 const unsupportedRequest=(await createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-form",site_id:"site-static",version:4,source_snapshot_hash:unsupportedHash,renderer:"microweber",environment:"preview",route_manifest:["/contact"],snapshot:unsupported,verifyCurrentSnapshot:async()=>true})).provider_request;
 await assert.rejects(compileMicroweberPageDraft(unsupportedRequest,{verifyCurrentSnapshot:async()=>true}),/builder-component-unsupported/);
});

test("renders Builder image blocks only from safe same-site paths with escaped alt text",async()=>{
 const responsive={mobile:"stack",tablet:"grid",desktop:"grid"};
 const snapshot={id:"builder-image-page",company_id:"co-1",surface:"go",title:"Company",revision:1,status:"draft",updated_at:"2026-10-03T00:00:00Z",root:{id:"root",type:"stack",children:[{id:"brand-image",type:"image",props:{src:"/media/brand.png",alt:"A & B <logo>",responsive},children:[]}]}};
 const source_snapshot_hash=await computeBrandBuilderSnapshotHash(snapshot);
 const request=(await createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-image",site_id:"site-image",version:1,source_snapshot_hash,renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot,verifyCurrentSnapshot:async()=>true})).provider_request;
 const page=await compileMicroweberPageDraft(request,{verifyCurrentSnapshot:async()=>true});
 assert.equal(page.content_html,'<div><img src="/media/brand.png" alt="A &amp; B &lt;logo&gt;" loading="lazy"></div>');
 for(const src of ["//outside.test/image.png","/../private.png"]){
  const unsafe={...snapshot,root:{id:"root",type:"stack",children:[{id:"image",type:"image",props:{src,alt:"image",responsive},children:[]}]}};
  const hash=await computeBrandBuilderSnapshotHash(unsafe);
  const unsafeRequest=(await createBrandRendererHandoff({company_id:"co-1",publication_id:`pub-${encodeURIComponent(src)}`,site_id:"site-image",version:1,source_snapshot_hash:hash,renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot:unsafe,verifyCurrentSnapshot:async()=>true})).provider_request;
  await assert.rejects(compileMicroweberPageDraft(unsafeRequest,{verifyCurrentSnapshot:async()=>true}),/microweber-image-source-invalid/);
 }
 const active={...snapshot,root:{id:"root",type:"stack",children:[{id:"image",type:"image",props:{src:"javascript:alert(1)",alt:"image",responsive},children:[]}]}};
 const activeHash=await computeBrandBuilderSnapshotHash(active);
 await assert.rejects(createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-active-image",site_id:"site-image",version:1,source_snapshot_hash:activeHash,renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot:active,verifyCurrentSnapshot:async()=>true}),/builder_security_active_content_denied/);
 const dataImage={...snapshot,root:{id:"root",type:"stack",children:[{id:"image",type:"image",props:{src:"data:image/svg+xml,<svg/>",alt:"image",responsive},children:[]}]}};
 const dataHash=await computeBrandBuilderSnapshotHash(dataImage);
 const dataRequest=(await createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-data-image",site_id:"site-image",version:1,source_snapshot_hash:dataHash,renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot:dataImage,verifyCurrentSnapshot:async()=>true})).provider_request;
 await assert.rejects(compileMicroweberPageDraft(dataRequest,{verifyCurrentSnapshot:async()=>true}),/microweber-image-source-invalid/);
});

test("compiles a version-consistent multi-page Microweber site deterministically and rejects scope collisions",async()=>{
 const responsive={mobile:"stack",tablet:"grid",desktop:"grid"};
 const makeSnapshot=(id,title,text,company_id="co-1")=>({id,company_id,surface:"go",title,revision:2,status:"draft",updated_at:"2026-10-03T00:00:00Z",root:{id:"root",type:"stack",children:[{id:`${id}-heading`,type:"heading",props:{text,responsive},children:[]}]}});
 const makeRequest=async(snapshot,route,company_id="co-1")=>{
  const source_snapshot_hash=await computeBrandBuilderSnapshotHash(snapshot);
  return (await createBrandRendererHandoff({company_id,publication_id:"pub-site-v2",site_id:"site-multi",version:2,source_snapshot_hash,renderer:"microweber",environment:"preview",route_manifest:[route],snapshot,verifyCurrentSnapshot:async()=>true})).provider_request;
 };
 const home=await makeRequest(makeSnapshot("builder-home","Home","Welcome"),"/");
 const services=await makeRequest(makeSnapshot("builder-services","Services","Repairs"),"/services");
 const verifyCurrentSnapshot=async()=>true;
 const site=await compileMicroweberSiteDraft([services,home],{verifyCurrentSnapshot});
 assert.equal(site.schema,"titan.microweber-site-draft/v1");
 assert.deepEqual(site.pages.map(page=>page.route),["/","/services"]);
 assert.deepEqual(site.pages.map(page=>page.content_html),["<div><h2>Welcome</h2></div>","<div><h2>Repairs</h2></div>"]);
 assert.match(site.source_snapshot_hash,/^sha256:[a-f0-9]{64}$/);
 assert.deepEqual((await compileMicroweberSiteDraft([home,services],{verifyCurrentSnapshot})),site);
 await assert.rejects(compileMicroweberSiteDraft([home,{...services,routes:["/"]}],{verifyCurrentSnapshot}),/microweber-site-duplicate-route/);
 const otherCompany=await makeRequest(makeSnapshot("builder-other","Other","Private","co-2"),"/about","co-2");
 await assert.rejects(compileMicroweberSiteDraft([home,otherCompany],{verifyCurrentSnapshot}),/microweber-site-scope-mismatch/);
});

test("refuses renderer handoff when authored URLs carry credentials or secret query parameters",async()=>{
 for(const href of ["https://preview-user:secret@example.test/path","https://example.test/path?access_token=private"]){
  const snapshot={id:"builder-credential-url",company_id:"co-1",surface:"go",title:"Unsafe link",revision:1,status:"draft",updated_at:"2026-10-03T00:00:00Z",root:{id:"root",type:"stack",children:[{id:"link",type:"text",props:{href,responsive:{mobile:"stack",tablet:"grid",desktop:"grid"}},children:[]}]}};
  const source_snapshot_hash=await computeBrandBuilderSnapshotHash(snapshot);
  await assert.rejects(createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-secret-url",site_id:"site-1",version:1,source_snapshot_hash,renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot,verifyCurrentSnapshot:async()=>true}),/credential-url-denied/);
 }
 const snapshot={id:"builder-queued-url",company_id:"co-1",surface:"go",title:"Staged link",revision:2,status:"draft",updated_at:"2026-10-03T00:00:00Z",root:{id:"root",type:"stack",children:[{id:"link",type:"text",props:{href:"/contact",responsive:{mobile:"stack",tablet:"grid",desktop:"grid"}},children:[]}]}};
 const source_snapshot_hash=await computeBrandBuilderSnapshotHash(snapshot);
 const request=(await createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-queued-url",site_id:"site-1",version:2,source_snapshot_hash,renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot,verifyCurrentSnapshot:async()=>true})).provider_request;
 const document=structuredClone(request.source.document); document.root.children[0].props.href="https://preview-user:secret@example.test/path";
 const tampered={...request,source:{...request.source,document,snapshot_hash:await computeBrandBuilderSnapshotHash(document)}};
 await assert.rejects(assertBrandRendererRequest(tampered,undefined,async()=>true),/credential-url-denied/);
});

test("rejects persisted renderer documents that regain secret-named fields after sanitization",async()=>{
 const snapshot={id:"builder-queued-secret",company_id:"co-1",surface:"go",title:"Staged page",revision:2,status:"draft",updated_at:"2026-10-03T00:00:00Z",root:{id:"root",type:"stack",children:[{id:"link",type:"text",props:{href:"/contact",responsive:{mobile:"stack",tablet:"grid",desktop:"grid"}},children:[]}]}};
 const source_snapshot_hash=await computeBrandBuilderSnapshotHash(snapshot);
 const request=(await createBrandRendererHandoff({company_id:"co-1",publication_id:"pub-queued-secret",site_id:"site-1",version:2,source_snapshot_hash,renderer:"microweber",environment:"preview",route_manifest:["/"],snapshot,verifyCurrentSnapshot:async()=>true})).provider_request;
 const document=structuredClone(request.source.document); document.root.children[0].props.api_key="sk-live-never-render";
 const tampered={...request,source:{...request.source,document}};
 await assert.rejects(assertBrandRendererRequest(tampered,undefined,async()=>true),/document-unsanitized/);
});

test("does not report a provider ACK as published without matching observed company, version, hash and routes",()=>{
 const publication=createBrandPublication({...base,status:"approved"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:true},null),{status:"pending",reason:"awaiting-provider-observation"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,null,null),{status:"degraded",reason:"provider-unavailable"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:false,unavailable:true},null),{status:"degraded",reason:"provider-unavailable"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:true},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"preview",routes:["/","/contact"],reachable:true}),{status:"verified"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:true,admin:true},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"preview",routes:["/","/contact"],reachable:true}),{status:"degraded",reason:"provider-rejected"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:true},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"preview",routes:["/","/contact"],reachable:true,private_key:"must-not-be-ignored"}),{status:"degraded",reason:"observed-publication-mismatch"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:true},{company_id:"co-1",site_id:"site-1",version:2,snapshot_hash:"hash-1",environment:"preview",routes:["/","/contact"],reachable:true}),{status:"degraded",reason:"observed-publication-mismatch"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:true},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"live",routes:["/","/contact"],reachable:true}),{status:"degraded",reason:"observed-publication-mismatch"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:true},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"preview",routes:["/","/other"],reachable:true}),{status:"degraded",reason:"observed-publication-mismatch"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:"true"},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"preview",routes:["/","/contact"],reachable:true}),{status:"degraded",reason:"provider-rejected"});
 assert.deepEqual(reconcileBrandRendererObservation(publication,{accepted:true},{company_id:"co-1",site_id:"site-1",version:1,snapshot_hash:"hash-1",environment:"preview",routes:null,reachable:true}),{status:"degraded",reason:"observed-publication-mismatch"});
});

test("requires an exact Builder approval fingerprint before creating a live renderer handoff",async()=>{
 const snapshot={id:"builder-live-1",company_id:"co-1",surface:"go",title:"Live",revision:2,status:"published",updated_at:"2026-10-03T00:00:00Z",root:{id:"root",type:"stack",children:[]}};
 const source_snapshot_hash="sha256:ebd886ba8af8d235708b32ad1fb5642557e5c1590b869863738bd8f6a512376a";
 const baseInput={company_id:"co-1",publication_id:"pub-live",site_id:"site-1",version:3,source_snapshot_hash,renderer:"microweber",environment:"live",route_manifest:["/"],snapshot,verifyCurrentSnapshot:async()=>true};
 await assert.rejects(createBrandRendererHandoff(baseInput),/approval-required/);
 const approval={company_id:"co-1",builder_document_id:"builder-live-1",revision:2,snapshot_hash:source_snapshot_hash,approved_by:"actor-7",approved_at:"2026-10-03T01:00:00Z"};
 await assert.rejects(createBrandRendererHandoff({...baseInput,approval:{...approval,revision:1},verifyApproval:async()=>true}),/approval-mismatch/);
 await assert.rejects(createBrandRendererHandoff({...baseInput,approval}),/approval-verifier-required/);
 const result=await createBrandRendererHandoff({...baseInput,approval,verifyApproval:async()=>true,verifyCurrentSnapshot:async()=>true});
 assert.equal(result.publication.status,"approved");
 assert.equal(result.provider_request.approval.approved_by,"actor-7");
 await assert.rejects(assertBrandRendererRequest(result.provider_request,undefined,async()=>true),/approval-verifier-required/);
 assert.equal((await assertBrandRendererRequest(result.provider_request,async()=>true,async()=>true)).environment,"live");
});

test("projects company-scoped web surfaces and publications without creating a second estate owner",()=>{
 const descriptor={surface_id:"site-1",company_id:"co-1",surface_class:"PUBLIC_WEB",audience:"public",renderer:"microweber",runtime:"titan-builder",version:"1",route:"/",capabilities:[],lifecycle:"PREVIEW",state:"DECLARED",health:{uiReachable:false,backendReachable:false,capabilityDegraded:false,staleProjection:false,verificationFailed:false},provenance_ref:"pub-1",authorityGranted:false};
 const temporary={...descriptor,surface_id:"mission-site-1",surface_class:"TEMPORARY_MISSION",temporary:{expires_at:"2026-10-04T00:00:00Z",end_condition:"mission-closed"}};
 const publication=createBrandPublication({...base,status:"approved"});
 const projection=createBrandStudioProjection({company_id:"co-1",generated_at:"2026-10-03T02:00:00Z",surfaces:[descriptor,temporary],publications:[publication]});
 assert.deepEqual(assertBrandStudioProjection(projection,"co-1").surfaces.map(surface=>surface.surface_id),["mission-site-1","site-1"]);
 assert.equal(projection.publications[0].publication_id,"pub-1");
 assert.match(summarizeBrandStudioProjection(projection,"co-1"),/site-1 \(microweber v1, DECLARED\) \/;/);
 assert.throws(()=>createBrandStudioProjection({company_id:"co-1",generated_at:"2026-10-03T02:00:00Z",surfaces:[descriptor],publications:[publication,createBrandPublication({...base,publication_id:"pub-duplicate-version",status:"approved"})]}),/duplicate-version/);
 assert.throws(()=>createBrandStudioProjection({company_id:"co-1",generated_at:"2026-10-03T02:00:00Z",surfaces:[{...descriptor,company_id:"co-2"}],publications:[publication]}),/cross-company-denied/);
 assert.throws(()=>createBrandStudioProjection({company_id:"co-1",generated_at:"2026-10-03T02:00:00Z",surfaces:[{...descriptor,private_key:"never"}],publications:[publication]}),/unknown-field/);
 assert.throws(()=>createBrandStudioProjection({company_id:"co-1",generated_at:"2026-10-03T02:00:00Z",surfaces:[descriptor],publications:[{...publication,company_id:"co-2"}]}),/company-mismatch/);
 assert.throws(()=>assertBrandStudioProjection({...projection,company_id:"co-2"},"co-1"),/company-mismatch/);
 assert.throws(()=>assertBrandStudioProjection({...projection,surfaces:[{...projection.surfaces[0],state:"HEALTHY"}]},"co-1"),/surface-state-invalid/);
 assert.throws(()=>assertBrandStudioProjection({...projection,execute_php:"<?php"},"co-1"),/unknown-field/);
});

test("summarizes only observed live surfaces and separates drift from unverified sites",()=>{
 const makeSurface=(surface_id,version)=>({surface_id,company_id:"co-1",surface_class:"PUBLIC_WEB",audience:"public",renderer:"microweber",runtime:"titan-builder",version,route:"/",capabilities:[],lifecycle:"VERIFY",state:"STAGED",health:{uiReachable:false,backendReachable:false,capabilityDegraded:false,staleProjection:false,verificationFailed:false},provenance_ref:`publication:${surface_id}`,authorityGranted:false});
 const projection=createBrandStudioProjection({company_id:"co-1",generated_at:"2026-10-03T02:00:00Z",surfaces:[makeSurface("live-site","1"),makeSurface("drifted-site","2"),makeSurface("unverified-site","3")],publications:[],deployed:{"live-site":{version:"1",state:"LIVE",uiReachable:true,backendReachable:true},"drifted-site":{version:"1",state:"LIVE",uiReachable:true,backendReachable:true}}});
 const summary=summarizeBrandStudioProjection(projection,"co-1");
 assert.match(summary,/1 live/);
 assert.match(summary,/1 needs attention/);
 assert.match(summary,/1 awaiting verification/);
 assert.match(summary,/drifted-site.*DEGRADED/);
 assert.match(summary,/unverified-site.*DECLARED/);
});

test("action bindings declare canonical governance requirements but cannot grant authority",()=>{
 const binding=createBrandActionBinding({schema:"titan.brand-action-binding/v1",action_id:"booking.request",capability_id:"booking",context_schema:"titan.booking-context/v1",required_context:["company_id","principal_ref","surface_id"],entitlement:"booking.request",risk_class:"consequential",offline_behavior:"queue_for_revalidation",public_behavior:"guest_scoped",fallback:"show_contact",accessibility:{keyboard:true,screen_reader_label:"Request booking",reduced_motion:true},evidence_requirements:["booking-request-receipt"],authority_granted:false});
 assert.equal(binding.capability_id,"booking"); assert.equal(binding.authority_granted,false);
 assert.throws(()=>createBrandActionBinding({...binding,authority_granted:true}),/authority-denied/);
 assert.throws(()=>createBrandActionBinding({...binding,execute_php:"<?php"}),/unknown-field/);
 assert.throws(()=>createBrandActionBinding({...binding,offline_behavior:"execute_immediately"}),/offline-behavior-invalid/);
 assert.throws(()=>createBrandActionBinding({...binding,accessibility:{...binding.accessibility,screen_reader_label:""}}),/accessibility-invalid/);
 assert.throws(()=>createBrandActionBinding({...binding,required_context:["company_id","company_id"]}),/context-invalid/);
});

test("publication idempotency identity validates its logical scope",async()=>{
 const key=await computeBrandPublicationIdempotencyKey({company_id:"co-1",site_id:"site-1",version:1,environment:"preview"});
 assert.equal(key,await computeBrandPublicationIdempotencyKey({company_id:"co-1",site_id:"site-1",version:1,environment:"preview"}));
 await assert.rejects(computeBrandPublicationIdempotencyKey({company_id:"co-1",site_id:"site-1",version:0,environment:"preview"}),/version-invalid/);
 await assert.rejects(computeBrandPublicationIdempotencyKey({company_id:"co-1",site_id:"site-1",version:1,environment:"production"}),/environment-invalid/);
});



test("builds a deterministic escaped sitemap for live drafts and blocks preview crawlers",async()=>{
 const page=route=>({company_id:"co-1",publication_id:"pub-1",site_id:"site-1",version:2,route,authority_granted:false});
 const site={schema:"titan.microweber-site-draft/v1",company_id:"co-1",publication_id:"pub-1",site_id:"site-1",version:2,environment:"live",routes:["/","/about&team"],pages:[page("/"),page("/about&team")],source_snapshot_hash:"sha256:"+"a".repeat(64),authority_granted:false};
 const live=createMicroweberSitemapDraft(site,"https://brand.example");
 assert.equal(live.schema,"titan.microweber-seo-draft/v1");
 assert.equal(live.company_id,"co-1");
 assert.equal(live.sitemap_xml,'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://brand.example/</loc></url><url><loc>https://brand.example/about&amp;team</loc></url></urlset>');
 assert.equal(live.robots_txt,"User-agent: *\nAllow: /\nSitemap: https://brand.example/sitemap.xml\n");
 assert.equal(live.authority_granted,false);
 const slashOrigin=createMicroweberSitemapDraft(site,"https://brand.example/");
 assert.equal(slashOrigin.robots_txt,live.robots_txt);
 const preview=createMicroweberSitemapDraft({...site,environment:"preview"},"https://preview.example");
 assert.equal(preview.sitemap_xml,"");
 assert.equal(preview.robots_txt,"User-agent: *\nDisallow: /\n");
 assert.throws(()=>createMicroweberSitemapDraft({...site,routes:["/","/"]},"https://brand.example"),/duplicate-route/);
 assert.throws(()=>createMicroweberSitemapDraft({...site,company_id:"co-2"},"https://brand.example"),/company/);
 for(const origin of ["http://brand.example","https://user:secret@brand.example","https://brand.example/path","https://brand.example?token=secret"])
  assert.throws(()=>createMicroweberSitemapDraft(site,origin),/origin-invalid/);
});
