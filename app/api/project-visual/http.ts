import { NextResponse } from "next/server";
import { ProjectVisualServiceError,toProjectVisualError } from "@/lib/services/projectVisual";
export const ok=(data:unknown,status=200)=>NextResponse.json({ok:true,data},{status});
export function fail(error:unknown){const safe=toProjectVisualError(error);return NextResponse.json({ok:false,error:{code:safe.code,message:safe.message}},{status:safe.status});}
export async function json(request:Request):Promise<Record<string,any>>{try{const value=await request.json();if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value;}catch{throw new ProjectVisualServiceError("VALIDATION_ERROR","Request body must be a JSON object");}}
export async function handle(work:()=>Promise<unknown>,status=200){try{return ok(await work(),status);}catch(error){return fail(error);}}
