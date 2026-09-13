import { getProjectVisualService,ProjectVisualServiceError } from "@/lib/services/projectVisual";
import { handle,json } from "../../../../../http";
type Params={projectId:string;principleId:string};
export async function GET(_:Request,{params}:{params:Promise<Params>}){return handle(async()=>{const p=await params;return getProjectVisualService().listCascadeImpacts(p.projectId,p.principleId);});}
export async function POST(request:Request,{params}:{params:Promise<Params>}){return handle(async()=>{const[p,body]=await Promise.all([params,json(request)]);if(body.action!=="update_confirmed")throw new ProjectVisualServiceError("VALIDATION_ERROR","Unsupported cascade action");return getProjectVisualService().updateConfirmedPrincipleVersion({...body.update,projectId:p.projectId,version:{...body.update?.version,principleId:p.principleId}});},201);}
