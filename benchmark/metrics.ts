export function words(text: string): string[] { return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu,' ').trim().split(/\s+/).filter(Boolean); }
export interface WordScore { substitutions: number; deletions: number; insertions: number; referenceWords: number; wer: number | null; hallucinatedWords: number }
export function wer(reference: string, hypothesis: string): WordScore {
  const a = words(reference), b = words(hypothesis);
  type Cell = { cost: number; s: number; d: number; i: number };
  let row: Cell[] = Array.from({ length: b.length+1 }, (_,i) => ({ cost:i, s:0, d:0, i }));
  for (let x = 1; x <= a.length; x++) {
    const next: Cell[] = [{ cost:x,s:0,d:x,i:0 }];
    for (let y = 1; y <= b.length; y++) {
      const diagonal = row[y-1]!; const top = row[y]!; const left = next[y-1]!;
      const difference = Number(a[x-1] !== b[y-1]);
      next.push([{ ...diagonal, cost:diagonal.cost+difference, s:diagonal.s+difference }, { ...top,cost:top.cost+1,d:top.d+1 }, { ...left,cost:left.cost+1,i:left.i+1 }].sort((m,n) => m.cost-n.cost)[0]!);
    }
    row = next;
  }
  const result = row[b.length]!;
  return { substitutions:result.s, deletions:result.d, insertions:result.i, referenceWords:a.length, wer:a.length ? result.cost/a.length : null, hallucinatedWords:a.length ? 0 : b.length };
}
export function exactOccurrences(text: string, term: string): number {
  let count = 0; let pos = 0;
  while ((pos = text.indexOf(term,pos)) >= 0) {
    const before = text[pos-1], after = text[pos+term.length];
    if ((!before || !/[\p{L}\p{N}_]/u.test(before)) && (!after || !/[\p{L}\p{N}_]/u.test(after))) count++;
    pos += Math.max(1,term.length);
  }
  return count;
}
export function identifiers(text: string, expected: {text: string;count: number}[], vocabulary: string[]): { correct: number; total: number; preservation: number | null; spurious: number } {
  let correct = 0, total = 0, spurious = 0;
  for (const term of new Set([...vocabulary,...expected.map(x=>x.text)])) {
    const required = expected.filter(x=>x.text===term).reduce((n,x)=>n+x.count,0); const actual = exactOccurrences(text,term);
    correct += Math.min(actual,required); total += required; spurious += Math.max(0,actual-required);
  }
  return { correct,total,preservation:total ? correct/total:null,spurious };
}
export function percentile(values: number[], p: number): number | null { if (!values.length) return null; const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]!; }
