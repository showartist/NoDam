import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Pool, type PoolClient, type QueryResultRow } from "@neondatabase/serverless";
import {
  ApprovalRepository, CascadeImpactRepository, CharacterVisualRepository,
  DecisionLineageRepository, DecisionQuestionRepository, PrincipleRepository,
  ProjectRepository, ReferenceRepository, type QueryExecutor, type TransactionExecutor,
} from "../lib/repositories/projectVisual";

const connectionString=process.env.DATABASE_URL;
const skipReason=connectionString?false:"DATABASE_URL is not configured; Neon integration tests do not fall back to SQLite";
const neonTest=(name:string,work:()=>Promise<void>)=>test(name,{skip:skipReason},work);
const ns=`pv_repo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
let pool:Pool;let client:PoolClient;let db:TransactionExecutor;let savepoint=0;

function executor(client:PoolClient):TransactionExecutor{
  const tx:TransactionExecutor={
    async query<T extends QueryResultRow>(text:string,params:unknown[]=[]):Promise<T[]>{return(await client.query<T>(text,params)).rows;},
    async transaction<T>(work:(inner:QueryExecutor)=>Promise<T>):Promise<T>{
      const name=`repo_sp_${++savepoint}`;await client.query(`SAVEPOINT ${name}`);
      try{const result=await work(tx);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}
      catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);await client.query(`RELEASE SAVEPOINT ${name}`);throw error;}
    },
  };return tx;
}

async function cleanup():Promise<void>{
  await db.query("DELETE FROM decision_lineage WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM cascade_impacts WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM character_visual_scene_links WHERE character_visual_bible_id LIKE $1",[ns+"%"]);
  await db.query("DELETE FROM character_visual_bibles WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM principle_scene_links WHERE principle_version_id LIKE $1",[ns+"%"]);
  await db.query("DELETE FROM principle_shot_links WHERE principle_version_id LIKE $1",[ns+"%"]);
  await db.query("DELETE FROM visual_principle_approvals WHERE principle_version_id LIKE $1",[ns+"%"]);
  await db.query("UPDATE visual_principles SET current_version_id=NULL WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM visual_principle_versions WHERE principle_id LIKE $1",[ns+"%"]);
  await db.query("DELETE FROM visual_principles WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM decision_questions WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM visual_reference_scene_links WHERE reference_id LIKE $1",[ns+"%"]);
  await db.query("DELETE FROM visual_references WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM shots WHERE scene_id IN (SELECT id FROM scenes WHERE project_id=$1)",[ns]);
  await db.query("DELETE FROM scenes WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM participants WHERE project_id=$1",[ns]);
  await db.query("DELETE FROM projects WHERE id=$1",[ns]);
}

describe("Project Visual Neon repository integration",{concurrency:1},()=>{
  before(async()=>{
    if(!connectionString)return;
    pool=new Pool({connectionString:connectionString!});client=await pool.connect();db=executor(client);await client.query("BEGIN");
    const projects=new ProjectRepository(db);
    await projects.createProject({id:ns,title:"Repository integration"});
    await projects.createParticipant({id:ns+"_director",projectId:ns,name:"Director",role:"director"});
    await projects.createParticipant({id:ns+"_producer",projectId:ns,name:"Producer",role:"producer"});
    await projects.createScene({id:ns+"_scene",projectId:ns,sceneNumber:34,title:"Pool"});
    await projects.createShot({id:ns+"_shot",sceneId:ns+"_scene",shotNumber:3,title:"Wide"});
  });
  after(async()=>{if(!connectionString)return;try{await client.query("ROLLBACK");}finally{client.release();await pool.end();}});

  neonTest("project_scene_shot_roundtrip",async()=>{const r=new ProjectRepository(db);assert.equal((await r.getProject(ns))?.id,ns);assert.equal((await r.getScene(ns+"_scene"))?.reviewStatus,"current");assert.equal((await r.getShot(ns+"_shot"))?.status,"proposed");});
  neonTest("visual_reference_roundtrip_with_scene_link",async()=>{const r=new ReferenceRepository(db);await r.create({id:ns+"_ref",projectId:ns,title:"Pool blue",sourceMethod:"generated",contentType:"world_tone",adoptionLevel:"core",referenceImageState:"uploaded",assetUri:"assets/pool.png",take:["blue"],drop:["gloss"],responsibleRole:"director"});await r.linkScene(ns+"_ref",ns+"_scene");assert.deepEqual(await r.listSceneIds(ns+"_ref"),[ns+"_scene"]);const updated=await r.update({id:ns+"_ref",projectId:ns,title:"Pool blue revised",sourceMethod:"generated",contentType:"world_tone",adoptionLevel:"support",referenceImageState:"uploaded",assetUri:"assets/pool.png",take:["blue"],drop:["gloss"],responsibleRole:"director"});assert.equal(updated.adoptionLevel,"support");});
  neonTest("principle_and_immutable_version_roundtrip",async()=>{const r=new PrincipleRepository(db);await r.create({id:ns+"_principle",projectId:ns,title:"Isolation"});await r.appendVersion({id:ns+"_v1",principleId:ns+"_principle",versionNumber:1,principleText:"Isolate subject",rationale:"Intent",contentHash:"hash-v1"});await r.setCurrentVersion(ns+"_principle",ns+"_v1");assert.equal((await r.get(ns+"_principle"))?.currentVersionId,ns+"_v1");assert.equal((await r.getVersion(ns+"_v1"))?.versionNumber,1);});
  neonTest("director_and_producer_approval_history_roundtrip",async()=>{const r=new ApprovalRepository(db);assert.equal(await r.recordAndEvaluate({approval:{id:ns+"_approval_d",principleVersionId:ns+"_v1",approverId:ns+"_director",role:"director"},principleId:ns+"_principle",projectId:ns,lineageId:ns+"_lineage_ad"}),"needs_review");assert.equal(await r.recordAndEvaluate({approval:{id:ns+"_approval_p",principleVersionId:ns+"_v1",approverId:ns+"_producer",role:"producer"},principleId:ns+"_principle",projectId:ns,lineageId:ns+"_lineage_ap"}),"confirmed");assert.equal((await r.listActive(ns+"_v1")).length,2);});
  neonTest("withdrawn_approval_is_preserved",async()=>{const r=new ApprovalRepository(db);assert.equal(await r.withdrawAndEvaluate({approvalId:ns+"_approval_d",approverId:ns+"_director",principleId:ns+"_principle",principleVersionId:ns+"_v1",projectId:ns,reason:"Changed",lineageId:ns+"_lineage_w"}),"needs_review");const rows=await r.list(ns+"_v1");assert.equal(rows.length,2);assert.equal(rows.find(v=>v.id===ns+"_approval_d")?.status,"withdrawn");});
  neonTest("decision_question_roundtrip",async()=>{const r=new DecisionQuestionRepository(db);await r.create({id:ns+"_q",projectId:ns,question:"Which tone?",evidence:["U01"]});const decided=await r.setState({id:ns+"_q",state:"decided",decidedOption:"blue",decidedBy:ns+"_director",decidedAt:new Date().toISOString()});assert.equal(decided.state,"decided");});
  neonTest("character_visual_uses_character_id_link",async()=>{const r=new CharacterVisualRepository(db);await r.create({id:ns+"_char_v1",projectId:ns,characterId:ns+"_character",characterName:"Suhyun",versionNumber:1});await r.linkScene({bibleId:ns+"_char_v1",sceneId:ns+"_scene",characterId:ns+"_character"});assert.deepEqual(await r.listSceneLinks(ns+"_char_v1"),[{sceneId:ns+"_scene",characterId:ns+"_character"}]);});
  neonTest("cascade_persists_affected_with_null_status",async()=>{const r=new CascadeImpactRepository(db);const rows=await r.insertMany({projectId:ns,principleVersionId:ns+"_v1",changeType:"version_update",impacts:[{targetType:"shot",targetId:ns+"_shot",impactResult:"affected",targetNewStatus:null,reason:"proposed shot"}],idFor:()=>ns+"_impact_null"});assert.equal(rows[0].targetNewStatus,null);});
  neonTest("cascade_persists_unaffected_and_unknown",async()=>{const r=new CascadeImpactRepository(db);await r.insertMany({projectId:ns,principleVersionId:ns+"_v1",changeType:"version_update",impacts:[{targetType:"scene",targetId:ns+"_outside",impactResult:"unaffected",targetNewStatus:null,reason:"outside"},{targetType:"shot",targetId:ns+"_legacy",impactResult:"unknown",targetNewStatus:null,reason:"legacy"}],idFor:(_,i)=>ns+"_impact_"+i});assert.deepEqual((await r.listByVersion(ns+"_v1")).map(v=>v.impactResult).sort(),["affected","unaffected","unknown"]);});
  neonTest("invalid_cascade_combinations_are_rejected",async()=>{const r=new CascadeImpactRepository(db);for(const [at,impact]of [[0,{targetType:"scene",targetId:ns+"_bad_scene",impactResult:"affected",targetNewStatus:"restale",reason:"bad"}],[1,{targetType:"shot",targetId:ns+"_bad_shot",impactResult:"unknown",targetNewStatus:"review_required",reason:"bad"}]] as const){
    // 이 스위트는 before() 의 단일 BEGIN 안에서 돈다. CHECK 위반(23514)은 트랜잭션 전체를
    // 중단시키므로, SAVEPOINT 로 감싸지 않으면 첫 위반 이후 모든 문장이 25P02 로 실패한다.
    // assertion 은 그대로 두고 각 조합을 독립적으로 검사하기 위한 격리다.
    await db.query(`SAVEPOINT invalid_cascade_${at}`);
    await assert.rejects(()=>r.insertMany({projectId:ns,principleVersionId:ns+"_v1",changeType:"version_update",impacts:[impact],idFor:()=>ns+"_bad_"+at}),/cascade_impacts_check|violates check constraint/);
    await db.query(`ROLLBACK TO SAVEPOINT invalid_cascade_${at}`);
    await db.query(`RELEASE SAVEPOINT invalid_cascade_${at}`);
  }});
  neonTest("version_update_transaction_rolls_back_on_failure",async()=>{const r=new PrincipleRepository(db);await r.create({id:ns+"_rollback_principle",projectId:ns,title:"Rollback"});await assert.rejects(()=>r.updateVersion({projectId:ns,version:{id:ns+"_rollback_v1",principleId:ns+"_rollback_principle",versionNumber:1,principleText:"x",rationale:"x",contentHash:"x"},sceneLinks:[{sceneId:ns+"_missing_scene",reason:"force FK"}],shotLinks:[],cascadeInput:{changeType:"version_update",beforeVersion:null,afterVersion:{id:ns+"_rollback_v1",principleId:ns+"_rollback_principle",version:1,status:"candidate",contentHash:"x"},principleSceneLinks:[],principleShotLinks:[],targets:[]},impactIdFor:()=>ns+"_never"}));assert.equal(await r.getVersion(ns+"_rollback_v1"),null);assert.equal((await r.get(ns+"_rollback_principle"))?.currentVersionId,null);});
  neonTest("decision_lineage_roundtrip",async()=>{const r=new DecisionLineageRepository(db);await r.create({id:ns+"_lineage_q",projectId:ns,sourceType:"decision_question",sourceId:ns+"_q",relation:"decided_into",targetType:"principle_version",targetId:ns+"_v1",evidenceUid:"U01"});assert.equal((await r.listForSource("decision_question",ns+"_q"))[0].targetId,ns+"_v1");});
  neonTest("no_test_rows_remain_after_suite",async()=>{await cleanup();const[r]=await db.query<{count:string}>("SELECT count(*)::text count FROM projects WHERE id=$1",[ns]);assert.equal(r.count,"0");});
});
