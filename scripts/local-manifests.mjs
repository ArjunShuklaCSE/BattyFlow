import { readFile,writeFile,stat,mkdir,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,dirname,join } from 'node:path';
await mkdir('.local/manifests',{recursive:true});
const items=[['whisper','.local/runtime/whisper-1.8.3/Release/whisper-cli.exe','whisper.cpp CPU CLI','1.8.3',[],'https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.3'],['asrModel','.local/models/ggml-tiny.en.bin','Whisper tiny.en F16','ggml-tiny.en',['en'],'https://huggingface.co/ggerganov/whisper.cpp']];
for(const [kind,file,name,version,languages,provenance] of items){const path=resolve(file);const asset={path,name,version,languages,provenance,license:'MIT',size:(await stat(path)).size,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};if(kind==='whisper'){asset.dependencies=[];for(const file of await readdir(dirname(path))){if(file.endsWith('.dll')){const data=await readFile(join(dirname(path),file));asset.dependencies.push({file,size:data.length,sha256:createHash('sha256').update(data).digest('hex')});}}}await writeFile(`.local/manifests/${kind}.json`,JSON.stringify(asset,null,2));}
console.log('Local manifests created; compare model hash with upstream before trusting. These hashes record the acquired files, not a publisher signature.');
