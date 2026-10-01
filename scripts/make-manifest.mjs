// Writes an asset manifest for BattyFlow's "Import your own files", for machines without internet access.
//
//   node scripts/make-manifest.mjs <file> --name "Whisper base.en" --version base.en --license MIT \
//     --languages en --provenance https://huggingface.co/ggerganov/whisper.cpp [--out manifest.json]
//
// For an engine (whisper-cli.exe or llama-cli.exe), the DLLs next to it are hashed too. Hashes record the files
// you have; compare them with the publisher's before trusting them.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const [file, ...rest] = process.argv.slice(2);
const option = name => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : undefined);
if (!file || !option('name') || !option('version') || !option('license') || !option('provenance'))
  throw Error(
    'Usage: node scripts/make-manifest.mjs <file> --name N --version V --license L --provenance URL [--languages en,de] [--out F]',
  );
const sha256 = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const path = resolve(file);
const out = resolve(option('out') ?? `${basename(path)}.manifest.json`);
const manifest = {
  path,
  name: option('name'),
  version: option('version'),
  license: option('license'),
  provenance: option('provenance'),
  languages: (option('languages') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  size: (await stat(path)).size,
  sha256: await sha256(path),
};
if (path.toLowerCase().endsWith('.exe')) {
  manifest.dependencies = [];
  for (const dll of (await readdir(dirname(path))).filter(f => f.toLowerCase().endsWith('.dll')).sort()) {
    const dep = join(dirname(path), dll);
    manifest.dependencies.push({ file: dll, size: (await stat(dep)).size, sha256: await sha256(dep) });
  }
}
await writeFile(out, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${out}`);
