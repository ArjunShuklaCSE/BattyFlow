import type { Dictionary, Entry, HistoryEntry, Settings, View, Profile, AssetKind } from '../shared/types';
import { catalog, type CatalogItem } from '../shared/catalog';
import { describe } from '../shared/messages';
import { hydrateIcons, icon } from './icons';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  el.append(...children);
  return el;
}
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
const keyLabel = (accelerator: string) =>
  accelerator
    .split('+')
    .map(part => (part === 'CommandOrControl' || part === 'Control' ? 'Ctrl' : part === 'Super' ? 'Win' : part))
    .join(' + ');
const kbd = (accelerator: string) =>
  keyLabel(accelerator)
    .split(' + ')
    .map(k => `<kbd>${k}</kbd>`)
    .join(' ');

let view: View | null = null;
let page = 'home';
let historyEntries: HistoryEntry[] = [];
let dictionary: Dictionary | null = null;
let scratchSession: string | null = null;
let modelsKey = '';
let settingsKey = '';

function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const node = h('div', { className: `toast ${kind}`, textContent: message });
  $('toasts').append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 7000 : 2600);
}

/** Runs an IPC call and turns error codes into a readable toast. */
function safe(action: () => Promise<unknown>, done?: string): void {
  void action()
    .then(() => done && toast(done))
    .catch((error: unknown) => {
      const code = String(error instanceof Error ? error.message : error).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      );
      toast(describe(code), 'error');
    });
}

// ------------------------------------------------------------------ navigation

function show(next: string): void {
  page = next;
  document.querySelectorAll<HTMLElement>('.page').forEach(section => (section.hidden = section.id !== next));
  document
    .querySelectorAll('.nav')
    .forEach(button => button.classList.toggle('active', (button as HTMLElement).dataset['page'] === next));
  if (next === 'history') loadHistory();
  if (next === 'vocabulary' && !dictionary) loadDictionary();
  if (next === 'settings') void refreshDevices();
}
document
  .querySelectorAll<HTMLButtonElement>('.nav')
  .forEach(button => button.addEventListener('click', () => show(button.dataset['page']!)));
document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-goto],[data-link],[data-import]');
  if (!target) return;
  event.preventDefault();
  if (target.dataset['goto']) show(target.dataset['goto']);
  if (target.dataset['link']) safe(() => window.batty.openLink(target.dataset['link'] as 'repo'));
  if (target.dataset['import'])
    safe(() => window.batty.importAsset(target.dataset['import'] as AssetKind), 'Imported and verified.');
});

// ------------------------------------------------------------------ home

const stateLabel: Record<string, [string, string]> = {
  arming: ['Starting', 'busy'],
  recording: ['Listening', 'rec'],
  transcribing: ['Transcribing', 'busy'],
  transforming: ['Polishing', 'busy'],
  inserting: ['Pasting', 'busy'],
  ready: ['Done', 'ok'],
  cancelled: ['Discarded', ''],
  error: ['Something went wrong', 'warn'],
};

function pushToTalkLabel(v: View): string | null {
  if (v.platform !== 'win32') return null;
  return (
    { 'ctrl-win': 'Ctrl+Win', 'right-ctrl': 'Right Ctrl', 'right-alt': 'Right Alt', 'caps-lock': 'Caps Lock', off: '' }[
      v.settings.pushToTalk
    ] || null
  );
}

