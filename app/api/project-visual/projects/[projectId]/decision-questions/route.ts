import { getProjectVisualService } from "@/lib/services/projectVisual";
import { handle,json } from "../../../http";
export async function GET(_:Request,{params}:{params:Promise<{projectId:string}>}){return handle(async()=>getProjectVisualService().listDecisionQuestions((await params).projectId));}
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){return handle(async()=>{const[p,body]=await Promise.all([params,json(request)]);return getProjectVisualService().createDecisionQuestion({id:body.id??crypto.randomUUID(),projectId:p.projectId,question:body.question,context:body.context,priority:body.priority,evidence:body.evidence});},201);}
