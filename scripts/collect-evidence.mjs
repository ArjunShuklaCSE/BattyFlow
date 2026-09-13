import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('docs/evidence',{recursive:true});
const files=[
 ['.local/desktop-smoke.json','desktop-bootstrap.json'],
 ['.local/capture-smoke/evidence.json','capture.json'],
 ['.local/physical-smoke/evidence.json','physical-microphone.json'],
 ['.local/preview-smoke/evidence.json','preview.json'],
 ['.local/failure-smoke/evidence.json','controlled-failures.json'],
 ['.local/target-smoke/evidence.json','windows-target.json'],
 ['.local/network-observation.json','network-observation.json'],
 ['.local/llm-smoke.json','llm-smoke.json'],
 ['benchmark/results/baseline-final/report.json','baseline.json'],
 ['benchmark/results/baseline-final/summary.md','baseline.md'],
 ['benchmark/results/cleanup-final/report.json','cleanup-comparison.json'],
 ['benchmark/results/cleanup-final/summary.md','cleanup-comparison.md']
];
for(const [from,to] of files)await cp(from,`docs/evidence/${to}`);
for(const kind of ['whisper','asrModel','llama','llmModel']){const asset=JSON.parse(await readFile(`.local/manifests/${kind}.json`,'utf8'));asset.path=asset.path.split(/[\\/]/).at(-1);await writeFile(`docs/evidence/${kind}-asset.json`,JSON.stringify(asset,null,2));}
console.log('Collected synthetic/test-only evidence. Physical microphone evidence contains no audio or transcript.');
