import {NextRequest,NextResponse} from "next/server";
import {validAdmin,publicParticipantPath} from "./lib/teamAccess";
export function proxy(req:NextRequest){
 const team=process.env.NODAM_TEAM_MODE==="1";
 const headers={"cache-control":"no-store","referrer-policy":"no-referrer"};
 if(!team){if(!["localhost","127.0.0.1","[::1]"].includes(req.nextUrl.hostname))return NextResponse.json({error:"팀 운영 설정이 필요합니다."},{status:503,headers});return NextResponse.next();}
 if(!process.env.NODAM_PUBLIC_ORIGIN?.startsWith("https://")||!process.env.NODAM_ADMIN_PASSWORD_HASH)return NextResponse.json({error:"운영 서버 설정을 완료해 주세요."},{status:503,headers});
 if(publicParticipantPath(req.nextUrl.pathname)){const r=NextResponse.next();r.headers.set("referrer-policy","no-referrer");return r;}
 if(!validAdmin(req.headers.get("authorization"),process.env.NODAM_ADMIN_PASSWORD_HASH))return new NextResponse("진행자 계정으로 로그인해 주세요.",{status:401,headers:{...headers,"www-authenticate":'Basic realm="Dongsang Meeting", charset="UTF-8"'}});
 const origin=req.headers.get("origin");if(!["GET","HEAD","OPTIONS"].includes(req.method)&&origin&&origin!==process.env.NODAM_PUBLIC_ORIGIN)return NextResponse.json({error:"다른 사이트의 변경 요청은 허용하지 않습니다."},{status:403,headers});
 return NextResponse.next();
}
export const config={matcher:["/:path*"]};
