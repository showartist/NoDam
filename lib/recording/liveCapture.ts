/** Browser-only durable live audio queue. Each 20s file is independently decodable. */
export type LiveChunk = {sessionId:string;meetingId:string;offsetMs:number;blob:Blob;name:string;complete:boolean;accepted:boolean};
function open():Promise<IDBDatabase>{return new Promise((ok,fail)=>{const r=indexedDB.open("scenenote-live-audio",1);r.onupgradeneeded=()=>r.result.createObjectStore("chunks",{keyPath:["sessionId","offsetMs"]});r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});}
async function put(row:LiveChunk){const db=await open();return new Promise<void>((ok,fail)=>{const tx=db.transaction("chunks","readwrite");tx.objectStore("chunks").put(row);tx.oncomplete=()=>{db.close();ok();};tx.onerror=tx.onabort=()=>{db.close();fail(tx.error??new Error("녹음 저장 실패"));};});}
export async function savedLiveChunks(meetingId:string):Promise<LiveChunk[]>{const db=await open();return new Promise((ok,fail)=>{const tx=db.transaction("chunks","readonly"),r=tx.objectStore("chunks").getAll();tx.oncomplete=()=>{db.close();ok((r.result as LiveChunk[]).filter(x=>x.meetingId===meetingId).sort((a,b)=>a.offsetMs-b.offsetMs));};tx.onerror=()=>{db.close();fail(tx.error);};});}
async function upload(row:LiveChunk){
  let last:Error=new Error("전송 실패");
  for(let attempt=0;attempt<3;attempt++){
    try{
      const fd=new FormData();fd.append("file",row.blob,row.name);fd.append("sessionId",row.sessionId);fd.append("offsetMs",String(row.offsetMs));
      const r=await fetch(`/api/meetings/${row.meetingId}/live/chunk`,{method:"POST",body:fd,signal:AbortSignal.timeout(30_000)});
      const j=await r.json();
      if(!r.ok){last=new Error(j.error??`전송 실패 (${r.status})`);if(r.status<500&&r.status!==429)throw Object.assign(last,{permanent:true});throw last;}
      await put({...row,accepted:true});return;
    }catch(e){last=e as Error;if((e as {permanent?:boolean}).permanent)throw e;}
    if(attempt<2)await new Promise(r=>setTimeout(r,1000*2**attempt));
  }
  throw last;
}
export async function retryLiveChunks(meetingId:string,sessionId:string){
  const rows=(await savedLiveChunks(meetingId)).filter(x=>x.sessionId===sessionId&&!x.accepted);
  for(const row of rows)await upload({...row,complete:true}); // Explicit recovery sends the last persisted snapshot; the server validates decodability.
}
export async function downloadLiveChunks(meetingId:string){
  // Independent containers cannot be concatenated into a valid single WebM. Download separately.
  const rows=await savedLiveChunks(meetingId);
  for(const row of rows){const url=URL.createObjectURL(row.blob),a=document.createElement("a");a.href=url;a.download=`${row.sessionId}-${row.offsetMs}-${row.name}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);}
}
export class LiveCapture {
  private timer:ReturnType<typeof setInterval>|null=null;
  private current:{rec:MediaRecorder;done:Promise<void>}|null=null;
  private writes:Promise<void>[]=[];
  private sends:Promise<void>=Promise.resolve();
  private stopped=false;
  private started=performance.now();
  private failure:Error|null=null;
  constructor(private meetingId:string,private sessionId:string,private stream:MediaStream,private onSaved:(bytes:number)=>void,private onError:(message:string)=>void,private baseOffset=0){
    this.current=this.open();
    this.timer=setInterval(()=>{const old=this.current;this.current=this.open();if(old?.rec.state!=="inactive")old?.rec.stop();},20_000);
  }
  private open(){
    const mime=["audio/webm;codecs=opus","audio/mp4","audio/webm"].find(m=>MediaRecorder.isTypeSupported(m));
    const rec=mime?new MediaRecorder(this.stream,{mimeType:mime}):new MediaRecorder(this.stream);
    const offsetMs=this.baseOffset+Math.round(performance.now()-this.started);
    const parts:Blob[]=[];let storage=Promise.resolve();
    const row=(complete:boolean):LiveChunk=>({meetingId:this.meetingId,sessionId:this.sessionId,offsetMs,blob:new Blob(parts,{type:rec.mimeType}),name:rec.mimeType.includes("mp4")?"chunk.m4a":"chunk.webm",complete,accepted:false});
    const done=new Promise<void>(resolve=>{
      rec.ondataavailable=e=>{if(!e.data.size)return;parts.push(e.data);const snapshot=row(false);storage=storage.then(()=>put(snapshot));storage.catch(e=>this.fail(e));};
      rec.onerror=()=>this.fail(new Error("마이크 녹음 중 오류가 발생했습니다."));
      rec.onstop=()=>{
        const ready=row(true);
        const write=storage.then(async()=>{if(!ready.blob.size)return;await put(ready);this.onSaved(ready.blob.size);this.sends=this.sends.then(()=>upload(ready));this.sends.catch(e=>this.fail(e));}).catch(e=>this.fail(e)).finally(resolve);
        this.writes.push(write);
      };
    });
    rec.start(1000); // Persist a partial snapshot each second; only closed files are uploaded.
    return {rec,done};
  }
  private fail(e:unknown){if(this.failure)return;this.failure=e instanceof Error?e:new Error(String(e));this.onError(`${this.failure.message} · 저장된 녹음은 복구할 수 있습니다.`);this.halt();}
  private halt(){if(this.stopped)return;this.stopped=true;if(this.timer)clearInterval(this.timer);if(this.current?.rec.state!=="inactive")this.current?.rec.stop();this.stream.getTracks().forEach(t=>t.stop());}
  async stop(){this.halt();await this.current?.done;await Promise.all(this.writes);try{await this.sends;}catch{}if(this.failure)throw this.failure;}
  dispose(){this.halt();}
}
