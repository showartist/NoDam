import type {TranscriptWord} from "./types";
export type AudioReviewFlag = {kind:"empty_chunk"|"boundary_overlap";startMs:number;endMs:number;chunkIndex:number};
/** Review cues only: empty STT output is not proof of silence or missing speech. */
export function audioReviewFlags(chunks:{index:number;offsetMs:number;durationMs:number;words:number}[], words:TranscriptWord[]):AudioReviewFlag[]{
 const flags:AudioReviewFlag[]=chunks.filter(c=>!c.words).map(c=>({kind:"empty_chunk",startMs:c.offsetMs,endMs:c.offsetMs+c.durationMs,chunkIndex:c.index}));
 for(let i=1;i<words.length;i++){
  const a=words[i-1],b=words[i];
  const ca=a.speaker?.match(/^C(\d+)-/)?.[1],cb=b.speaker?.match(/^C(\d+)-/)?.[1];
  if(ca&&cb&&ca!==cb&&a.endMs-b.startMs>200)flags.push({kind:"boundary_overlap",startMs:Math.max(0,Math.min(a.startMs,b.startMs)-1000),endMs:Math.max(a.endMs,b.endMs)+1000,chunkIndex:Number(cb)-1});
 }
 return flags.sort((a,b)=>a.startMs-b.startMs);
}
