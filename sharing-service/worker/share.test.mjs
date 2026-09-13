import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {handle} from './index.js';
test('synthetic hosted runtime: denied writes, persistence, revisions, deletion and static routes',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_tense_lucky_pierre.sql','utf8'));
 const DB={prepare(sql){return {bind(...values){return {first:async()=>sqlite.prepare(sql).get(...values),run:async()=>sqlite.prepare(sql).run(...values)}}}}};
 const id='a'.repeat(48),key='synthetic-test-only',env={DB,SHARE_WRITE_KEY:key},base='https://example.test/api/shared/'+id;
 const payload=revision=>({revision,goal:'합성 회의 목적',utterances:[{uid:'U-001',text:'합성 발언'}],reviews:[],status:'recording'});
 const put=(revision,auth=key)=>handle(new Request(base,{method:'PUT',headers:{authorization:'Bearer '+auth},body:JSON.stringify(payload(revision))}),env,{});
 assert.equal((await put(1,'wrong')).status,401);
 assert.equal((await handle(new Request(base),env,{})).status,404);
 assert.equal((await put(2)).status,200);assert.equal((await put(1)).status,200);
 const saved=await (await handle(new Request(base),env,{})).json();assert.equal(saved.revision,2);assert.equal(saved.utterances[0].text,'합성 발언');assert.ok(!JSON.stringify(saved).includes(key));
 assert.equal((await handle(new Request(base,{method:'PUT',headers:{authorization:'Bearer '+key},body:'{"revision":3}'}),env,{})).status,400);
 assert.equal((await handle(new Request(base,{method:'DELETE'}),env,{})).status,401);
 assert.equal((await handle(new Request(base,{method:'DELETE',headers:{authorization:'Bearer '+key}}),env,{})).status,200);
 assert.equal((await handle(new Request(base),env,{})).status,404);
 const assets={'/live.html':{body:'live app',type:'text/html'},'/index.html':{body:'original app',type:'text/html'}};
 assert.equal(await (await handle(new Request('https://example.test/live/'+id),env,assets)).text(),'live app');
 assert.equal(await (await handle(new Request('https://example.test/'),env,assets)).text(),'original app');sqlite.close();
});
