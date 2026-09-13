import { importManifest,privateTempRoot } from '../src/main/settings/store';
import { Llama } from '../src/main/llm/llama';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const temp=resolve('.local/llm-smoke-sessions');await privateTempRoot(temp);
const engine=new Llama(await importManifest(resolve('.local/manifests/llama.json')),await importManifest(resolve('.local/manifests/llmModel.json')),temp,4);
const cases=[];
for(const [mode,transcript] of [['dictation','Meet at five, actually six, and do not invite Sam.'],['dictation','I like this API.'],['command','Ask Claude Code to find why login fails and add a regression test.']] as const){const start=performance.now();try{const text=await engine.transform({mode,transcript,profile:'neutral',protectedSpans:[]},new AbortController().signal);cases.push({mode,transcript,text,ms:performance.now()-start});}catch(e){cases.push({mode,error:String(e),ms:performance.now()-start});}}
await writeFile('.local/llm-smoke.json',JSON.stringify(cases,null,2));console.log(JSON.stringify(cases,null,2));
