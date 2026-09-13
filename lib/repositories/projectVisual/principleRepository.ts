import { calculateCascadeImpact,type CascadeInput,type PrincipleSceneLink,type PrincipleShotLink,type VisualPrincipleStatus } from "../../domain/projectVisual";
import type { QueryExecutor,TransactionExecutor } from "./db";
import { CascadeImpactRepository } from "./cascadeImpactRepository";
import { DecisionLineageRepository } from "./decisionLineageRepository";
import { ProjectRepository } from "./projectRepository";
import { toIsoString,type TimestampValue,type VisualPrincipleRecord,type VisualPrincipleVersionRecord } from "./types";

type PrincipleRow={id:string;project_id:string;title:string;status:VisualPrincipleStatus;current_version_id:string|null;created_at:TimestampValue;updated_at:TimestampValue};
type VersionRow={id:string;principle_id:string;version_number:number;principle_text:string;rationale:string;change_summary:string|null;evidence_json:unknown[];source_question_id:string|null;content_hash:string;created_by:string|null;created_at:TimestampValue};
const mapPrinciple=(r:PrincipleRow):VisualPrincipleRecord=>({id:r.id,projectId:r.project_id,title:r.title,status:r.status,currentVersionId:r.current_version_id,createdAt:toIsoString(r.created_at)!,updatedAt:toIsoString(r.updated_at)!});
const mapVersion=(r:VersionRow):VisualPrincipleVersionRecord=>({id:r.id,principleId:r.principle_id,versionNumber:r.version_number,principleText:r.principle_text,rationale:r.rationale,changeSummary:r.change_summary,evidence:r.evidence_json,sourceQuestionId:r.source_question_id,contentHash:r.content_hash,createdBy:r.created_by,createdAt:toIsoString(r.created_at)!});
export type PrincipleVersionWrite={id:string;principleId:string;versionNumber:number;principleText:string;rationale:string;changeSummary?:string|null;evidence?:unknown[];sourceQuestionId?:string|null;contentHash:string;createdBy?:string|null};
export type PrincipleVersionUpdate={
  projectId:string; version:PrincipleVersionWrite; sceneLinks:Array<{sceneId:string;reason:string;evidence?:unknown[]}>;
  shotLinks:Array<{shotId:string;reason:string;evidence?:unknown[]}>; cascadeInput:CascadeInput;
  impactIdFor:(targetId:string,index:number)=>string; lineage?:{id:string;previousVersionId:string};
};
async function insertVersion(db:QueryExecutor,i:PrincipleVersionWrite):Promise<VisualPrincipleVersionRecord>{const[r]=await db.query<VersionRow>("INSERT INTO visual_principle_versions (id,principle_id,version_number,principle_text,rationale,change_summary,evidence_json,source_question_id,content_hash,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING *",[i.id,i.principleId,i.versionNumber,i.principleText,i.rationale,i.changeSummary??null,JSON.stringify(i.evidence??[]),i.sourceQuestionId??null,i.contentHash,i.createdBy??null]);return mapVersion(r);}
export class PrincipleRepository{
  constructor(private readonly db:TransactionExecutor){}
  async create(i:{id:string;projectId:string;title:string;status?:VisualPrincipleStatus}):Promise<VisualPrincipleRecord>{const[r]=await this.db.query<PrincipleRow>("INSERT INTO visual_principles (id,project_id,title,status) VALUES ($1,$2,$3,$4) RETURNING *",[i.id,i.projectId,i.title,i.status??"candidate"]);return mapPrinciple(r);}
  async get(id:string):Promise<VisualPrincipleRecord|null>{const[r]=await this.db.query<PrincipleRow>("SELECT * FROM visual_principles WHERE id=$1",[id]);return r?mapPrinciple(r):null;}
  async getVersion(id:string):Promise<VisualPrincipleVersionRecord|null>{const[r]=await this.db.query<VersionRow>("SELECT * FROM visual_principle_versions WHERE id=$1",[id]);return r?mapVersion(r):null;}
  appendVersion(i:PrincipleVersionWrite):Promise<VisualPrincipleVersionRecord>{return insertVersion(this.db,i);}
  async setCurrentVersion(principleId:string,versionId:string):Promise<void>{const rows=await this.db.query<{id:string}>("UPDATE visual_principles SET current_version_id=$2,updated_at=now() WHERE id=$1 RETURNING id",[principleId,versionId]);if(rows.length!==1)throw new Error(`Principle not found: ${principleId}`);}
  async setStatus(principleId:string,status:VisualPrincipleStatus):Promise<void>{const rows=await this.db.query<{id:string}>("UPDATE visual_principles SET status=$2,updated_at=now() WHERE id=$1 RETURNING id",[principleId,status]);if(rows.length!==1)throw new Error(`Principle not found: ${principleId}`);}
  async linkScenes(versionId:string,links:PrincipleVersionUpdate["sceneLinks"],db:QueryExecutor=this.db):Promise<void>{for(const link of links)await db.query("INSERT INTO principle_scene_links (principle_version_id,scene_id,link_reason,evidence_json) VALUES ($1,$2,$3,$4::jsonb)",[versionId,link.sceneId,link.reason,JSON.stringify(link.evidence??[])]);}
  async linkShots(versionId:string,links:PrincipleVersionUpdate["shotLinks"],db:QueryExecutor=this.db):Promise<void>{for(const link of links)await db.query("INSERT INTO principle_shot_links (principle_version_id,shot_id,link_reason,evidence_json) VALUES ($1,$2,$3,$4::jsonb)",[versionId,link.shotId,link.reason,JSON.stringify(link.evidence??[])]);}
  async updateVersion(i:PrincipleVersionUpdate):Promise<VisualPrincipleVersionRecord>{
    if(i.cascadeInput.afterVersion.id!==i.version.id||i.cascadeInput.afterVersion.principleId!==i.version.principleId)throw new Error("Cascade afterVersion must match the persisted version");
    return this.db.transaction(async tx=>{
      const version=await insertVersion(tx,i.version);
      const pointer=await tx.query<{id:string}>("UPDATE visual_principles SET current_version_id=$2,updated_at=now() WHERE id=$1 RETURNING id",[i.version.principleId,i.version.id]);
      if(pointer.length!==1)throw new Error(`Principle not found: ${i.version.principleId}`);
      await this.linkScenes(i.version.id,i.sceneLinks,tx);await this.linkShots(i.version.id,i.shotLinks,tx);
      const expectedSceneLinks:PrincipleSceneLink[]=i.sceneLinks.map(link=>({principleVersionId:i.version.id,sceneId:link.sceneId}));
      const expectedShotLinks:PrincipleShotLink[]=i.shotLinks.map(link=>({principleVersionId:i.version.id,shotId:link.shotId}));
      const impacts=calculateCascadeImpact({...i.cascadeInput,principleSceneLinks:expectedSceneLinks,principleShotLinks:expectedShotLinks});
      await new CascadeImpactRepository(tx).insertMany({projectId:i.projectId,principleVersionId:i.version.id,changeType:i.cascadeInput.changeType,impacts,idFor:(impact,index)=>i.impactIdFor(impact.targetId,index)});
      const projects=new ProjectRepository(tx);
      for(const impact of impacts){if(impact.targetNewStatus==="review_required")await projects.setSceneReviewStatus(impact.targetId,"review_required");if(impact.targetNewStatus==="restale")await projects.setShotStatus(impact.targetId,"restale");}
      if(i.lineage)await new DecisionLineageRepository(tx).create({id:i.lineage.id,projectId:i.projectId,sourceType:"principle_version",sourceId:i.lineage.previousVersionId,relation:"versioned_into",targetType:"principle_version",targetId:i.version.id});
      return version;
    });
  }
}
