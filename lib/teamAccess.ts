import {createHash,timingSafeEqual} from "node:crypto";
export function validAdmin(authorization:string|null,expected:string|undefined){
 if(!expected||!/^[a-f0-9]{64}$/.test(expected)||!authorization?.startsWith("Basic "))return false;
 let credential:string;try{credential=Buffer.from(authorization.slice(6),"base64").toString("utf8");}catch{return false;}
 const separator=credential.indexOf(":");if(credential.slice(0,separator)!=="admin")return false;
 const actual=createHash("sha256").update(credential.slice(separator+1)).digest();return timingSafeEqual(actual,Buffer.from(expected,"hex"));
}
export function publicParticipantPath(path:string){return path==="/join"||path==="/api/participation"||path.startsWith("/_next/static/")||path==="/favicon.ico";}
