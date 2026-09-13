import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCleanup, validateDraft } from '../src/main/llm/validation';
import { literalIdentifiers } from '../src/main/vocabulary/resolver';
import { runProcess } from '../src/main/privacy/process';
import { Whisper } from '../src/main/asr/whisper';
import type { Asset } from '../src/shared/types';
test('cleanup keeps negation, numbers and meaningful like',()=>{
  assert.throws(()=>validateCleanup('Do not invite Sam','Invite Sam'),/NEGATION/);
  assert.throws(()=>validateCleanup('Set timeout to 42','Set timeout to 41'),/NUMBER/);
  assert.throws(()=>validateCleanup('I like this API','This API'),/MEANINGFUL_LIKE/);
  assert.doesNotThrow(()=>validateCleanup('Meet at five actually six and do not invite Sam','Meet at six and do not invite Sam'));
});
test('command draft cannot claim execution or invent a shell block',()=>{
  assert.throws(()=>validateDraft('Find why login fails','```bash\nfix login\n```'));
  assert.throws(()=>validateDraft('Add a test',"I've added a test"));
});
test('literal identifier detection preserves spellings without inventing aliases',()=>{
  assert.deepEqual(literalIdentifiers('call fetchConfig and user_id'),['fetchConfig','user_id']);
  assert.deepEqual(literalIdentifiers('get user by id'),[]);
});
test('process pipe decodes split UTF-8 correctly',async()=>{
  const result=await runProcess(process.execPath,['-e',"const b=Buffer.from('नमस्ते');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),30)"],{signal:new AbortController().signal});assert.equal(result.stdout,'नमस्ते');
});
test('English-only ASR rejects an unsupported language before native execution',async()=>{
  const asset={languages:['en']} as Asset;const engine=new Whisper(asset,asset,'unused');
  await assert.rejects(engine.transcribe(new Float32Array(320), 'fr', new AbortController().signal),/LANGUAGE_UNSUPPORTED/);
});
