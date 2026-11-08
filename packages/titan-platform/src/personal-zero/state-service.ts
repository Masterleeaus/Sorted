import { assertNoLegacyStorageBoundary, type StorageContextInput, type StorageRecord } from "../storage/index.js";
import type { VerifiedOutcome } from "../workforce-evidence/contracts.js";
import { proposeLearningFromCorrection, proposeLearningFromPredictionError, proposeLearningFromVerifiedOutcome, assertLearningProposalAuthorityNeutral, type PersonalZeroLearningProposal } from "./learning-governor-bridge.js";
import { createLearningProposalRecord, reviewLearningProposal, supersedeLearningProposal, type LearningProposalRecord } from "./learning-review.js";
import { createAcceptedLearningAdjustment, type LearningConsumer } from "./learning-consumption.js";
import { validateTargetShareAcceptance, type TargetShareAcceptance } from "./share-acceptance.js";
import {
  createCompanyRelationship,
  createUnderstandingState,
  createUnderstandingEvidence,
  type CompanyRelationship,
  type UnderstandingEvidence,
  type UnderstandingState,
  createExperienceRecord,
  createCognitiveEvent,
  type ExperienceRecord,
  type CognitiveEvent,
  createCrossContextShareGrant,
  scorePrediction,
  isFresh,
  type CrossContextShareGrant,
} from "./contracts.js";

const MODULE_ID="personal-zero";
const RELATIONSHIPS="relationships";
const EVIDENCE="understanding-evidence";
const UNDERSTANDING="understanding";
const EXPERIENCES="experiences";
const COGNITIVE_EVENTS="cognitive-events";
const SHARE_GRANTS="cross-context-share-grants";
const CALIBRATIONS="prediction-calibrations";
const LEARNING_PROPOSALS="learning-proposals";

type Repository=Readonly<{
  put(context:StorageContextInput,input:Readonly<{module_id:string;collection:string;record_id:string;expected_revision?:number;data?:unknown}>):Promise<StorageRecord>;
  get(context:StorageContextInput,module_id:string,collection:string,record_id:string):Promise<StorageRecord|null>;
  list(context:StorageContextInput,query?:Readonly<{module_id?:string;collection?:string}>):Promise<readonly StorageRecord[]>;
}>;

function requireRelationshipMatch(relationship:CompanyRelationship,one_id:string,zero_id:string,company_id:string){
  if(relationship.one_id!==one_id||relationship.zero_id!==zero_id||relationship.company_id!==company_id)throw new Error("Personal Zero relationship identity/company mismatch");
  if(relationship.status!=="active")throw new Error("Personal Zero relationship is revoked");
}
function recordData<T>(row:StorageRecord|null):T|null{return row?.data?structuredClone(row.data) as T:null}
function guardInput(value:unknown,label:string){assertNoLegacyStorageBoundary(value,label)}
function requireContextCompany(context:StorageContextInput,company_id:string){if(String(context.company_id??"").trim()!==company_id)throw new Error("Personal Zero context company mismatch")}

