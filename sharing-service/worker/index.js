export async function handle(request,env,assets) {
 const url=new URL(request.url);
 const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'}});
 if(url.pathname.startsWith('/api/shared/')){
  const id=url.pathname.slice('/api/shared/'.length);
  if(!/^[a-f0-9]{48}$/.test(id))return json({error:'공유 회의를 찾을 수 없습니다.'},404);
  if(!env.DB)return json({error:'공유 저장소를 사용할 수 없습니다.'},503);
  try{
   if(request.method==='GET'){
    const row=await env.DB.prepare('SELECT snapshot,updated_at FROM live_shares WHERE id=?').bind(id).first();
    if(!row)return json({error:'공유가 종료되었거나 없는 회의입니다.'},404);
    return json({...JSON.parse(row.snapshot),publishedAt:row.updated_at});
   }
   if(!['PUT','DELETE'].includes(request.method))return json({error:'허용되지 않는 요청'},405);
   const supplied=request.headers.get('authorization')??'';
   if(!env.SHARE_WRITE_KEY)return json({error:'공유 쓰기가 설정되지 않았습니다.'},503);
   const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
   const [a,b]=await Promise.all([digest(supplied),digest(`Bearer ${env.SHARE_WRITE_KEY}`)]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
   if(difference)return json({error:'공유 쓰기 권한이 없습니다.'},401);
   if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM live_shares WHERE id=?').bind(id).run();return json({ok:true});}
   const body=await request.text();if(new TextEncoder().encode(body).length>3*1024*1024)return json({error:'회의 공유 데이터가 너무 큽니다.'},413);
   let data;try{data=JSON.parse(body);}catch{return json({error:'잘못된 공유 데이터'},400);}
   if(!Number.isSafeInteger(data.revision)||data.revision<0||typeof data.goal!=='string'||!Array.isArray(data.utterances)||!Array.isArray(data.reviews)||typeof data.status!=='string')return json({error:'잘못된 공유 데이터'},400);
   await env.DB.prepare('INSERT INTO live_shares(id,revision,snapshot,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot,updated_at=excluded.updated_at WHERE excluded.revision>live_shares.revision').bind(id,data.revision,body,new Date().toISOString()).run();
   return json({ok:true});
  }catch(error){console.error('share storage:',error?.message);return json({error:'공유 저장소 오류입니다. 다시 시도해 주세요.'},503);}
 }
 const key=/^\/live\/[a-f0-9]{48}$/.test(url.pathname)?'/live.html':url.pathname==='/'?'/index.html':url.pathname;
 const asset=assets[key];if(!asset)return new Response('Not found',{status:404});
 return new Response(asset.body,{headers:{'content-type':asset.type,'cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}});
}
