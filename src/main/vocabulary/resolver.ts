import { randomBytes } from 'node:crypto';
import type { Dictionary, Profile } from '../../shared/types';
export const starter: Dictionary = { schemaVersion: 1, entries: [
  { canonical: 'OAuth', spokenAliases: ['oh auth'] },
  { canonical: 'GraphQL', spokenAliases: ['graph q l', 'graph cue ell'] },
  { canonical: 'useEffect', spokenAliases: ['use effect'], scope: { profile: 'code' } },
  { canonical: 'Kubernetes', spokenAliases: ['kubernetes'] },
  { canonical: 'git checkout', spokenAliases: ['git check out'], scope: { profile: 'code' } },
  { canonical: 'getUserById', spokenAliases: ['get user by id', 'get user by eye dee'], scope: { profile: 'code' } },
] };
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (x: string | undefined) => x !== undefined && /[\p{L}\p{N}_]/u.test(x);
export function validateDictionary(value: unknown): Dictionary {
  if (!value || typeof value !== 'object') throw new Error('INVALID_DICTIONARY');
  const d = value as Dictionary;
  if (d.schemaVersion !== 1 || !Array.isArray(d.entries) || d.entries.length > 2000) throw new Error('INVALID_DICTIONARY');
  const seen = new Set<string>();
  for (const e of d.entries) {
    if (!e || typeof e.canonical !== 'string' || !e.canonical.trim() || e.canonical.length > 200 || /[\x00-\x1f]/.test(e.canonical) || !Array.isArray(e.spokenAliases) || e.spokenAliases.length > 30) throw new Error('INVALID_ENTRY');
    if (e.scope && (typeof e.scope !== 'object' || (e.scope.profile && !['any','neutral','chat','email','code','terminal'].includes(e.scope.profile)) || (e.scope.app !== undefined && typeof e.scope.app !== 'string') || (e.scope.project !== undefined && typeof e.scope.project !== 'string'))) throw new Error('INVALID_SCOPE');
    for (const a of e.spokenAliases) {
      if (typeof a !== 'string' || !a.trim() || a.length > 200 || /[\x00-\x1f]/.test(a)) throw new Error('INVALID_ALIAS');
      const key = JSON.stringify([e.canonical, a.toLocaleLowerCase(), e.scope ?? {}]);
      if (seen.has(key)) throw new Error('DUPLICATE_ALIAS'); seen.add(key);
    }
  }
  return d;
}
export interface Span { start: number; end: number; original: string; canonical: string }
export function literalIdentifiers(text: string): string[] {
  // Protect spellings actually present in ASR; never infer spellings from spoken words.
  return [...text.matchAll(/\b(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\b/g)].map(m => m[0]);
}
export function resolve(text: string, dictionary: Dictionary, profile: Profile): { text: string; spans: Span[]; ambiguities: string[] } {
  const candidates: (Span & { exact: boolean; priority: number })[] = [];
  for (const e of dictionary.entries) {
    if (e.scope?.app || e.scope?.project || (e.scope?.profile && e.scope.profile !== 'any' && e.scope.profile !== profile)) continue;
    for (const [phrase, exact] of [[e.canonical, true], ...e.spokenAliases.map(a => [a, false])] as [string, boolean][]) {
      for (const match of text.matchAll(new RegExp(escape(phrase), exact ? 'gu' : 'giu'))) {
        const start = match.index; const end = start + match[0].length;
        if (word(text[start - 1]) || word(text[end])) continue;
        candidates.push({ start, end, original: match[0], canonical: e.canonical, exact, priority: e.scope?.profile && e.scope.profile !== 'any' ? 1 : 0 });
      }
    }
  }
  candidates.sort((a,b) => Number(b.exact) - Number(a.exact) || (b.end-b.start) - (a.end-a.start) || b.priority-a.priority || a.start-b.start);
  const chosen: Span[] = []; const occupied: Span[] = []; const ambiguities: string[] = [];
  for (const candidate of candidates) {
    if (occupied.some(x => x.start < candidate.end && x.end > candidate.start)) continue;
    const alternatives = candidates.filter(x => x.start === candidate.start && x.end === candidate.end && x.exact === candidate.exact && x.priority === candidate.priority);
    occupied.push(candidate);
    if (new Set(alternatives.map(x => x.canonical)).size > 1) { ambiguities.push(candidate.original); continue; }
    chosen.push(candidate);
  }
  chosen.sort((a,b) => a.start-b.start);
  let result = ''; let offset = 0;
  for (const s of chosen) { result += text.slice(offset, s.start) + s.canonical; offset = s.end; }
  result += text.slice(offset);
  return { text: result, spans: chosen, ambiguities };
}
export function protect(text: string, canonical: string[]): { text: string; tokens: Map<string, string> } {
  let nonce: string;
  do { nonce = randomBytes(12).toString('hex'); } while (text.includes(nonce));
  const tokens = new Map<string, string>();
  const terms = [...new Set(canonical)].sort((a,b) => b.length-a.length);
  if (!terms.length) return { text, tokens };
  const pattern = new RegExp(terms.map(escape).join('|'), 'gu');
  const replaced = text.replace(pattern, (match: string, at: number) => {
    if (word(text[at-1]) || word(text[at+match.length])) return match;
    const token = `BF_${nonce}_${tokens.size}_END`; tokens.set(token, match); return token;
  });
  return { text: replaced, tokens };
}
export function restore(text: string, tokens: Map<string,string>, allowRemoval = false): string {
  let result = text;
  for (const [token, original] of tokens) {
    const count = result.split(token).length - 1;
    if (count > 1 || (!allowRemoval && count !== 1)) throw new Error('PROTECTED_SPAN_MISMATCH');
    result = result.split(token).join(original);
  }
  if (/BF_[a-f0-9]{24}_\d+_END/.test(result)) throw new Error('UNKNOWN_PROTECTED_SPAN');
  return result;
}
