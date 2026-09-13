import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve as pathResolve, dirname, relative } from 'node:path';
import { cpus, platform, release, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Whisper } from '../src/main/asr/whisper';
import { Llama } from '../src/main/llm/llama';
import { importManifest, privateTempRoot, defaults } from '../src/main/settings/store';
import { readWav, EnergyVad } from '../src/shared/audio';
import { resolve, starter, protect, restore, literalIdentifiers } from '../src/main/vocabulary/resolver';
import { wer, identifiers, percentile, words } from './metrics';
import type { Profile, TextTransformer } from '../src/shared/types';
const args = process.argv.slice(2); const option = (name:string, fallback='') => {const index=args.indexOf(name);return index>=0 ? args[index+1] ?? fallback : fallback;};
for (const name of ['--max-wer','--max-p95-ms','--max-latency-ratio','--max-wer-delta']) {
  if (args.includes(name) && (!option(name) || !Number.isFinite(Number(option(name))) || Number(option(name)) < 0)) throw new Error(`INVALID_THRESHOLD:${name}`);
}
interface Fixture {id:string;audio:string;sha256:string;duration:number;language:string;provenance:string;license:string;verbatim:string;cleaned:string;identifiers:{text:string;count:number}[];critical?:string[];profile?:Profile;tags:string[]}
const manifestPath=pathResolve(option('--manifest','benchmark/manifest.json'));
const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as {schemaVersion:number;suite:string;fixtures:Fixture[]};
if(manifest.schemaVersion!==1 || !Array.isArray(manifest.fixtures) || manifest.fixtures.length>1000)throw Error('INVALID_BENCHMARK_MANIFEST');
const runtime=await importManifest(pathResolve(option('--runtime','.local/manifests/whisper.json')));
const model=await importManifest(pathResolve(option('--model','.local/manifests/asrModel.json')));
const output=pathResolve(option('--output','benchmark/results/latest'));await mkdir(output,{recursive:true});
const tempRoot=pathResolve('.local/benchmark-sessions');await privateTempRoot(tempRoot);
const engine=new Whisper(runtime,model,tempRoot,Number(option('--threads','4')));
let transformer:TextTransformer|null=null;
let transformationMetadata:unknown=null;
if(option('--llama')&&option('--llm-model')){
  const llama=await importManifest(pathResolve(option('--llama'))),llm=await importManifest(pathResolve(option('--llm-model')));transformer=new Llama(llama,llm,tempRoot,4);
  transformationMetadata={runtime:{name:llama.name,version:llama.version,sha256:llama.sha256},model:{name:llm.name,version:llm.version,sha256:llm.sha256,languages:llm.languages}};
}
let commit='unversioned workspace';try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
const cases:any[]=[];const failures:string[]=[];const passes=Number(option('--passes','1'));if(!Number.isInteger(passes)||passes<1||passes>10)throw Error('INVALID_PASS_COUNT');
const allTerms=starter.entries.map(e=>e.canonical);
async function cleanup(text:string,profile:Profile,useVocabulary:boolean,signal:AbortSignal):Promise<string>{
  if(!transformer)throw Error('LOCAL_TRANSFORMER_UNAVAILABLE');
  const resolved=useVocabulary?resolve(text,starter,profile):{text,spans:[]};const p=protect(resolved.text,[...literalIdentifiers(resolved.text),...(useVocabulary?[...resolved.spans.map(s=>s.canonical),...starter.entries.map(e=>e.canonical)]:[])]);
  return restore(await transformer.transform({mode:'dictation',transcript:p.text,profile,protectedSpans:[...p.tokens.keys()]},signal),p.tokens);
}
function score(text:string,reference:string,f:Fixture){return {text,wer:wer(reference,text),identifiers:identifiers(text,f.identifiers,allTerms),criticalCandidates:(f.critical??[]).filter(term=>!words(text).join(' ').includes(words(term).join(' '))),humanReview:'Required for meaning, corrections, names, negation, and numeric equivalence; lexical candidates are not semantic proof'};}
for(let pass=0;pass<passes;pass++)for(const fixture of manifest.fixtures){
  const path=pathResolve(dirname(manifestPath),fixture.audio??'');const rel=relative(dirname(manifestPath),path);
  if(rel.startsWith('..')||!fixture.sha256||!fixture.provenance||!fixture.license)throw Error(`FIXTURE_METADATA_REQUIRED:${fixture.id}`);
  const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==fixture.sha256)throw Error(`FIXTURE_HASH_MISMATCH:${fixture.id}`);
  const pcm=readWav(bytes);if(Math.abs(pcm.length/16000-fixture.duration)>.001)throw Error(`FIXTURE_DURATION_MISMATCH:${fixture.id}`);
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),100000);
  const start=performance.now();const entry:any={id:fixture.id,pass,fixtureHash:fixture.sha256,duration:fixture.duration,tags:fixture.tags,provenance:fixture.provenance};
  try{
    const raw=await engine.transcribe(pcm,fixture.language,controller.signal);entry.asrMs=performance.now()-start;entry.realTimeFactor=entry.asrMs/1000/fixture.duration;
    const vad=new EnergyVad();let firstSpeech:number|null=null;for(let i=0;i<pcm.length;i+=320){if(vad.accept(pcm.subarray(i,i+320))&&firstSpeech===null)firstSpeech=i/16;}
    entry.speechDetectionMs=firstSpeech;entry.vadSpeech=vad.hasSpeech;
    const delivered=vad.hasSpeech?raw:'';entry.raw=score(raw,fixture.verbatim,fixture);entry.gatedRaw=score(delivered,fixture.verbatim,fixture);
    entry.vocabularyOnly=score(resolve(delivered,starter,fixture.profile??'neutral').text,fixture.cleaned,fixture);
    for(const [key,useVocabulary] of [['asrCleanup',false],['asrVocabularyCleanup',true]] as const){
      if(!transformer){entry[key]={status:'unavailable: no validated local transformer'};continue;}
      const before=performance.now();try{entry[key]={...score(vad.hasSpeech?await cleanup(raw,fixture.profile??'neutral',useVocabulary,controller.signal):'',fixture.cleaned,fixture),ms:performance.now()-before,status:'measured'};}catch(error){entry[key]={status:'failed',error:error instanceof Error?error.message:'TRANSFORM_FAILED'};failures.push(`${fixture.id}:${key}:${entry[key].error}`);}
    }
    if(!fixture.verbatim && delivered)failures.push(`${fixture.id}:silence_delivery`);
    process.stdout.write(`${pass+1}/${passes} ${fixture.id}: ${Math.round(entry.asrMs)} ms; raw WER ${entry.raw.wer.wer??'undefined'}\n`);
  }catch(error){entry.error=error instanceof Error?error.message:'INFERENCE_FAILED';failures.push(`${fixture.id}:${entry.error}`);}
  finally{clearTimeout(timeout);pcm.fill(0);cases.push(entry);}
}
const measured=cases.filter(x=>typeof x.asrMs==='number');const speechMeasured=measured.filter(x=>x.raw.wer.referenceWords>0);const edits=speechMeasured.reduce((n,x)=>n+x.raw.wer.substitutions+x.raw.wer.deletions+x.raw.wer.insertions,0);const referenceWords=speechMeasured.reduce((n,x)=>n+x.raw.wer.referenceWords,0);
const summary={sampleCount:measured.length,rawCorpusWer:referenceWords?edits/referenceWords:null,asrMs:{p50:percentile(measured.map(x=>x.asrMs),.5),p95:percentile(measured.map(x=>x.asrMs),.95)},rawSilenceHallucinations:measured.filter(x=>x.raw.wer.wer===null).reduce((n,x)=>n+x.raw.wer.hallucinatedWords,0),criticalReviewCandidates:measured.filter(x=>x.raw.criticalCandidates.length).map(x=>({id:x.id,missing:x.raw.criticalCandidates})),vocabularyPreservation:(()=>{const correct=measured.reduce((n,x)=>n+x.vocabularyOnly.identifiers.correct,0),total=measured.reduce((n,x)=>n+x.vocabularyOnly.identifiers.total,0);return{correct,total,rate:total?correct/total:null};})()};
if(option('--max-wer')&&summary.rawCorpusWer!==null&&summary.rawCorpusWer>Number(option('--max-wer')))failures.push('RAW_WER_THRESHOLD');
if(option('--max-p95-ms')&&summary.asrMs.p95!==null&&summary.asrMs.p95>Number(option('--max-p95-ms')))failures.push('ASR_P95_THRESHOLD');
if(option('--baseline')){const baseline=JSON.parse(await readFile(pathResolve(option('--baseline')),'utf8'));if(baseline.runtime.sha256!==runtime.sha256||baseline.model.sha256!==model.sha256||cases.some(x=>!baseline.cases.some((b:any)=>b.id===x.id&&b.fixtureHash===x.fixtureHash)))failures.push('BASELINE_INPUT_OR_ENGINE_MISMATCH');const ratio=Number(option('--max-latency-ratio','1.25'));if(summary.asrMs.p95!==null&&baseline.summary.asrMs.p95&&summary.asrMs.p95>baseline.summary.asrMs.p95*ratio)failures.push('BASELINE_LATENCY_REGRESSION');if(summary.rawCorpusWer!==null&&baseline.summary.rawCorpusWer!==null&&summary.rawCorpusWer>baseline.summary.rawCorpusWer+Number(option('--max-wer-delta','0.02')))failures.push('BASELINE_WER_REGRESSION');}
const report={schemaVersion:1,at:new Date().toISOString(),commit,suite:manifest.suite,hardware:{cpu:cpus()[0]?.model,logicalCPUs:cpus().length,memoryBytes:totalmem(),os:platform(),release:release(),arch:process.arch},transformer:transformationMetadata,runtime:{name:runtime.name,version:runtime.version,sha256:runtime.sha256},model:{name:model.name,sha256:model.sha256,languages:model.languages},settings:{threads:engine.threads,backend:'CPU (-ng)',profile:'per fixture',passes},limitations:['Synthetic local smoke suite; no human-speech or accent validation','Every CLI invocation reloads the model; pass 0 is first pass, later passes use warm OS cache; not persistent warm-model latency','ASR time includes checksum, process startup, model load, WAV I/O, inference and cleanup','Child peak RSS and separately measured model-load time unavailable','No external insertion performed; insertion latency not measured','Cleanup columns unavailable unless explicit local transformer supplied','Critical-content candidates need human review','Small sample p95 is descriptive; not a tail-latency claim'],runnerPeakRssKiB:process.resourceUsage().maxRSS,summary,failures,cases};
await writeFile(pathResolve(output,'report.json'),JSON.stringify(report,null,2));
const scoreCell=(x:any)=>x?.status==='failed'?'FAILED':x?.wer ? x.wer.wer?.toFixed(3)??'undefined':'unavailable';
const rows=cases.map(x=>`| ${x.id} | ${x.pass+1} | ${x.error??x.raw.wer.wer?.toFixed(3)??'undefined'} | ${scoreCell(x.asrCleanup)} | ${scoreCell(x.asrVocabularyCleanup)} | ${x.asrMs?.toFixed(0)??'—'} | ${x.vocabularyOnly?.identifiers.correct??'—'}/${x.vocabularyOnly?.identifiers.total??'—'} |`).join('\n');
await writeFile(pathResolve(output,'summary.md'),`# ${manifest.suite}\n\n${report.at} · ${report.hardware.cpu} · ${report.hardware.os} ${report.hardware.release}\n\nRuntime ${runtime.version}; model ${model.name}. Commit: ${commit}.\n\n${summary.sampleCount} samples, raw corpus WER ${summary.rawCorpusWer?.toFixed(3)}, ASR p50 ${summary.asrMs.p50?.toFixed(0)} ms / p95 ${summary.asrMs.p95?.toFixed(0)} ms.\n\n| Clip | Pass | Raw WER | Cleanup WER | Vocabulary + cleanup WER | ASR ms | Exact identifiers after vocabulary only |\n|---|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Limitations\n\n${report.limitations.map(x=>`- ${x}`).join('\n')}\n\n## Required failures\n\n${failures.length?failures.join('\n'):'None in executed ASR gates. This does not complete product acceptance.'}\n`);
if(failures.length)process.exitCode=1;
