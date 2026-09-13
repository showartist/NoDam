import { getProjectVisualService } from "@/lib/services/projectVisual";
import { handle,json } from "../../../http";
export async function GET(_:Request,{params}:{params:Promise<{projectId:string}>}){return handle(async()=>getProjectVisualService().listVisualPrinciples((await params).projectId));}
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){return handle(async()=>{const[p,body]=await Promise.all([params,json(request)]);return getProjectVisualService().createVisualPrinciple({id:body.id??crypto.randomUUID(),projectId:p.projectId,title:body.title});},201);}
