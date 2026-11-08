import type {StorageContextInput,StorageRecord} from "../storage/index.js";
import {createCompanyRelationship,type CompanyRelationship} from "./contracts.js";
import {createPersonalZeroStateService as createBasePersonalZeroStateService} from "./state-service.js";

type Repository=Readonly<{
  put(context:StorageContextInput,input:Readonly<{module_id:string;collection:string;record_id:string;expected_revision?:number;data?:unknown}>):Promise<StorageRecord>;
  get(context:StorageContextInput,module_id:string,collection:string,record_id:string):Promise<StorageRecord|null>;
  list(context:StorageContextInput,query?:Readonly<{module_id?:string;collection?:string}>):Promise<readonly StorageRecord[]>;
}>;

const MODULE_ID="personal-zero";
const RELATIONSHIPS="relationships";
const recordData=<T>(row:StorageRecord):T|null=>row.data?structuredClone(row.data) as T:null;

export function createPersonnelBoundedPersonalZeroStateService({repository,clock=()=>Date.now()}:{repository:Repository;clock?:()=>number}){
  const base=createBasePersonalZeroStateService({repository,clock});
  return Object.freeze({
    ...base,
    async putRelationship(context:StorageContextInput,input:CompanyRelationship){
      const candidate=createCompanyRelationship(input);
      const rows=await repository.list(context,{module_id:MODULE_ID,collection:RELATIONSHIPS});
      for(const row of rows){
        const existing=recordData<CompanyRelationship>(row);
        if(!existing||existing.relationship_id===candidate.relationship_id)continue;
        if(existing.one_id===candidate.one_id&&existing.zero_id!==candidate.zero_id)throw new Error("One cannot be bound to a different Zero");
        if(existing.zero_id===candidate.zero_id&&existing.one_id!==candidate.one_id)throw new Error("Zero cannot be bound to a different One");
      }
      return base.putRelationship(context,candidate);
    },
  });
}
