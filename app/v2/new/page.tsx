import path from "node:path";
import { db } from "@/lib/db";
import IntakeForm from "./IntakeForm";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function NewV2({searchParams}:{searchParams:Promise<{mode?:string;projectId?:string}>}) {
  const query=await searchParams;
  const projects=db().prepare("SELECT id,title FROM projects ORDER BY created_at DESC").all() as {id:string;title:string}[];
  return <IntakeForm projects={projects.map(p=>({...p}))} initialMode={query.mode==="text"?"text":"live"} initialProjectId={query.projectId??""} storagePath={process.env.SCENENOTE_DB??(process.env.VERCEL?"/tmp/scenesync.db":path.join(process.cwd(),".data","scenesync.db"))}/>;
}
