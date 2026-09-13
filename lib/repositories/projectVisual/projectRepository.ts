import type { GeneratedImageState, SceneReviewStatus, ShotStatus } from "../../domain/projectVisual";
import type { QueryExecutor } from "./db";
import { toIsoString, type ProjectRecord, type SceneRecord, type ShotRecord, type TimestampValue } from "./types";

type ProjectRow={id:string;title:string;domain:string;status:string;one_line:string|null;created_at:TimestampValue;updated_at:TimestampValue};
type SceneRow={id:string;project_id:string;scene_number:number;title:string;review_status:SceneReviewStatus;created_at:TimestampValue;updated_at:TimestampValue};
type ShotRow={id:string;scene_id:string|null;shot_number:number;title:string;status:ShotStatus;generated_image_state:GeneratedImageState;image_uri:string|null;approved_by:string|null;approved_at:TimestampValue|null;created_at:TimestampValue;updated_at:TimestampValue};
const mapProject=(r:ProjectRow):ProjectRecord=>({id:r.id,title:r.title,domain:r.domain,status:r.status,oneLine:r.one_line,createdAt:toIsoString(r.created_at)!,updatedAt:toIsoString(r.updated_at)!});
const mapScene=(r:SceneRow):SceneRecord=>({id:r.id,projectId:r.project_id,sceneNumber:r.scene_number,title:r.title,reviewStatus:r.review_status,createdAt:toIsoString(r.created_at)!,updatedAt:toIsoString(r.updated_at)!});
const mapShot=(r:ShotRow):ShotRecord=>({id:r.id,sceneId:r.scene_id,shotNumber:r.shot_number,title:r.title,status:r.status,generatedImageState:r.generated_image_state,imageUri:r.image_uri,approvedBy:r.approved_by,approvedAt:toIsoString(r.approved_at),createdAt:toIsoString(r.created_at)!,updatedAt:toIsoString(r.updated_at)!});
export class ProjectRepository{
  constructor(private readonly db:QueryExecutor){}
  async createProject(i:{id:string;title:string;domain?:string;status?:string;oneLine?:string|null}):Promise<ProjectRecord>{const[r]=await this.db.query<ProjectRow>("INSERT INTO projects (id,title,domain,status,one_line) VALUES ($1,$2,$3,$4,$5) RETURNING *",[i.id,i.title,i.domain??"film",i.status??"development",i.oneLine??null]);return mapProject(r);}
  async getProject(id:string):Promise<ProjectRecord|null>{const[r]=await this.db.query<ProjectRow>("SELECT * FROM projects WHERE id=$1",[id]);return r?mapProject(r):null;}
  async createParticipant(i:{id:string;projectId:string;name:string;role:string}):Promise<{id:string;projectId:string;name:string;role:string}>{const[r]=await this.db.query<{id:string;project_id:string;name:string;role:string}>("INSERT INTO participants (id,project_id,name,role) VALUES ($1,$2,$3,$4) RETURNING id,project_id,name,role",[i.id,i.projectId,i.name,i.role]);return{id:r.id,projectId:r.project_id,name:r.name,role:r.role};}
  async createScene(i:{id:string;projectId:string;sceneNumber:number;title:string;reviewStatus?:SceneReviewStatus}):Promise<SceneRecord>{const[r]=await this.db.query<SceneRow>("INSERT INTO scenes (id,project_id,scene_number,title,review_status) VALUES ($1,$2,$3,$4,$5) RETURNING *",[i.id,i.projectId,i.sceneNumber,i.title,i.reviewStatus??"current"]);return mapScene(r);}
  async getScene(id:string):Promise<SceneRecord|null>{const[r]=await this.db.query<SceneRow>("SELECT * FROM scenes WHERE id=$1",[id]);return r?mapScene(r):null;}
  async createShot(i:{id:string;sceneId:string;shotNumber:number;title:string;status?:ShotStatus;generatedImageState?:GeneratedImageState;imageUri?:string|null}):Promise<ShotRecord>{const[r]=await this.db.query<ShotRow>("INSERT INTO shots (id,scene_id,shot_number,title,status,generated_image_state,image_uri) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",[i.id,i.sceneId,i.shotNumber,i.title,i.status??"proposed",i.generatedImageState??"not_generated",i.imageUri??null]);return mapShot(r);}
  async getShot(id:string):Promise<ShotRecord|null>{const[r]=await this.db.query<ShotRow>("SELECT * FROM shots WHERE id=$1",[id]);return r?mapShot(r):null;}
  async setSceneReviewStatus(id:string,status:SceneReviewStatus):Promise<void>{const rows=await this.db.query<{id:string}>("UPDATE scenes SET review_status=$2,updated_at=now() WHERE id=$1 RETURNING id",[id,status]);if(rows.length!==1)throw new Error(`Scene not found: ${id}`);}
  async setShotStatus(id:string,status:ShotStatus):Promise<void>{const rows=await this.db.query<{id:string}>("UPDATE shots SET status=$2,updated_at=now() WHERE id=$1 RETURNING id",[id,status]);if(rows.length!==1)throw new Error(`Shot not found: ${id}`);}
}
