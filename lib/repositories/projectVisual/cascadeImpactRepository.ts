import type { CascadeChangeType,CascadeImpact } from "../../domain/projectVisual";
import type { QueryExecutor } from "./db";
import { toIsoString,type CascadeImpactRecord,type TimestampValue } from "./types";
type Row={id:string;project_id:string;principle_version_id:string;change_type:CascadeChangeType;target_type:CascadeImpact["targetType"];target_id:string;impact_result:CascadeImpact["impactResult"];target_new_status:CascadeImpact["targetNewStatus"];reason:string;evaluated_at:TimestampValue;applied_at:TimestampValue|null};
const map=(r:Row):CascadeImpactRecord=>({id:r.id,projectId:r.project_id,principleVersionId:r.principle_version_id,changeType:r.change_type,targetType:r.target_type,targetId:r.target_id,impactResult:r.impact_result,targetNewStatus:r.target_new_status,reason:r.reason,evaluatedAt:toIsoString(r.evaluated_at)!,appliedAt:toIsoString(r.applied_at)});
export class CascadeImpactRepository{
  constructor(private readonly db:QueryExecutor){}
  async insertMany(i:{projectId:string;principleVersionId:string;changeType:CascadeChangeType;impacts:CascadeImpact[];idFor:(impact:CascadeImpact,index:number)=>string}):Promise<CascadeImpactRecord[]>{const out:CascadeImpactRecord[]=[];for(const[at,impact]of i.impacts.entries()){const[r]=await this.db.query<Row>("INSERT INTO cascade_impacts (id,project_id,principle_version_id,change_type,target_type,target_id,impact_result,target_new_status,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[i.idFor(impact,at),i.projectId,i.principleVersionId,i.changeType,impact.targetType,impact.targetId,impact.impactResult,impact.targetNewStatus,impact.reason]);out.push(map(r));}return out;}
  async listByVersion(versionId:string):Promise<CascadeImpactRecord[]>{return(await this.db.query<Row>("SELECT * FROM cascade_impacts WHERE principle_version_id=$1 ORDER BY target_type,target_id",[versionId])).map(map);}
}