function renderHome(v: View): void {
  const ready = !!v.settings.whisper && !!v.settings.asrModel;
  $('setup').hidden = ready;
  if (!ready) renderSetup(v);
  const busy = ['arming', 'transcribing', 'transforming', 'inserting'].includes(v.state);
  document.body.classList.toggle('recording', v.state === 'recording');
  document.body.classList.toggle('busy', busy);
  $('record').style.setProperty('--level', String(Math.min(1, Math.sqrt(v.level) * 2.2)));
  $<HTMLButtonElement>('record').disabled = !ready || busy;
  $('record').setAttribute('aria-label', v.state === 'recording' ? 'Stop recording' : 'Start recording');

  const ptt = pushToTalkLabel(v);
  const title = $('hero-title');
  const sub = $('hero-sub');
  if (v.state === 'recording') {
    title.textContent = 'Listening…';
    sub.textContent =
      v.trigger === 'ptt'
        ? 'Let go of the keys when you’re done.'
        : 'Press the shortcut again, or the button, to finish.';
  } else if (busy) {
    title.textContent =
      v.state === 'transforming'
        ? 'Polishing…'
        : v.state === 'inserting'
          ? 'Pasting…'
          : v.state === 'arming'
            ? 'Starting the microphone…'
            : 'Transcribing…';
    sub.textContent = 'This runs on your computer.';
  } else if (v.state === 'ready' || (v.state === 'idle' && v.delivered)) {
    title.textContent =
      v.delivered === 'pasted' ? 'Pasted.' : v.delivered === 'copied' ? 'Copied to the clipboard.' : 'Done.';
    sub.textContent =
      v.delivered === 'copied'
        ? 'Press Ctrl+V where you want it.'
        : v.delivered === 'pasted'
          ? 'Your words went where your cursor was.'
          : 'Your transcript is below.';
  } else {
    title.innerHTML = ptt ? `Hold ${kbd(ptt)} to talk` : `Press ${kbd(v.settings.shortcut)} to talk`;
    sub.textContent =
      v.settings.delivery === 'paste' && v.platform === 'win32'
        ? 'Let go and your words are typed wherever your cursor is.'
        : v.settings.delivery === 'none'
          ? 'Your words appear here when you stop.'
          : 'When you stop, the text is copied, ready to paste.';
  }
  $('hero-alt').innerHTML =
    ptt && v.state === 'idle' ? `Hands busy? Press ${kbd(v.settings.shortcut)} to start, and again to stop.` : '';

  const [label, kind] =
    stateLabel[v.state] ??
    (v.engineReady ? ['Ready', 'ok'] : ready ? ['Checking engine', 'busy'] : ['Not set up', 'warn']);
  const chip = $('status-chip');
  chip.textContent = label;
  chip.className = `chip ${kind}`;
  const seconds = Math.floor(v.elapsed);
  $('elapsed').textContent =
    v.state === 'recording' || seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';

  $('partial').hidden = !v.partial;
  $('partial').textContent = v.partial;
  const result = $('result');
  result.textContent = v.text || 'Nothing yet. Hold the shortcut anywhere and say something.';
  result.classList.toggle('empty', !v.text);
  $<HTMLButtonElement>('copy').disabled = !v.text || !['ready', 'idle'].includes(v.state);
  $('result-meta').textContent = v.timings['stopToReadyMs']
    ? `${(v.timings['stopToReadyMs'] / 1000).toFixed(1)} s`
    : '';
  $('notice').textContent = v.notice;

  $('stat-today').textContent = v.stats.wordsToday.toLocaleString();
  $('stat-words').textContent = v.stats.words.toLocaleString();
  $('stat-wpm').textContent = v.stats.wpm ? String(v.stats.wpm) : '–';
  $('stat-sessions').textContent = v.stats.sessions.toLocaleString();

  // Dictating into the scratch pad: BattyFlow doesn't paste into itself, so insert the result directly.
  if (v.state === 'arming' && document.activeElement === $('scratch')) scratchSession = v.id;
  if (scratchSession && v.id === scratchSession && v.state === 'ready' && v.text && v.delivered === 'kept') {
    const id = scratchSession;
    scratchSession = null;
    const area = $<HTMLTextAreaElement>('scratch');
    const { selectionStart: start, selectionEnd: end } = area;
    safe(async () => {
      const text = await window.batty.insertTest(id);
      const before = area.value.slice(0, start);
      area.setRangeText((before && !/\s$/.test(before) ? ' ' : '') + text, start, end, 'end');
      area.focus();
    });
  }
}

let setupChoice = 'cpu';
function setupPlan(v: View): string[] {
  return setupChoice === 'gpu' ? ['whisper-cuda', 'large-v3-turbo'] : ['whisper-cpu', 'base.en'];
}

