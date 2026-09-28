import {createReadStream,statSync} from "node:fs";
import {Readable} from "node:stream";
import path from "node:path";
import {getAudioSource,sourceFile} from "@/lib/transcription/source";
export const runtime="nodejs";
/** Single byte ranges let the player seek without loading the entire meeting. */
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const source=getAudioSource((await params).id);
 if(!source)return Response.json({error:"연결된 원음이 없습니다."},{status:404});
 let file:string,size:number;
 try{file=sourceFile(source.file);size=statSync(file).size;}catch{return Response.json({error:"저장된 원음 파일을 찾을 수 없습니다."},{status:404});}
 const headers:Record<string,string>={"Accept-Ranges":"bytes","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Type":({".mp3":"audio/mpeg",".mp4":"audio/mp4",".m4a":"audio/mp4",".wav":"audio/wav",".webm":"audio/webm",".ogg":"audio/ogg",".flac":"audio/flac"} as Record<string,string>)[path.extname(file).toLowerCase()]??"application/octet-stream"};
 const range=req.headers.get("range");let start=0,end=size-1;
 if(range){
  const m=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${size}`}});
  if(m[1]){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}
  else{start=Math.max(0,size-Number(m[2]));}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${size}`}});
  headers["Content-Range"]=`bytes ${start}-${end}/${size}`;
 }
 headers["Content-Length"]=String(Math.max(0,end-start+1));
 if(!size)return new Response(null,{headers});
 const stream=createReadStream(file,{start,end});
 return new Response(Readable.toWeb(stream) as ReadableStream,{status:range?206:200,headers});
}
