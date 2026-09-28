import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Keep Python's interpreter symlinks outside Next's source tracing root.
const environment=process.env.UV_PROJECT_ENVIRONMENT??path.join(path.dirname(root),`${path.basename(root)}-runtime`,'sidecar-venv');
const child=spawn('uv',['run','--frozen','python','-m','uvicorn','audio_sidecar.server:app','--host','127.0.0.1','--port','8790'],{cwd:path.join(root,'sidecar'),env:{...process.env,UV_PROJECT_ENVIRONMENT:environment},stdio:'inherit'});
child.on('error',()=>{console.error('uv를 설치한 뒤 npm run audio:server를 다시 실행해 주세요.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
