import {notFound} from "next/navigation";
import {HeaderNavStepper} from "@/app/components/HeaderNavStepper";
import {loadAlignmentPageData} from "@/lib/alignment/pageData";
import {DecisionBoard} from "./DecisionBoard";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params,data=loadAlignmentPageData(id);if(!data)notFound();
 return <main style={{background:"#f5f7fb",minHeight:"100vh"}}><HeaderNavStepper projectId={data.projectId} meetingId={id} currentStep="resolve"/><DecisionBoard meetingId={id}/></main>;
}
