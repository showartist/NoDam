import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
const source=process.env.SCENENOTE_DB??path.resolve('.data/scenesync.db'),target=process.argv[2];
if(!target||existsSync(target)||!existsSync(source))throw new Error('존재하는 DB와 새 백업 경로가 필요합니다. 기존 파일을 덮어쓰지 않습니다.');
mkdirSync(path.dirname(path.resolve(target)),{recursive:true});
const d=new DatabaseSync(source,{readOnly:true});await backup(d,target);d.close();
const check=new DatabaseSync(target,{readOnly:true});const result=check.prepare('PRAGMA integrity_check').get();check.close();if(result.integrity_check!=='ok')throw new Error('백업 DB 무결성 검사 실패');console.log('DB 백업 및 무결성 검사 완료. 녹음 파일은 별도로 보존하세요.');