function renderSetup(v: View): void {
  const options = $('setup-options');
  const choices = [
    {
      id: 'cpu',
      title: 'Standard',
      body: 'Base English model on the CPU. Quick on any recent laptop, no GPU needed.',
      items: ['whisper-cpu', 'base.en'],
    },
    ...(v.gpu
      ? [
          {
            id: 'gpu',
            title: 'NVIDIA GPU',
            body: `Large v3 Turbo on your ${v.gpu.replace(/^NVIDIA (GeForce )?/, '')}. Best accuracy, 100 languages, about a second per sentence.`,
            items: ['whisper-cuda', 'large-v3-turbo'],
          },
        ]
      : []),
  ];
  const key = JSON.stringify([choices.map(c => c.id), setupChoice]);
  if (options.dataset['key'] !== key) {
    options.dataset['key'] = key;
    options.replaceChildren(
      ...choices.map(choice => {
        const size = choice.items.reduce((sum, id) => sum + (catalog.find(i => i.id === id)?.size ?? 0), 0);
        const radio = h('input', { type: 'radio', name: 'setup', checked: setupChoice === choice.id });
        const label = h(
          'label',
          { className: `option${setupChoice === choice.id ? ' selected' : ''}` },
          radio,
          h(
            'div',
            {},
            h('strong', { textContent: `${choice.title} · ${mb(size)}` }),
            h('span', { textContent: choice.body }),
          ),
        );
        radio.addEventListener('change', () => {
          setupChoice = choice.id;
          renderSetup(v);
        });
        return label;
      }),
    );
  }
  const plan = setupPlan(v);
  const downloading = plan.some(id => v.downloads[id]);
  $<HTMLButtonElement>('setup-start').disabled = downloading;
  $('setup-size').textContent = downloading
    ? ''
    : `${mb(plan.reduce((s, id) => s + (catalog.find(i => i.id === id)?.size ?? 0), 0))} total`;
  const progress = $('setup-progress');
  progress.hidden = !downloading;
  if (downloading)
    progress.replaceChildren(
      ...plan.map(id => {
        const item = catalog.find(i => i.id === id)!;
        const d = v.downloads[id];
        const done = v.installed.includes(id) && !d;
        const pct = d ? Math.floor((d.received / d.total) * 100) : done ? 100 : 0;
        const bar = h(
          'div',
          { className: `bar${d && d.state !== 'downloading' && d.state !== 'error' ? ' indeterminate' : ''}` },
          h('span'),
        );
        (bar.firstChild as HTMLElement).style.width = `${pct}%`;
        const status = d ? downloadLabel(d.state, d.received, d.total, d.error) : done ? 'Done' : 'Waiting';
        return h(
          'div',
          { className: 'progress-row' },
          h('span', { textContent: item.name }),
          bar,
          h('span', { className: 'muted', textContent: status }),
        );
      }),
    );
}

function downloadLabel(state: string, received: number, total: number, error?: string): string {
  if (state === 'error') return describe(error ?? 'DOWNLOAD_FAILED');
  if (state === 'verifying') return 'Checking SHA-256…';
  if (state === 'extracting') return 'Unpacking…';
  if (state === 'queued') return 'Waiting…';
  return `${Math.floor((received / total) * 100)}% of ${mb(total)}`;
}

$('setup-start').addEventListener('click', () => {
  if (!view) return;
  const plan = setupPlan(view);
  safe(async () => {
    // Engine and model download one after the other; each becomes active as soon as it's verified.
    await Promise.all(plan.filter(id => !view!.installed.includes(id)).map(id => window.batty.download(id)));
    for (const id of plan)
      if (view?.settings[catalog.find(i => i.id === id)!.kind]?.catalogId !== id) await window.batty.useAsset(id);
  }, 'All set. Hold the shortcut and talk.');
});

// Keep focus in the scratch pad, so a recording started with the button lands there.
$('record').addEventListener('mousedown', event => event.preventDefault());
$('record').addEventListener('click', () => safe(() => window.batty.toggle(view?.settings.mode ?? 'dictation')));
$('copy').addEventListener('click', () => safe(() => window.batty.copy(view?.id ?? ''), 'Copied.'));

// ------------------------------------------------------------------ sidebar engine status

function renderEngine(v: View): void {
  const engine = $('engine');
  const ready = !!v.settings.whisper && !!v.settings.asrModel;
  engine.className = `engine${ready ? (v.engineReady ? ' ready' : ' warming') : ''}`;
  $('engine-title').textContent = !ready ? 'Not set up' : v.engineReady ? 'Ready' : 'Checking engine…';
  $('engine-detail').textContent = ready
    ? `${v.settings.asrModel!.name} · ${v.settings.gpu && v.settings.whisper!.gpu ? 'NVIDIA GPU' : 'CPU'}`
    : 'Download a model to start';
  $('version').textContent = `Version ${v.version}`;
}

