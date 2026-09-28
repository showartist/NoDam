import {z} from "zod";
import {AlignmentIssueV2} from "./schema";
const Item=z.object({issue_id:z.string(),evidence:z.array(z.string()),note:z.string(),issue:AlignmentIssueV2.optional()});
/** Older runs have only id/note/evidence; they can still be inspected, not imported. */
export function settledIssues(statsJson:string|null){
 if(!statsJson)return [];
 try{const rows=JSON.parse(statsJson)?.context?.settledIssues;if(!Array.isArray(rows))return [];return rows.flatMap(row=>{const p=Item.safeParse(row);return p.success?[p.data]:[];});}catch{return [];}
}
