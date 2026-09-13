export function validateCleanup(source: string, output: string): void {
  const tokens = (s:string) => s.toLowerCase().match(/[\p{L}\p{N}_']+/gu) ?? [];
  const original = tokens(source), result = tokens(output);
  if (!result.length || result.length > original.length * 1.8 + 8 || (original.length >= 8 && result.length < original.length * .5)) throw new Error('CLEANUP_LENGTH_DIVERGENCE');
  const negative = (s:string) => /\b(?:not|no|never|without|cannot)\b|n['’]t\b/i.test(s);
  if (negative(source) && !negative(output)) throw new Error('CLEANUP_NEGATION_CHANGED');
  if (/\b(?:I|we|you|they) like\b/i.test(source) && !/\blike\b/i.test(output)) throw new Error('CLEANUP_MEANINGFUL_LIKE_CHANGED');
  if (!/\b(?:actually|sorry|correction|I mean|make that)\b/i.test(source)) {
    const outputNumbers: string[] = output.match(/\b\d+(?:[.,]\d+)*\b/g) ?? [];
    for (const number of source.match(/\b\d+(?:[.,]\d+)*\b/g) ?? []) if (!outputNumbers.includes(number)) throw new Error('CLEANUP_NUMBER_CHANGED');
  }
}
export function validateDraft(source: string, output: string): void {
  if (/```/.test(output) && !/\b(?:shell|bash|powershell|command line)\b/i.test(source)) throw new Error('COMMAND_DRAFT_UNREQUESTED_CODE');
  if (/\b(?:I have|I've|I successfully) (?:fixed|completed|run|executed|created|added)\b/i.test(output)) throw new Error('COMMAND_DRAFT_CLAIMS_EXECUTION');
}