// ------------------------------------------------------------------ history

function loadHistory(): void {
  safe(async () => {
    historyEntries = await window.batty.history();
    renderHistory();
  });
}

function renderHistory(): void {
  const list = $('history-list');
  const query = $<HTMLInputElement>('history-search').value.trim().toLowerCase();
  const entries = historyEntries.filter(entry => !query || entry.text.toLowerCase().includes(query));
  if (!view?.settings.history && !historyEntries.length) {
    list.replaceChildren(h('div', { className: 'empty-state', textContent: 'History is turned off in Settings.' }));
    return;
  }
  if (!entries.length) {
    list.replaceChildren(
      h('div', {
        className: 'empty-state',
        textContent: query ? 'No transcripts match.' : 'Nothing here yet. Your transcripts will show up here.',
      }),
    );
    return;
  }
  const nodes: Node[] = [];
  let lastDay = '';
  let group: HTMLElement | null = null;
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  for (const entry of entries) {
    const date = new Date(entry.at);
    const day = date.toDateString();
    if (day !== lastDay) {
      lastDay = day;
      group = h('div', { className: 'entries' });
      nodes.push(
        h('div', {
          className: 'day',
          textContent:
            day === today
              ? 'Today'
              : day === yesterday
                ? 'Yesterday'
                : date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
        }),
        group,
      );
    }
    const text = h('p', { textContent: entry.text, title: 'Click to expand' });
    text.addEventListener('click', () => text.classList.toggle('open'));
    const copy = h('button', { className: 'icon', title: 'Copy', innerHTML: icon('copy') });
    copy.addEventListener('click', () => safe(() => window.batty.copyText(entry.text), 'Copied.'));
    const remove = h('button', { className: 'icon', title: 'Delete', innerHTML: icon('trash') });
    remove.addEventListener('click', () =>
      safe(async () => {
        await window.batty.deleteHistory(entry.id);
        historyEntries = historyEntries.filter(e => e.id !== entry.id);
        renderHistory();
      }),
    );
    const how = entry.delivered === 'pasted' ? 'Pasted' : entry.delivered === 'copied' ? 'Copied' : 'Kept in BattyFlow';
    group!.append(
      h(
        'div',
        { className: 'entry' },
        h('time', { textContent: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }),
        h(
          'div',
          {},
          text,
          h('div', {
            className: 'meta',
            textContent: `${how} · ${entry.words} words · ${Math.round(entry.seconds)} s${entry.mode !== 'dictation' ? ` · ${entry.mode}` : ''}`,
          }),
        ),
        h('div', { className: 'row-actions' }, copy, remove),
      ),
    );
  }
  list.replaceChildren(...nodes);
}
$('history-search').addEventListener('input', renderHistory);
$('history-clear').addEventListener('click', () =>
  safe(async () => {
    await window.batty.clearHistory();
    historyEntries = [];
    renderHistory();
  }, 'History cleared.'),
);

// ------------------------------------------------------------------ vocabulary

const scopes: [string, string][] = [
  ['any', 'Everywhere'],
  ['code', 'Code'],
  ['terminal', 'Terminal'],
  ['chat', 'Chat'],
  ['email', 'Email'],
];

function loadDictionary(): void {
  safe(async () => {
    dictionary = await window.batty.dictionary();
    renderVocabulary();
  });
}

function vocabRow(entry: Entry): HTMLTableRowElement {
  const canonical = h('input', {
    className: 'canonical',
    value: entry.canonical,
    placeholder: 'getUserById',
    spellcheck: false,
  });
  const aliases = h('input', {
    value: entry.spokenAliases.join(', '),
    placeholder: 'get user by id',
    spellcheck: false,
  });
  const scope = h('select');
  for (const [value, label] of scopes)
    scope.add(new Option(label, value, false, (entry.scope?.profile ?? 'any') === value));
  const remove = h('button', { className: 'icon', title: 'Remove', innerHTML: icon('trash') });
  const row = h('tr', {}, h('td', {}, canonical), h('td', {}, aliases), h('td', {}, scope), h('td', {}, remove));
  remove.addEventListener('click', () => row.remove());
  return row;
}

function renderVocabulary(): void {
  if (!dictionary) return;
  $('vocab-rows').replaceChildren(...dictionary.entries.map(vocabRow));
}

