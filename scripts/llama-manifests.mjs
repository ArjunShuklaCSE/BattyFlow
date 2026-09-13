import { readFile,writeFile,readdir,stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve,dirname,join } from 'node:path';
const runtime=resolve('.local/runtime/llama-b6532/llama-cli.exe');
const help=spawnSync(runtime,['--help'],{encoding:'utf8',windowsHide:true});
await writeFile('.local/llama-help.txt',help.stdout+help.stderr);
console.log((help.stdout+help.stderr).split('\n').filter(x=>/conversation|display-prompt|simple-io|file |predict|ctx-size|log-disable|version|chat-template/.test(x)).join('\n'));
for(const [kind,path,name,license,version,languages,provenance] of [
  ['llama',runtime,'llama.cpp CPU CLI','MIT','b6532',[],'https://github.com/ggml-org/llama.cpp/releases/tag/b6532'],
  ['llmModel',resolve('.local/models/qwen2.5-0.5b-instruct-q4_k_m.gguf'),'Qwen2.5 0.5B Instruct Q4_K_M','Apache-2.0','Qwen2.5-0.5B-Instruct',['en'],'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF']
]){
 const asset={path,name,license,version,languages,provenance,size:(await stat(path)).size,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
 if(kind==='llama'){asset.dependencies=[];for(const file of await readdir(dirname(path))){if(file.endsWith('.dll')){const data=await readFile(join(dirname(path),file));asset.dependencies.push({file,size:data.length,sha256:createHash('sha256').update(data).digest('hex')});}}}
 await writeFile(`.local/manifests/${kind}.json`,JSON.stringify(asset,null,2));
}
