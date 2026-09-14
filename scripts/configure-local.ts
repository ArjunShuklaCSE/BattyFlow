// Explicit development/setup command. The application never discovers or downloads executables.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { defaults, validateSettings, importManifest, verifyAsset, atomicJson } from '../src/main/settings/store';

const [manifestDirectory, dataDirectory] = process.argv.slice(2);
if (!manifestDirectory || !dataDirectory) throw new Error('Usage: tsx scripts/configure-local.ts <manifest-directory> <app-data-directory>');
const settingsFile = join(resolve(dataDirectory), 'settings.json');
let settings = structuredClone(defaults);
try { settings = validateSettings(JSON.parse(await readFile(settingsFile, 'utf8'))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
// Preserve user preferences and existing model choices. Only configure missing speech assets.
const whisper = settings.whisper ?? await importManifest(join(resolve(manifestDirectory), 'whisper.json'));
const asrModel = settings.asrModel ?? await importManifest(join(resolve(manifestDirectory), 'asrModel.json'));
if (whisper.version !== '1.8.3') throw new Error('WHISPER_VERSION_REQUIRES_1_8_3');
await verifyAsset(whisper); await verifyAsset(asrModel, 'ggml');
if (!asrModel.languages.includes(settings.language)) throw new Error('MODEL_LANGUAGE_UNSUPPORTED');
await atomicJson(settingsFile, { ...settings, whisper, asrModel });
console.log('Local speech runtime, DLLs and model verified. Missing speech settings saved; existing preferences preserved. Restart BattyFlow to apply.');