function readVocabulary(): Dictionary {
  const entries: Entry[] = [];
  for (const row of $('vocab-rows').querySelectorAll('tr')) {
    const [canonical, aliases] = [...row.querySelectorAll('input')].map(input => input.value.trim());
    const profile = row.querySelector('select')!.value as Profile | 'any';
    if (!canonical && !aliases) continue;
    const spokenAliases = [
      ...new Set(
        (aliases ?? '')
          .split(',')
          .map(a => a.trim())
          .filter(Boolean),
      ),
    ];
    entries.push({ canonical: canonical ?? '', spokenAliases, ...(profile !== 'any' ? { scope: { profile } } : {}) });
  }
  return { schemaVersion: 1, entries };
}

$('vocab-add').addEventListener('click', () => {
  const row = vocabRow({ canonical: '', spokenAliases: [] });
  $('vocab-rows').append(row);
  row.querySelector('input')!.focus();
});
$('vocab-save').addEventListener('click', () =>
  safe(async () => {
    const next = readVocabulary();
    await window.batty.saveDictionary(next);
    dictionary = next;
  }, 'Vocabulary saved.'),
);
$('vocab-import').addEventListener('click', () =>
  safe(async () => {
    const imported = await window.batty.importDictionary();
    if (!imported) return;
    dictionary = imported;
    renderVocabulary();
    toast('Imported. Review it, then press Save.');
  }),
);
$('vocab-export').addEventListener('click', () => safe(() => window.batty.exportDictionary()));

// ------------------------------------------------------------------ models

