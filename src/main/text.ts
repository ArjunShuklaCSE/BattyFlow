import type { Profile, Settings, Target } from '../shared/types';

// Hesitation sounds only. Words like "like", "so" and "you know" often carry meaning and are kept.
const fillers = /(^|[\s,.;:!?])(?:u+m+|u+h+|e+r+m+|h+m+|m+h*m+)(?=$|[\s,.;:!?])[,.]?/gi;

export function removeFillers(text: string): string {
  let result = text;
  // Run twice so "um, uh, we" loses both sounds.
  for (let i = 0; i < 2; i++) result = result.replace(fillers, '$1');
  result = result
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // "um, we should" -> "we should" -> "We should" when the filler started a sentence.
  return text.trim() && /^[A-Z]/.test(text.trim()) ? result.charAt(0).toUpperCase() + result.slice(1) : result;
}

const apps: Record<string, Profile> = {
  code: 'code',
  'code - insiders': 'code',
  cursor: 'code',
  windsurf: 'code',
  zed: 'code',
  devenv: 'code',
  idea64: 'code',
  pycharm64: 'code',
  webstorm64: 'code',
  rider64: 'code',
  clion64: 'code',
  goland64: 'code',
  phpstorm64: 'code',
  rustrover64: 'code',
  datagrip64: 'code',
  studio64: 'code',
  sublime_text: 'code',
  'notepad++': 'code',
  antigravity: 'code',
  slack: 'chat',
  discord: 'chat',
  teams: 'chat',
  'ms-teams': 'chat',
  telegram: 'chat',
  whatsapp: 'chat',
  signal: 'chat',
  element: 'chat',
  outlook: 'email',
  olk: 'email',
  thunderbird: 'email',
  mailspring: 'email',
};

/** The writing profile for the app being dictated into; the configured profile everywhere else. */
export function profileFor(target: Target, settings: Pick<Settings, 'profile' | 'autoProfile'>): Profile {
  if (!settings.autoProfile) return settings.profile;
  if (target.terminal) return 'terminal';
  return (target.app && apps[target.app]) || settings.profile;
}

export function formatForProfile(text: string, profile: Profile): string {
  if (profile === 'terminal') {
    // Shell input: one line, no sentence punctuation, no capitalised command name.
    const line = text
      .replace(/\s*[\r\n]+\s*/g, ' ')
      .replace(/[.。]+$/, '')
      .trim();
    return /^[A-Z][a-z]/.test(line) ? line.charAt(0).toLowerCase() + line.slice(1) : line;
  }
  if (profile === 'chat' && !/[.!?].+[.!?]$/.test(text.trim())) {
    // A single chat sentence reads better without the full stop.
    return text.trim().replace(/(?<![.])\.$/, '');
  }
  return text;
}

/** Final shaping for the field the text is pasted into. */
export function forTarget(text: string, target: Target, settings: Pick<Settings, 'trailingSpace'>): string {
  if (target.terminal) return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  // So the next dictation (or typing) doesn't run into this one.
  return settings.trailingSpace && !/\s$/.test(text) ? `${text} ` : text;
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}
