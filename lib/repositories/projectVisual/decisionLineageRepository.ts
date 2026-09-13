import type { QueryExecutor } from "./db";
import { toIsoString,type DecisionLineageRecord,type TimestampValue } from "./types";
type Row={id:string;project_id:string;source_type:string;source_id:string;relation:string;target_type:string;target_id:string;evidence_uid:string|null;metadata_json:Record<string,unknown>;created_at:TimestampValue};
const map=(r:Row):DecisionLineageRecord=>({id:r.id,projectId:r.project_id,sourceType:r.source_type,sourceId:r.source_id,relation:r.relation,targetType:r.target_type,targetId:r.target_id,evidenceUid:r.evidence_uid,metadata:r.metadata_json,createdAt:toIsoString(r.created_at)!});
export type LineageWrite={id:string;projectId:string;sourceType:string;sourceId:string;relation:string;targetType:string;targetId:string;evidenceUid?:string|null;metadata?:Record<string,unknown>};
export class DecisionLineageRepository{
  constructor(private readonly db:QueryExecutor){}
  async create(i:LineageWrite):Promise<DecisionLineageRecord>{const[r]=await this.db.query<Row>("INSERT INTO decision_lineage (id,project_id,source_type,source_id,relation,target_type,target_id,evidence_uid,metadata_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *",[i.id,i.projectId,i.sourceType,i.sourceId,i.relation,i.targetType,i.targetId,i.evidenceUid??null,JSON.stringify(i.metadata??{})]);return map(r);}
  async listForSource(sourceType:string,sourceId:string):Promise<DecisionLineageRecord[]>{return(await this.db.query<Row>("SELECT * FROM decision_lineage WHERE source_type=$1 AND source_id=$2 ORDER BY created_at,id",[sourceType,sourceId])).map(map);}
}