export function createPersonalZeroStateService({repository,clock=()=>Date.now()}:{repository:Repository;clock?:()=>number}){
  if(!repository?.put||!repository?.get||!repository?.list)throw new Error("Canonical Titan storage repository is required");
  return Object.freeze({
    descriptor:Object.freeze({protocol:"titan.personal-zero.state.v1",module_id:MODULE_ID,company_boundary:"company_id",authority_neutral:true,execution_authority:false}),

    async putRelationship(context:StorageContextInput,input:CompanyRelationship){
      guardInput(input,"personal_zero.relationship");requireContextCompany(context,input.company_id);
      const relationship=createCompanyRelationship(input);
      return repository.put(context,{module_id:MODULE_ID,collection:RELATIONSHIPS,record_id:relationship.relationship_id,data:relationship});
    },

    async revokeRelationship(context:StorageContextInput,relationship_id:string){
      const row=await repository.get(context,MODULE_ID,RELATIONSHIPS,relationship_id);
      const current=recordData<CompanyRelationship>(row);
      if(!row||!current)throw new Error("Personal Zero relationship not found");
      const revoked=createCompanyRelationship({...current,status:"revoked",revoked_at:Number(clock())});
      return repository.put(context,{module_id:MODULE_ID,collection:RELATIONSHIPS,record_id:relationship_id,expected_revision:row.version,data:revoked});
    },

    async putUnderstandingEvidence(context:StorageContextInput,input:Omit<UnderstandingEvidence,"schema"|"version">){
      guardInput(input,"personal_zero.understanding_evidence");requireContextCompany(context,input.company_id);
      if(!input.relationship_id)throw new Error("Company-scoped understanding evidence requires relationship_id");
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,input.relationship_id));
      if(!relationship)throw new Error("Personal Zero relationship not found");
      requireRelationshipMatch(relationship,input.one_id,input.zero_id,input.company_id);
      const evidenceRecord=createUnderstandingEvidence(input);
      const row=await repository.put(context,{module_id:MODULE_ID,collection:EVIDENCE,record_id:evidenceRecord.understanding_evidence_id,data:evidenceRecord});
      if(input.correction_of){
        const proposal=assertLearningProposalAuthorityNeutral(proposeLearningFromCorrection(evidenceRecord));
        await repository.put(context,{module_id:MODULE_ID,collection:LEARNING_PROPOSALS,record_id:"correction:"+evidenceRecord.understanding_evidence_id,data:createLearningProposalRecord(proposal,{proposal_id:"correction:"+evidenceRecord.understanding_evidence_id,created_at:Number(clock())})});
      }
      return row;
    },

    async promoteUnderstanding(context:StorageContextInput,input:Omit<UnderstandingState,"schema"|"schema_version">){
      guardInput(input,"personal_zero.understanding");requireContextCompany(context,input.company_id);
      if(input.status!=="candidate"&&input.status!=="accepted")throw new Error("Promotion status must be candidate or accepted");
      if(!input.relationship_id)throw new Error("Company-scoped understanding requires relationship_id");
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,input.relationship_id));
      if(!relationship)throw new Error("Personal Zero relationship not found");
      requireRelationshipMatch(relationship,input.one_id,input.zero_id,input.company_id);
      for(const evidenceId of input.evidence_refs){
        const evidence=recordData<UnderstandingEvidence>(await repository.get(context,MODULE_ID,EVIDENCE,evidenceId));
        if(!evidence)throw new Error(`Understanding evidence not found: ${evidenceId}`);
        if(evidence.one_id!==input.one_id||evidence.zero_id!==input.zero_id||evidence.company_id!==input.company_id||evidence.relationship_id!==input.relationship_id)throw new Error("Cross-context understanding evidence rejected");
      }
      const state=createUnderstandingState(input);
      return repository.put(context,{module_id:MODULE_ID,collection:UNDERSTANDING,record_id:state.understanding_id,data:state});
    },

    async correctUnderstanding(context:StorageContextInput,current_id:string,replacement:Omit<UnderstandingState,"schema"|"schema_version">){
      const priorRow=await repository.get(context,MODULE_ID,UNDERSTANDING,current_id);
      const prior=recordData<UnderstandingState>(priorRow);
      if(!priorRow||!prior)throw new Error("Understanding state not found");
      if(replacement.supersedes_understanding_id!==current_id)throw new Error("Correction must preserve supersession lineage");
      if(prior.one_id!==replacement.one_id||prior.zero_id!==replacement.zero_id||prior.company_id!==replacement.company_id||prior.relationship_id!==replacement.relationship_id)throw new Error("Cross-context correction rejected");
      const next=await this.promoteUnderstanding(context,replacement);
      const superseded=createUnderstandingState({...prior,status:"superseded",updated_at:Number(clock())});
      await repository.put(context,{module_id:MODULE_ID,collection:UNDERSTANDING,record_id:current_id,expected_revision:priorRow.version,data:superseded});
      return next;
    },

    async putExperience(context:StorageContextInput,input:Omit<ExperienceRecord,"schema"|"version">,verifiedOutcome?:Readonly<{company_id:string;outcome_id:string;verified:boolean;receipt_refs:readonly string[]}>){
      guardInput(input,"personal_zero.experience");guardInput(verifiedOutcome,"personal_zero.verified_outcome");requireContextCompany(context,input.company_id);
      if(!input.relationship_id)throw new Error("Company-scoped experience requires relationship_id");
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,input.relationship_id));
      if(!relationship)throw new Error("Personal Zero relationship not found");
      requireRelationshipMatch(relationship,input.one_id,input.zero_id,input.company_id);
      if(input.actual_outcome!=null){
        if(!verifiedOutcome||!verifiedOutcome.verified||verifiedOutcome.company_id!==input.company_id||verifiedOutcome.outcome_id!==input.verified_outcome_ref||verifiedOutcome.receipt_refs.length===0)throw new Error("Verified outcome proof required for actual outcome");
      }
      const experience=createExperienceRecord(input);
      return repository.put(context,{module_id:MODULE_ID,collection:EXPERIENCES,record_id:experience.experience_id,data:experience});
    },

    async appendCognitiveEvent(context:StorageContextInput,input:Omit<CognitiveEvent,"authority_neutral"|"execution_authority">){
      guardInput(input,"personal_zero.cognitive_event");requireContextCompany(context,input.company_id);
      if(!input.relationship_id)throw new Error("Company-scoped cognitive event requires relationship_id");
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,input.relationship_id));
      if(!relationship)throw new Error("Personal Zero relationship not found");
      requireRelationshipMatch(relationship,input.one_id,input.zero_id,input.company_id);
      const event=createCognitiveEvent(input);
      return repository.put(context,{module_id:MODULE_ID,collection:COGNITIVE_EVENTS,record_id:event.event_id,data:event});
    },

    async scorePredictionOutcome(context:StorageContextInput,input:{relationship_id:string;prediction_event_id:string;outcome_event_id:string;predicted_probability:number;actual:boolean;scored_at?:number}){
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,input.relationship_id));
      if(!relationship||relationship.status!=="active")throw new Error("Personal Zero relationship not active");
      const prediction=recordData<CognitiveEvent>(await repository.get(context,MODULE_ID,COGNITIVE_EVENTS,input.prediction_event_id));
      const outcome=recordData<CognitiveEvent>(await repository.get(context,MODULE_ID,COGNITIVE_EVENTS,input.outcome_event_id));
      if(!prediction||prediction.type!=="prediction"||!outcome||outcome.type!=="outcome")throw new Error("Prediction and outcome events are required");
      for(const event of [prediction,outcome])requireRelationshipMatch(relationship,event.one_id,event.zero_id,event.company_id);
      if(prediction.relationship_id!==input.relationship_id||outcome.relationship_id!==input.relationship_id)throw new Error("Cross-context prediction calibration rejected");
      const calibration=scorePrediction(input);
      const row=await repository.put(context,{module_id:MODULE_ID,collection:CALIBRATIONS,record_id:input.prediction_event_id+":"+input.outcome_event_id,data:{...calibration,company_id:relationship.company_id,one_id:relationship.one_id,zero_id:relationship.zero_id,relationship_id:input.relationship_id}});
      const proposal=proposeLearningFromPredictionError({company_id:relationship.company_id,one_id:relationship.one_id,zero_id:relationship.zero_id,relationship_id:input.relationship_id,calibration});
      if(proposal)await repository.put(context,{module_id:MODULE_ID,collection:LEARNING_PROPOSALS,record_id:"prediction:"+input.prediction_event_id+":"+input.outcome_event_id,data:createLearningProposalRecord(assertLearningProposalAuthorityNeutral(proposal),{proposal_id:"prediction:"+input.prediction_event_id+":"+input.outcome_event_id,created_at:Number(clock())})});
      return row;
    },

    async proposeLearningFromVerifiedOutcome(context:StorageContextInput,input:{one_id:string;zero_id:string;relationship_id:string;outcome:VerifiedOutcome}){
      guardInput(input,"personal_zero.learning_outcome");requireContextCompany(context,input.outcome.company_id);
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,input.relationship_id));
      if(!relationship)throw new Error("Personal Zero relationship not found");
      requireRelationshipMatch(relationship,input.one_id,input.zero_id,input.outcome.company_id);
      const proposal=assertLearningProposalAuthorityNeutral(proposeLearningFromVerifiedOutcome(input));
      return repository.put(context,{module_id:MODULE_ID,collection:LEARNING_PROPOSALS,record_id:"outcome:"+input.outcome.outcome_id,data:createLearningProposalRecord(proposal,{proposal_id:"outcome:"+input.outcome.outcome_id,created_at:Number(clock())})});
    },

    async listLearningProposals(context:StorageContextInput,relationship_id:string){
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,relationship_id));
      if(!relationship||relationship.status!=="active")return [];
      const rows=await repository.list(context,{module_id:MODULE_ID,collection:LEARNING_PROPOSALS});
      return rows.map(r=>recordData<LearningProposalRecord>(r)).filter(p=>Boolean(p&&p.company_id===relationship.company_id&&p.one_id===relationship.one_id&&p.zero_id===relationship.zero_id&&p.relationship_id===relationship_id));
    },

    async reviewLearningProposal(context:StorageContextInput,proposal_id:string,input:{status:"accepted"|"rejected";reviewer_id:string;review_evidence_refs:readonly string[];review_reason:string}){
      const row=await repository.get(context,MODULE_ID,LEARNING_PROPOSALS,proposal_id);
      const current=recordData<LearningProposalRecord>(row);
      if(!row||!current)throw new Error("Learning proposal not found");
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,current.relationship_id));
      if(!relationship)throw new Error("Personal Zero relationship not found");
      requireRelationshipMatch(relationship,current.one_id,current.zero_id,current.company_id);
      const reviewed=reviewLearningProposal(current,{...input,reviewed_at:Number(clock())});
      return repository.put(context,{module_id:MODULE_ID,collection:LEARNING_PROPOSALS,record_id:proposal_id,expected_revision:row.version,data:reviewed});
    },

    async supersedeLearningProposal(context:StorageContextInput,proposal_id:string,reason:string){
      const row=await repository.get(context,MODULE_ID,LEARNING_PROPOSALS,proposal_id);
      const current=recordData<LearningProposalRecord>(row);
      if(!row||!current)throw new Error("Learning proposal not found");
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,current.relationship_id));
      if(!relationship)throw new Error("Personal Zero relationship not found");
      requireRelationshipMatch(relationship,current.one_id,current.zero_id,current.company_id);
      const superseded=supersedeLearningProposal(current,{superseded_at:Number(clock()),reason});
      return repository.put(context,{module_id:MODULE_ID,collection:LEARNING_PROPOSALS,record_id:proposal_id,expected_revision:row.version,data:superseded});
    },

    async getAcceptedLearning(context:StorageContextInput,relationship_id:string,consumer:LearningConsumer){
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,relationship_id));
      if(!relationship||relationship.status!=="active")return [];
      const rows=await repository.list(context,{module_id:MODULE_ID,collection:LEARNING_PROPOSALS});
      return rows.map(r=>recordData<LearningProposalRecord>(r))
        .filter((p):p is LearningProposalRecord=>Boolean(p&&p.status==="accepted"&&p.company_id===relationship.company_id&&p.one_id===relationship.one_id&&p.zero_id===relationship.zero_id&&p.relationship_id===relationship_id))
        .map(p=>createAcceptedLearningAdjustment(p,consumer));
    },

    async putCrossContextShareGrant(context:StorageContextInput,input:Omit<CrossContextShareGrant,"authority_neutral"|"allow_personal_private"> & {allow_personal_private?:false}){
      guardInput(input,"personal_zero.share_grant");
      const grant=createCrossContextShareGrant(input);
      if(context.company_id!==grant.source_company_id)throw new Error("Share grant must be created from source company context");
      const source=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,grant.source_relationship_id));
      if(!source)throw new Error("Source relationship not found");
      requireRelationshipMatch(source,grant.one_id,grant.zero_id,grant.source_company_id);
      const evidenceRows=await repository.list(context,{module_id:MODULE_ID,collection:EVIDENCE});
      const states=await repository.list(context,{module_id:MODULE_ID,collection:UNDERSTANDING});
      const accepted=states.map(r=>recordData<UnderstandingState>(r)).filter((x):x is UnderstandingState=>Boolean(x&&x.relationship_id===grant.source_relationship_id&&x.status==="accepted"&&grant.subject_refs.includes(x.subject)));
      for(const subject of grant.subject_refs){
        const matching=accepted.filter(x=>x.subject===subject);
        if(!matching.length)throw new Error("Share grant subject is not accepted in source context");
        for(const state of matching)for(const ref of state.evidence_refs){
          const evidence=evidenceRows.map(r=>recordData<UnderstandingEvidence>(r)).find(e=>e?.understanding_evidence_id===ref);
          if(!evidence||evidence.relationship_id!==grant.source_relationship_id)throw new Error("Share grant evidence lineage invalid");
          if(evidence.privacy_class==="personal_private")throw new Error("personal_private understanding requires a stronger consent contract");
        }
      }
      return repository.put(context,{module_id:MODULE_ID,collection:SHARE_GRANTS,record_id:grant.grant_id,data:grant});
    },

    async revokeCrossContextShareGrant(context:StorageContextInput,grant_id:string){
      const row=await repository.get(context,MODULE_ID,SHARE_GRANTS,grant_id);
      const grant=recordData<CrossContextShareGrant>(row);
      if(!row||!grant)throw new Error("Share grant not found");
      requireContextCompany(context,grant.source_company_id);
      const revoked=createCrossContextShareGrant({...grant,revoked_at:Number(clock())});
      return repository.put(context,{module_id:MODULE_ID,collection:SHARE_GRANTS,record_id:grant_id,expected_revision:row.version,data:revoked});
    },

    async getSharedUnderstanding(context:StorageContextInput,source_company_id:string,grant_id:string,targetAcceptance:TargetShareAcceptance,now=Date.now()){
      guardInput(targetAcceptance,"personal_zero.target_share_acceptance");
      if(context.company_id!==source_company_id)throw new Error("Shared understanding lookup must use source company context");
      const grant=recordData<CrossContextShareGrant>(await repository.get(context,MODULE_ID,SHARE_GRANTS,grant_id));
      if(!grant||grant.source_company_id!==source_company_id||grant.revoked_at!=null||(grant.expires_at!=null&&grant.expires_at<=now))return [];
      if(!validateTargetShareAcceptance(grant,targetAcceptance,now))return [];
      const source=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,grant.source_relationship_id));
      if(!source||source.status!=="active")return [];
      const [rows,evidenceRows]=await Promise.all([repository.list(context,{module_id:MODULE_ID,collection:UNDERSTANDING}),repository.list(context,{module_id:MODULE_ID,collection:EVIDENCE})]);
      const evidence=new Map(evidenceRows.map(r=>recordData<UnderstandingEvidence>(r)).filter((e):e is UnderstandingEvidence=>Boolean(e)).map(e=>[e.understanding_evidence_id,e]));
      return rows.map(r=>recordData<UnderstandingState>(r)).filter((state):state is UnderstandingState=>Boolean(state&&state.relationship_id===grant.source_relationship_id&&state.status==="accepted"&&grant.subject_refs.includes(state.subject)&&state.evidence_refs.some(ref=>{const e=evidence.get(ref);return e&&e.privacy_class!=="personal_private"&&isFresh(e.fresh_until,now)})));
    },

    async getConsumerProjection(context:StorageContextInput,relationship_id:string,consumer:"interaction"|"decision"|"workforce"){
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,relationship_id));
      if(!relationship||relationship.status!=="active")return null;
      const [understandingRows,experienceRows,eventRows]=await Promise.all([
        repository.list(context,{module_id:MODULE_ID,collection:UNDERSTANDING}),
        repository.list(context,{module_id:MODULE_ID,collection:EXPERIENCES}),
        repository.list(context,{module_id:MODULE_ID,collection:COGNITIVE_EVENTS}),
      ]);
      const same=<T extends {one_id:string;zero_id:string;company_id:string;relationship_id:string|null}>(x:T|null):x is T=>Boolean(x&&x.one_id===relationship.one_id&&x.zero_id===relationship.zero_id&&x.company_id===relationship.company_id&&x.relationship_id===relationship_id);
      const now=Number(clock());
      const evidenceRows=await repository.list(context,{module_id:MODULE_ID,collection:EVIDENCE});
      const freshEvidence=new Set(evidenceRows.map(r=>recordData<UnderstandingEvidence>(r)).filter(e=>e&&same(e)&&isFresh(e.fresh_until,now)).map(e=>e!.understanding_evidence_id));
      const understanding=understandingRows.map(r=>recordData<UnderstandingState>(r)).filter(s=>same(s)&&s.status==="accepted"&&s.evidence_refs.some(ref=>freshEvidence.has(ref)));
      const experiences=experienceRows.map(r=>recordData<ExperienceRecord>(r)).filter(same);
      const events=eventRows.map(r=>recordData<CognitiveEvent>(r)).filter(same);
      return Object.freeze({protocol:"titan.personal-zero.projection.v1",consumer,company_id:relationship.company_id,one_id:relationship.one_id,zero_id:relationship.zero_id,relationship_id,understanding:Object.freeze(understanding),experiences:Object.freeze(experiences),cognitive_events:Object.freeze(events),authority_refs:Object.freeze([...relationship.authority_refs]),authority_neutral:true,execution_authority:false});
    },

    async listUnderstanding(context:StorageContextInput,relationship_id:string){
      const relationship=recordData<CompanyRelationship>(await repository.get(context,MODULE_ID,RELATIONSHIPS,relationship_id));
      if(!relationship||relationship.status!=="active")return [];
      const rows=await repository.list(context,{module_id:MODULE_ID,collection:UNDERSTANDING});
      return rows.map(row=>recordData<UnderstandingState>(row)).filter((state):state is UnderstandingState=>Boolean(state&&state.relationship_id===relationship_id&&state.company_id===relationship.company_id&&state.one_id===relationship.one_id&&state.zero_id===relationship.zero_id&&state.status!=="deleted"&&state.status!=="expired"));
    }
  });
}
