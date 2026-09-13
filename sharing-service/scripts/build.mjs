import {readFileSync,writeFileSync,mkdirSync,readdirSync,cpSync,rmSync} from 'node:fs';
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',txt:'text/plain; charset=utf-8'};
const assets=Object.fromEntries(readdirSync('public').map(name=>['/'+name,{body:readFileSync('public/'+name,'utf8'),type:types[name.split('.').at(-1)]??'text/plain'}]));
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js',readFileSync('worker/index.js','utf8')+'\nconst assets='+JSON.stringify(assets)+';\nexport default {fetch(request,env){return handle(request,env,assets)}};\n');
cpSync('.openai/hosting.json','dist/.openai/hosting.json');cpSync('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Built Worker with '+Object.keys(assets).length+' assets and D1 migrations.');