function meter(value = 0): string {
  return `<span class="meter">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= value ? 'on' : ''}"></i>`).join('')}</span>`;
}

function modelCard(item: CatalogItem, v: View): HTMLElement {
  const active = v.settings[item.kind]?.catalogId === item.id;
  const installed = v.installed.includes(item.id);
  const download = v.downloads[item.id];
  const card = h('article', { className: `card model${active ? ' active' : ''}` });
  const badges: string[] = [];
  if (active) badges.push('<span class="tag accent">In use</span>');
  else if (item.gpu && v.gpu) badges.push('<span class="tag accent">Matches your GPU</span>');
  else if (item.recommended && !item.gpu) badges.push('<span class="tag">Recommended</span>');
  card.innerHTML = `<div class="model-head"><h3></h3><div>${badges.join(' ')}</div></div><p></p>`;
  card.querySelector('h3')!.textContent = item.name;
  card.querySelector('p')!.textContent =
    item.gpu && !v.gpu ? `${item.blurb} No NVIDIA GPU was detected on this PC.` : item.blurb;
  if (item.speed)
    card.insertAdjacentHTML(
      'beforeend',
      `<div class="meters"><span>Speed${meter(item.speed)}</span><span>Accuracy${meter(item.accuracy)}</span></div>`,
    );
  const languages =
    item.kind === 'asrModel' || item.kind === 'llmModel'
      ? item.languages.length > 1
        ? `${item.languages.length} languages`
        : 'English'
      : item.gpu
        ? 'NVIDIA CUDA'
        : 'Any CPU';
  const foot = h('div', { className: 'model-foot' });
  if (download) {
    const bar = h(
      'div',
      { className: `bar${download.state !== 'downloading' && download.state !== 'error' ? ' indeterminate' : ''}` },
      h('span'),
    );
    (bar.firstChild as HTMLElement).style.width = `${(download.received / download.total) * 100}%`;
    const cancel = h('button', { className: 'ghost', textContent: download.state === 'error' ? 'Dismiss' : 'Cancel' });
    cancel.addEventListener('click', () => safe(() => window.batty.cancelDownload(item.id)));
    foot.append(
      h('span', { textContent: downloadLabel(download.state, download.received, download.total, download.error) }),
      bar,
      cancel,
    );
  } else {
    foot.append(h('span', { textContent: `${mb(item.size)} · ${languages}` }));
    const buttons = h('div', { className: 'actions' });
    if (!installed) {
      const get = h('button', {
        className: item.recommended && !active ? 'primary' : '',
        innerHTML: `${icon('download')}Download`,
      });
      get.addEventListener('click', () => safe(() => window.batty.download(item.id), `${item.name} is ready.`));
      buttons.append(get);
    } else {
      if (!active) {
        const use = h('button', { textContent: 'Use' });
        use.addEventListener('click', () => safe(() => window.batty.useAsset(item.id), `Now using ${item.name}.`));
        buttons.append(use);
      }
      const remove = h('button', { className: 'icon', title: 'Delete from disk', innerHTML: icon('trash') });
      remove.addEventListener('click', () => safe(() => window.batty.removeAsset(item.id), `${item.name} deleted.`));
      buttons.append(remove);
    }
    foot.append(buttons);
  }
  card.append(foot);
  return card;
}

function renderModels(v: View): void {
  const key = JSON.stringify([
    v.installed,
    v.downloads,
    v.gpu,
    ['whisper', 'asrModel', 'llama', 'llmModel'].map(
      k => v.settings[k as AssetKind]?.catalogId ?? v.settings[k as AssetKind]?.sha256,
    ),
  ]);
  if (key === modelsKey) return;
  modelsKey = key;
  document.querySelectorAll<HTMLElement>('.model-grid').forEach(grid => {
    const kind = grid.dataset['kind'] as AssetKind;
    const items = catalog.filter(item => item.kind === kind).map(item => modelCard(item, v));
    // Manually imported assets aren't in the catalog; show them too.
    const custom = v.settings[kind];
    if (custom && !custom.catalogId) {
      const card = h('article', { className: 'card model active' });
      card.innerHTML =
        '<div class="model-head"><h3></h3><span class="tag accent">In use · imported</span></div><p></p>';
      card.querySelector('h3')!.textContent = custom.name;
      card.querySelector('p')!.textContent =
        `${custom.version} · ${custom.license} · SHA-256 ${custom.sha256.slice(0, 12)}…`;
      items.unshift(card);
    }
    grid.replaceChildren(...items);
  });
}

// ------------------------------------------------------------------ settings

type Field = {
  key: keyof Settings;
  label: string;
  hint?: string;
  type: 'switch' | 'select' | 'number' | 'hotkey' | 'text';
  options?: (v: View) => [string, string][];
  min?: number;
  max?: number;
  disabled?: (v: View) => boolean;
  windowsOnly?: boolean;
};

const profiles: [string, string][] = [
  ['neutral', 'Plain'],
  ['code', 'Code'],
  ['terminal', 'Terminal'],
  ['chat', 'Chat'],
  ['email', 'Email'],
];
const groups: { title: string; fields: Field[] }[] = [
  {
    title: 'Recording',
    fields: [
      {
        key: 'pushToTalk',
        label: 'Push-to-talk key',
        hint: 'Hold to record, let go to transcribe. Works in every app.',
        type: 'select',
        windowsOnly: true,
        options: () => [
          ['ctrl-win', 'Ctrl + Win'],
          ['right-ctrl', 'Right Ctrl'],
          ['right-alt', 'Right Alt'],
          ['caps-lock', 'Caps Lock'],
          ['off', 'Off'],
        ],
      },
      {
        key: 'shortcut',
        label: 'Start / stop shortcut',
        hint: 'Press once to start and again to stop, for longer dictation.',
        type: 'hotkey',
      },
      { key: 'microphone', label: 'Microphone', type: 'select', options: () => microphones },
      {
        key: 'language',
        label: 'Language',
        hint: 'English-only models are faster and more accurate for English.',
        type: 'select',
        options: v => {
          const langs = v.settings.asrModel?.languages ?? ['en'];
          if (langs.length < 2) return langs.map(l => [l, languageNames.of(l) ?? l]);
          return [
            ['auto', 'Detect automatically'],
            ...[...langs]
              .map(l => [l, languageNames.of(l) ?? l] as [string, string])
              .sort((a, b) => a[1].localeCompare(b[1])),
          ];
        },
      },
      {
        key: 'silenceStop',
        label: 'Stop after a pause',
        hint: 'Finish automatically after 1.5 seconds of silence (start/stop shortcut).',
        type: 'switch',
      },
      {
        key: 'preview',
        label: 'Live preview',
        hint: 'Show a rough transcript while you speak. Uses extra CPU.',
        type: 'switch',
      },
      { key: 'sounds', label: 'Sounds', hint: 'A soft click when recording starts and stops.', type: 'switch' },
      { key: 'maxSeconds', label: 'Longest recording', hint: 'Seconds, 10 to 300.', type: 'number', min: 10, max: 300 },
    ],
  },
  {
    title: 'Output',
    fields: [
      {
        key: 'delivery',
        label: 'When you stop',
        type: 'select',
        options: v => [
          ...(v.platform === 'win32' ? ([['paste', 'Type it where my cursor is']] as [string, string][]) : []),
          ['copy', 'Copy it to the clipboard'],
          ['none', 'Show it in BattyFlow only'],
        ],
      },
      {
        key: 'restoreClipboard',
        label: 'Restore my clipboard',
        hint: 'Put back whatever you had copied after pasting.',
        type: 'switch',
        windowsOnly: true,
      },
      {
        key: 'trailingSpace',
        label: 'Add a space after each dictation',
        hint: 'So the next sentence doesn’t run into this one.',
        type: 'switch',
      },
      { key: 'removeFillers', label: 'Remove “um” and “uh”', type: 'switch' },
      {
        key: 'autoProfile',
        label: 'Match the app',
        hint: 'Code style in editors, one-line commands in terminals, relaxed punctuation in chat apps.',
        type: 'switch',
      },
      { key: 'profile', label: 'Default style', type: 'select', options: () => profiles },
      {
        key: 'vocabularyPrompt',
        label: 'Steer recognition with my vocabulary',
        hint: 'Helps Whisper spell your terms correctly.',
        type: 'switch',
      },
      {
        key: 'polish',
        label: 'Polish with the local language model',
        hint: 'Tidies grammar and self-corrections. Adds a second or two. Needs the Polish model.',
        type: 'switch',
        disabled: v => !v.settings.llama || !v.settings.llmModel,
      },
    ],
  },
  {
    title: 'Modes',
    fields: [
      {
        key: 'commandShortcut',
        label: 'Command draft',
        hint: 'Turns a spoken request into a clear prompt for a coding agent.',
        type: 'hotkey',
      },
      {
        key: 'editShortcut',
        label: 'Edit selection',
        hint: 'Select text, press this, say what to change.',
        type: 'hotkey',
      },
      { key: 'targetLanguage', label: 'Translate into', hint: 'Language code, like “es”.', type: 'text' },
      {
        key: 'translationPairs',
        label: 'Translation pairs',
        hint: 'Pairs you have checked with your model, like “en:es, en:fr”.',
        type: 'text',
      },
    ],
  },
  {
    title: 'Performance',
    fields: [
      {
        key: 'gpu',
        label: 'Use the GPU',
        hint: 'Needs the NVIDIA engine from the Models page.',
        type: 'switch',
        disabled: v => !v.settings.whisper?.gpu,
      },
      { key: 'threads', label: 'CPU threads', hint: 'More is faster up to about 8.', type: 'number', min: 1, max: 32 },
    ],
  },
  {
    title: 'General',
    fields: [
      {
        key: 'theme',
        label: 'Theme',
        type: 'select',
        options: () => [
          ['dark', 'Dark'],
          ['light', 'Light'],
          ['system', 'Match Windows'],
        ],
      },
      {
        key: 'launchAtLogin',
        label: 'Start with Windows',
        hint: 'Starts in the tray, ready for the shortcut.',
        type: 'switch',
        windowsOnly: true,
      },
      {
        key: 'history',
        label: 'Keep history',
        hint: 'Recent transcripts, stored only on this computer.',
        type: 'switch',
      },
    ],
  },
];

let microphones: [string, string][] = [['', 'System default']];
async function refreshDevices(): Promise<void> {
  try {
    const devices = await window.batty.devices();
    microphones = [['', 'System default'], ...devices.map(d => [d.deviceId, d.label] as [string, string])];
    settingsKey = '';
    if (view) renderSettings(view);
  } catch {}
}

function save(patch: Partial<Settings>): void {
  if (!view) return;
  const next = { ...view.settings, ...patch };
  safe(() => window.batty.save(next));
}

function control(field: Field, v: View): HTMLElement {
  const value = v.settings[field.key];
  const disabled = field.disabled?.(v) ?? false;
  if (field.type === 'switch') {
    const input = h('input', { type: 'checkbox', checked: value === true, disabled });
    input.addEventListener('change', () => save({ [field.key]: input.checked }));
    return h('span', { className: 'switch' }, input, h('span'));
  }
  if (field.type === 'select') {
    const select = h('select', { disabled });
    const options = field.options?.(v) ?? [];
    for (const [optionValue, label] of options) select.add(new Option(label, optionValue));
    if (!options.some(([optionValue]) => optionValue === value))
      select.add(new Option(String(value || 'Unavailable'), String(value)));
    select.value = String(value);
    select.addEventListener('change', () => save({ [field.key]: select.value }));
    return select;
  }
  if (field.type === 'number') {
    const input = h('input', {
      type: 'number',
      value: String(value),
      min: String(field.min),
      max: String(field.max),
      disabled,
    });
    input.addEventListener('change', () => save({ [field.key]: Number(input.value) }));
    return input;
  }
  if (field.type === 'hotkey') return hotkeyInput(field.key, String(value));
  const input = h('input', {
    value: Array.isArray(value) ? value.join(', ') : String(value),
    spellcheck: false,
    disabled,
  });
  input.addEventListener('change', () =>
    save({
      [field.key]:
        field.key === 'translationPairs'
          ? input.value
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
          : input.value.trim(),
    }),
  );
  return input;
}

function hotkeyInput(key: keyof Settings, value: string): HTMLInputElement {
  const input = h('input', {
    className: 'hotkey',
    value: keyLabel(value),
    readOnly: true,
    title: 'Click, then press the new shortcut',
  });
  const reset = () => {
    input.classList.remove('listening');
    input.value = keyLabel(String(view?.settings[key] ?? value));
  };
  input.addEventListener('focus', () => {
    input.classList.add('listening');
    input.value = 'Press keys…';
    safe(() => window.batty.suspendShortcuts(true));
  });
  input.addEventListener('blur', () => {
    reset();
    safe(() => window.batty.suspendShortcuts(false));
  });
  input.addEventListener('keydown', event => {
    event.preventDefault();
    if (event.key === 'Escape') return input.blur();
    const code = event.code;
    const main =
      /^Key([A-Z])$/.exec(code)?.[1] ??
      /^Digit(\d)$/.exec(code)?.[1] ??
      (/^F([1-9]|1\d|2[0-4])$/.test(code) ? code : code === 'Space' ? 'Space' : null);
    const modifiers = [
      event.ctrlKey && 'CommandOrControl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'Super',
    ].filter(Boolean) as string[];
    if (!main) {
      input.value = modifiers.length ? `${keyLabel(modifiers.join('+'))} + …` : 'Press keys…';
      return;
    }
    if (modifiers.length < 2) {
      input.value = 'Use two modifiers, like Ctrl + Alt';
      return;
    }
    const accelerator = [...modifiers, main].join('+');
    input.blur();
    save({ [key]: accelerator });
  });
  return input;
}

function renderSettings(v: View): void {
  const active = document.activeElement;
  if (active && $('settings-form').contains(active)) return; // don't redraw under the user's cursor
  const key = JSON.stringify([v.settings, microphones, v.platform]);
  if (key === settingsKey) return;
  settingsKey = key;
  const form = $('settings-form');
  form.replaceChildren(
    ...groups.map(group =>
      h(
        'section',
        { className: 'group-wrap' },
        h('h2', { className: 'group-title', textContent: group.title }),
        h(
          'div',
          { className: 'group' },
          ...group.fields
            .filter(field => !field.windowsOnly || v.platform === 'win32')
            .map(field => {
              const label = h('label', { textContent: field.label });
              if (field.hint) label.append(h('span', { className: 'hint', textContent: field.hint }));
              return h('div', { className: 'setting' }, label, control(field, v));
            }),
        ),
      ),
    ),
  );
  const dl = $('capabilities');
  dl.replaceChildren(
    ...Object.entries(v.capabilities).flatMap(([k, val]) => [
      h('dt', { textContent: k }),
      h('dd', { textContent: val }),
    ]),
  );
}

// ------------------------------------------------------------------ wiring

let lastSessions = -1;
function update(next: View): void {
  view = next;
  renderEngine(next);
  renderHome(next);
  renderModels(next);
  renderSettings(next);
  if (page === 'history' && next.stats.sessions !== lastSessions) loadHistory();
  lastSessions = next.stats.sessions;
}

hydrateIcons();
window.batty.onView(update);
safe(async () => update(await window.batty.snapshot()));
