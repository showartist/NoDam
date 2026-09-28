import Link from "next/link";
import {notFound} from "next/navigation";
import {db} from "@/lib/db";
import {getIntakeMetadata} from "@/lib/meetingIntake/store";
import {DecisionBoard} from "@/app/m/[id]/decisions/DecisionBoard";
import s from "../../../v2.module.css";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!db().prepare("SELECT id FROM meetings WHERE id=?").get(id))notFound();
 const info=getIntakeMetadata(id);
 return <main className={s.page}><div className={s.wrap}><nav className={s.nav}><Link href={`/v2/m/${id}`}>← 회의 원문·분석으로</Link><Link href="/v2">동상이몽</Link></nav>
 {info&&info.source_type!=="actual"&&<p className={s.notice}>가상·예정 자료입니다. 질문과 근거는 검토할 수 있지만 실제 참가자의 확인·동의는 기록할 수 없습니다.</p>}
 <DecisionBoard meetingId={id} sourceHref={`/v2/m/${id}`}/></div></main>;
}
