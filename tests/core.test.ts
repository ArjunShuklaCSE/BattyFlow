import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/main/session';
import { starter, resolve, protect, restore, validateDictionary } from '../src/main/vocabulary/resolver';
import { EnergyVad, Resampler, readWav, wav, rms } from '../src/shared/audio';
import { wer, identifiers } from '../benchmark/metrics';
import { InsertionTransaction } from '../src/main/insertion/transaction';
import { finalPipeline } from '../src/main/pipeline';
import { PreviewScheduler } from '../src/main/asr/preview';
import { defaults, validateSettings } from '../src/main/settings/store';
import { runProcess } from '../src/main/privacy/process';
import type { Target, Dictionary } from '../src/shared/types';
const target: Target = { platform:'test', identity:'window-1', field:'field-1', secure:false, terminal:false };
function ready(): Session { const s = new Session('dictation',target); s.move('recording'); s.move('transcribing'); s.move('ready'); return s; }
test('valid transitions and exactly one insertion claim', () => { const s = ready(); assert.throws(()=>s.move('recording')); s.claimInsertion(); assert.throws(()=>s.claimInsertion()); });
test('cancellation is idempotent and prevents delivery', () => { const s = ready(); s.cancel(); s.cancel(); assert.equal(s.state,'cancelled'); assert.equal(s.alive(),false); assert.throws(()=>s.claimInsertion()); });
test('scope, exact canonical spelling, word boundaries and meaningful like', () => {
  assert.equal(resolve('call get user by id',starter,'code').text,'call getUserById');
  assert.equal(resolve('get user by id',starter,'neutral').text,'get user by id');
  assert.equal(resolve('I like this API and useEffect',starter,'code').text,'I like this API and useEffect');
  assert.equal(resolve('reuse effects',starter,'code').text,'reuse effects');
});
test('longest explicit alias wins; equal alternatives remain ambiguous', () => {
  const dictionary: Dictionary = {schemaVersion:1,entries:[{canonical:'short',spokenAliases:['get user']},{canonical:'long',spokenAliases:['get user id']}]};
  assert.equal(resolve('get user id',dictionary,'code').text,'long');
  dictionary.entries = [{canonical:'userId',spokenAliases:['user id']},{canonical:'userID',spokenAliases:['user id']}];
  assert.deepEqual(resolve('user id',dictionary,'code').ambiguities,['user id']); assert.equal(resolve('user id',dictionary,'code').text,'user id');
});
test('dictionary rejects invalid and duplicate entries',()=>{assert.throws(()=>validateDictionary({schemaVersion:2,entries:[]}));assert.throws(()=>validateDictionary({schemaVersion:1,entries:[{canonical:'A',spokenAliases:['a','a']}]}));});
test('protected repeats, removal, fabricated and duplicate tokens',()=>{
  const p = protect('OAuth OAuth getUserById',['OAuth','getUserById']);
  assert.equal(restore(p.text,p.tokens),'OAuth OAuth getUserById');
  assert.throws(()=>restore('',p.tokens)); assert.equal(restore('',p.tokens,true),'');
  assert.throws(()=>restore(p.text+p.text,p.tokens)); assert.throws(()=>restore(p.text+' BF_012345678901234567890123_4_END',p.tokens));
});
test('WER substitutions, insertion, deletion and silence',()=>{
  assert.equal(wer('a b c','a d c').wer,1/3); assert.equal(wer('a b','a').deletions,1); assert.equal(wer('a','a b').insertions,1);
  assert.equal(wer('','hello').wer,null); assert.equal(wer('','hello').hallucinatedWords,1); assert.equal(wer('Hello, API!','hello api').wer,0);
});
test('identifier scoring preserves case and repeated occurrence counts',()=>{
  assert.deepEqual(identifiers('userId userID userId OAuth',[{text:'userId',count:3}],['userId','OAuth']),{correct:2,total:3,preservation:2/3,spurious:1});
});
test('PCM WAV round-trip and invalid container rejection',()=>{
  const pcm = Float32Array.from([0,.5,-.5,1,-1]); const decoded = readWav(wav(pcm));
  decoded.forEach((x,i)=>assert.ok(Math.abs(x-pcm[i]!)<.0001)); assert.throws(()=>readWav(Buffer.from('not a wav')));
});
test('streaming resampler preserves 1kHz, rejects aliasing and has correct duration',()=>{
  function tone(hz:number): Float32Array { const r = new Resampler(48000); const results:number[]=[]; for(let start=0;start<48000;start+=128){results.push(...r.push(Float32Array.from({length:Math.min(128,48000-start)},(_,i)=>Math.sin(2*Math.PI*hz*(start+i)/48000))));}results.push(...r.push(new Float32Array(),true));return Float32Array.from(results); }
  const low=tone(1000),high=tone(12000); assert.ok(Math.abs(low.length-16000)<=1); assert.ok(rms(low)>.65); assert.ok(rms(high)<.025);
});
test('VAD silence and short click do not count as speech',()=>{ const v = new EnergyVad(); for(let i=0;i<100;i++)v.accept(new Float32Array(320));assert.equal(v.hasSpeech,false);v.accept(new Float32Array(320).fill(.1));assert.equal(v.hasSpeech,false); });
test('insertion focus switch and rich clipboard fail closed',async()=>{
  let pasted=0; const clipboard={formats:()=>['text/plain'],readText:()=> 'old',writeText:()=>{},clear:()=>{}};
  const tx=new InsertionTransaction(); assert.equal(await tx.run(ready(),'hello',clipboard,{current:async()=>({...target,field:'changed'}),paste:async()=>{pasted++;}}),'manual');
  assert.equal(await tx.run(ready(),'hello',{...clipboard,formats:()=>['text/html']},{current:async()=>target,paste:async()=>{pasted++;}}),'manual'); assert.equal(pasted,0);
});
test('clipboard race preserves newer copy; insertion cannot repeat',async()=>{
  const s=ready();let text='old',pasted=0;const clip={formats:()=>['text/plain'],readText:()=>text,writeText:(x:string)=>{text=x;},clear:()=>{text='';}}; const delivery={current:async()=>target,paste:async()=>{pasted++;text='new user copy';}};const tx=new InsertionTransaction();
  assert.equal(await tx.run(s,'payload',clip,delivery),'attempted');assert.equal(text,'new user copy');assert.equal(await tx.run(s,'payload',clip,delivery),'manual');assert.equal(pasted,1);
});
test('cancel during revalidation never sends a paste',async()=>{
  const s=ready();let checks=0,pastes=0,text='old';const tx=new InsertionTransaction();await assert.rejects(tx.run(s,'payload',{formats:()=>['text/plain'],readText:()=>text,writeText:x=>{text=x;},clear:()=>{}},{current:async()=>{if(++checks===2)s.cancel();return target;},paste:async()=>{pastes++;}}));assert.equal(pastes,0);assert.equal(text,'old');
});
test('pipeline ignores late ASR after cancel',async()=>{
  const s=new Session('dictation',target);s.move('recording');s.move('transcribing');let finish!:(text:string)=>void;const delayed=new Promise<string>(r=>{finish=r;});const work=finalPipeline(s,new Float32Array(3200).fill(.1),{transcribe:async()=>delayed},null,starter,defaults,()=>{});s.cancel();finish('must not insert');await assert.rejects(work);assert.equal(s.text,'');assert.equal(s.state,'cancelled');
});
test('silence pipeline never invokes ASR',async()=>{const s=new Session('dictation',target);s.move('recording');s.move('transcribing');await finalPipeline(s,new Float32Array(16000),{transcribe:async()=>{throw Error('must not run');}},null,starter,defaults,()=>{});assert.equal(s.text,'');assert.equal(s.state,'ready');});
test('cleanup failure returns preserved raw text',async()=>{const s=new Session('dictation',target);s.move('recording');s.move('transcribing');await finalPipeline(s,new Float32Array(3200).fill(.1),{transcribe:async()=> 'do not change OAuth 42'},{transform:async()=> 'change everything'},starter,defaults,()=>{});assert.equal(s.text,'do not change OAuth 42');});
test('preview is bounded and cancellation drops late outputs',async()=>{const p=new PreviewScheduler();let finish!:(x:string)=>void;let published=0;assert.equal(p.offer(()=>new Promise(r=>{finish=r;}),()=>{published++;}),true);assert.equal(p.offer(async()=>'',()=>{}),false);const stop=p.stop();finish('late');await stop;assert.equal(published,0);});
test('settings reject unsafe shortcuts and excessive buffers',()=>{assert.throws(()=>validateSettings({...defaults,shortcut:'Escape'}));assert.throws(()=>validateSettings({...defaults,maxSeconds:9999}));});
test('native process timeout, output limit, crash and pre-cancel are bounded',async()=>{
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:new AbortController().signal,timeoutMs:50}),/TIMEOUT/);
  await assert.rejects(runProcess(process.execPath,['-e','process.stdout.write("x".repeat(20000))'],{signal:new AbortController().signal,maxBytes:100}),/OUTPUT_LIMIT/);
  await assert.rejects(runProcess(process.execPath,['-e','process.exit(3)'],{signal:new AbortController().signal}),/PROCESS_FAILED/);
  const c=new AbortController();c.abort();await assert.rejects(runProcess(process.execPath,[],{signal:c.signal}),/CANCELLED/);
});
