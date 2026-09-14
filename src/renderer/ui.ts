import type { Settings, View, Mode, Profile } from '../shared/types';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const isOverlay = new URLSearchParams(location.search).has('overlay');
el('shell').hidden = isOverlay; el('overlay-shell').hidden = !isOverlay;
let view: View | null = null; let initialized = false;
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
function safe(action: () => Promise<unknown>): void { el('error').hidden = true; void action().catch(error => { el('error').hidden = false; el('error').textContent = String(error instanceof Error ? error.message : 'Operation failed').replace(/^Error invoking remote method '[^']+': Error: /,''); }); }
function setForm(s: Settings): void {
  select('mode').value = s.mode; select('profile').value = s.profile;
  input('language').value = s.language; input('max-seconds').value = String(s.maxSeconds); input('threads').value = String(s.threads);
  input('dictation-shortcut').value = s.shortcut; input('command-shortcut').value = s.commandShortcut; input('edit-shortcut').value = s.editShortcut;
  input('target-language').value = s.targetLanguage; input('translation-pairs').value = s.translationPairs.join(',');
  input('silence-stop').checked = s.silenceStop; input('preview').checked = s.preview;
}
function renderModels(s: Settings): void {
  const list = el('model-list'); list.replaceChildren();
  for (const [key,title] of [['whisper','Whisper runtime'],['asrModel','Speech recognition model'],['llama','Optional local cleanup runtime'],['llmModel','Optional transformation model']] as const) {
    const row = document.createElement('article'); row.className = 'asset';
    const heading = document.createElement('h2'); heading.textContent = title; row.append(heading);
    const status = document.createElement('p'); const asset = s[key]; status.textContent = asset ? `${asset.name} · ${asset.version} · ${(asset.size / 1048576).toFixed(1)} MiB\nLanguages: ${asset.languages.join(', ') || 'Runtime'} · License: ${asset.license}\nSHA-256: ${asset.sha256}` : 'Not imported'; row.append(status);
    const button = document.createElement('button'); button.textContent = 'Import local manifest'; button.addEventListener('click', () => safe(() => window.batty.importAsset(key))); row.append(button); list.append(row);
  }
}
function update(next: View): void {
  const previous = view; view = next;
  const time = `${Math.floor(next.elapsed/60)}:${String(Math.floor(next.elapsed%60)).padStart(2,'0')}`;
  const active = ['arming','recording','transcribing','transforming','inserting'].includes(next.state);
  const hasResult = ['ready','idle'].includes(next.state) && !!next.text;
  el('setup-required').hidden = !!next.settings.whisper && !!next.settings.asrModel;
  document.body.classList.toggle('recording', next.state === 'recording');
  el('state').textContent = next.state; el('elapsed').textContent = time; el('overlay-time').textContent = time; el('overlay-state').textContent = next.state;
  el<HTMLProgressElement>('meter').value = next.level; el<HTMLProgressElement>('overlay-meter').value = next.level;
  el('result').textContent = next.text || 'Your transcript will appear here.'; el('result').classList.toggle('empty', !next.text);
  el('partial').hidden = !next.partial; el('partial').textContent = `Incremental preview · revisable: ${next.partial}`;
  el('notice').textContent = next.notice; el('overlay-notice').textContent = next.notice;
  el('overlay-text').textContent = next.partial || next.text || (next.state === 'recording' ? 'Listening…' : next.state === 'arming' ? 'Preparing microphone…' : next.state === 'error' ? 'Recording could not finish' : next.state === 'cancelled' ? 'Recording discarded' : next.state === 'transcribing' ? 'Transcribing locally…' : 'Ready when you are.');
  el<HTMLButtonElement>('overlay-stop').disabled = next.state !== 'recording';
  el<HTMLButtonElement>('overlay-cancel').disabled = !active && next.state !== 'ready';
  el<HTMLButtonElement>('overlay-dismiss').disabled = active || next.state === 'ready';
  el<HTMLButtonElement>('copy').disabled = !hasResult; el<HTMLButtonElement>('overlay-copy').disabled = !hasResult; el<HTMLButtonElement>('insert-test').disabled = next.state !== 'ready' || !hasResult;
  el<HTMLButtonElement>('cancel').disabled = !active && next.state !== 'ready';
  el<HTMLButtonElement>('record').disabled = active && !['recording','arming'].includes(next.state);
  el('record').firstChild!.textContent = next.state === 'recording' ? 'Stop recording ' : next.state === 'arming' ? 'Cancel arming ' : active ? 'Processing… ' : 'Start recording ';
  el('shortcut').textContent = next.settings.shortcut.replace('CommandOrControl','Ctrl/Cmd').replaceAll('+',' ');
  el('limit-label').textContent = ` / ${next.settings.maxSeconds}s safety limit`;
  if (!initialized) { setForm(next.settings); initialized = true; }
  const editOption = select('mode').querySelector<HTMLOptionElement>('option[value="edit"]');
  if (editOption) { editOption.disabled = next.capabilities['platform'] !== 'windows'; editOption.textContent = editOption.disabled ? 'Edit selection · adapter unavailable' : 'Edit selection · preview only'; }
  if (!previous || JSON.stringify(previous.settings) !== JSON.stringify(next.settings)) renderModels(next.settings);
  const dl = el('capabilities'); dl.replaceChildren(); for (const [key, value] of Object.entries(next.capabilities)) { const dt = document.createElement('dt'); dt.textContent = key; const dd = document.createElement('dd'); dd.textContent = value; dl.append(dt,dd); }
}
window.batty.onView(update); safe(async () => update(await window.batty.snapshot()));
el('record').addEventListener('click', () => safe(() => window.batty.toggle(select('mode').value as Mode)));
for (const id of ['cancel','overlay-cancel']) el(id).addEventListener('click', () => safe(() => window.batty.cancel()));
for (const id of ['copy','overlay-copy']) el(id).addEventListener('click', () => safe(() => window.batty.copy(view?.id ?? '')));
el('overlay-stop').addEventListener('click', () => { if (view?.state === 'recording') safe(() => window.batty.toggle()); });
el('overlay-settings').addEventListener('click', () => safe(() => window.batty.showSettings()));
el('overlay-dismiss').addEventListener('click', () => safe(() => window.batty.hideOverlay()));
el('setup-models').addEventListener('click', () => document.querySelector<HTMLButtonElement>('[data-page="models"]')?.click());
el('insert-test').addEventListener('click', () => safe(async () => { const area = el<HTMLTextAreaElement>('test-field'); const start = area.selectionStart; const end = area.selectionEnd; const value = area.value; const text = await window.batty.insertTest(view?.id ?? ''); if (area.value === value && area.selectionStart === start && area.selectionEnd === end) { area.setRangeText(text, start, end, 'end'); area.focus(); } else throw new Error('Test field changed. Result remains available for copying.'); }));
const titles: Record<string,string> = { studio:'Dictation studio', models:'Local models', vocabulary:'Developer vocabulary', preferences:'Preferences', privacy:'Privacy & capabilities' };
document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => button.addEventListener('click', () => {
  const page = button.dataset['page']!; document.querySelectorAll<HTMLElement>('.page').forEach(section => { section.hidden = section.id !== page; });
  document.querySelectorAll('.nav').forEach(item => item.classList.toggle('active', item === button)); el('page-title').textContent = titles[page] ?? page;
  if (page === 'vocabulary') safe(async () => { el<HTMLTextAreaElement>('dictionary').value = JSON.stringify(await window.batty.dictionary(), null, 2); });
}));
el('save-dictionary').addEventListener('click', () => safe(async () => { await window.batty.saveDictionary(JSON.parse(el<HTMLTextAreaElement>('dictionary').value)); el('notice').textContent = 'Vocabulary saved.'; }));
el('import-dictionary').addEventListener('click', () => safe(async () => { const value = await window.batty.importDictionary(); if (value) el<HTMLTextAreaElement>('dictionary').value = JSON.stringify(value,null,2); }));
el('export-dictionary').addEventListener('click', () => safe(() => window.batty.exportDictionary()));
el('refresh-devices').addEventListener('click', () => safe(async () => { const devices = await window.batty.devices(); const menu = select('microphone'); menu.replaceChildren(new Option('System default', '')); for (const d of devices) menu.add(new Option(d.label,d.deviceId)); menu.value = view?.settings.microphone ?? ''; }));
el('settings-form').addEventListener('submit', event => { event.preventDefault(); safe(async () => {
  if (!view) return;
  const next: Settings = { ...view.settings, microphone: select('microphone').value, language: input('language').value, maxSeconds: Number(input('max-seconds').value), threads: Number(input('threads').value), shortcut: input('dictation-shortcut').value, commandShortcut: input('command-shortcut').value, editShortcut: input('edit-shortcut').value, silenceStop: input('silence-stop').checked, preview: input('preview').checked, targetLanguage: input('target-language').value, translationPairs: input('translation-pairs').value.split(',').map(s => s.trim()).filter(Boolean) };
  await window.batty.save(next); el('notice').textContent = 'Preferences saved.';
}); });
for (const id of ['mode','profile']) el(id).addEventListener('change', () => safe(async () => { if (view) await window.batty.save({ ...view.settings, mode: select('mode').value as Mode, profile: select('profile').value as Profile }); }));
