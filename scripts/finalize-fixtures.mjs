import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const path='benchmark/manifest.json'; const manifest=JSON.parse(await readFile(path,'utf8'));
for(const fixture of manifest.fixtures){
  const buffer=await readFile(`benchmark/${fixture.audio}`);let bytes=0;
  for(let p=12;p+8<=buffer.length;){const size=buffer.readUInt32LE(p+4);if(buffer.toString('ascii',p,p+4)==='data'){bytes=size;break;}p+=8+size+size%2;}
  if(!bytes)throw Error('WAV data missing');fixture.duration=bytes/32000;fixture.sha256=createHash('sha256').update(buffer).digest('hex');
  fixture.context={};fixture.vocabulary='starter-v1';
}
await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
