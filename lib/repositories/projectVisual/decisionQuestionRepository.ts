import type { DecisionQuestionState } from "../../domain/projectVisual";
import type { QueryExecutor } from "./db";
import { toIsoString,type DecisionQuestionRecord,type TimestampValue } from "./types";
type Row={id:string;project_id:string;question:string;context:string|null;state:DecisionQuestionState;priority:number;decided_option:string|null;decided_by:string|null;decided_at:TimestampValue|null;evidence_json:unknown[];created_at:TimestampValue;updated_at:TimestampValue};
const map=(r:Row):DecisionQuestionRecord=>({id:r.id,projectId:r.project_id,question:r.question,context:r.context,state:r.state,priority:r.priority,decidedOption:r.decided_option,decidedBy:r.decided_by,decidedAt:toIsoString(r.decided_at),evidence:r.evidence_json,createdAt:toIsoString(r.created_at)!,updatedAt:toIsoString(r.updated_at)!});
export class DecisionQuestionRepository{
  constructor(private readonly db:QueryExecutor){}
  async create(i:{id:string;projectId:string;question:string;context?:string|null;state?:DecisionQuestionState;priority?:number;evidence?:unknown[]}):Promise<DecisionQuestionRecord>{const[r]=await this.db.query<Row>("INSERT INTO decision_questions (id,project_id,question,context,state,priority,evidence_json) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *",[i.id,i.projectId,i.question,i.context??null,i.state??"open",i.priority??0,JSON.stringify(i.evidence??[])]);return map(r);}
  async get(id:string):Promise<DecisionQuestionRecord|null>{const[r]=await this.db.query<Row>("SELECT * FROM decision_questions WHERE id=$1",[id]);return r?map(r):null;}
  async setState(i:{id:string;state:DecisionQuestionState;decidedOption?:string|null;decidedBy?:string|null;decidedAt?:string|null}):Promise<DecisionQuestionRecord>{const[r]=await this.db.query<Row>("UPDATE decision_questions SET state=$2,decided_option=$3,decided_by=$4,decided_at=$5,updated_at=now() WHERE id=$1 RETURNING *",[i.id,i.state,i.decidedOption??null,i.decidedBy??null,i.decidedAt??null]);if(!r)throw new Error(`Decision question not found: ${i.id}`);return map(r);}
}
