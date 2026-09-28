import Link from "next/link";
import { getIntakeMetadata } from "@/lib/meetingIntake/store";
import { SOURCE_LABELS } from "@/lib/meetingIntake/model";
export default function IntakeNotice({meetingId}:{meetingId:string}) {
  const info=getIntakeMetadata(meetingId);if(!info)return null;
  return <aside style={{padding:"14px 24px",background:"#fff8e8",color:"#4b412d"}}><Link href={`/v2/m/${meetingId}`}>v2 회의로 돌아가기</Link> · {SOURCE_LABELS[info.source_type]} · {info.purpose}{info.source_type!=="actual"&&<strong> — 실제 발언·합의로 확정할 수 없는 자료입니다.</strong>}</aside>;
}
