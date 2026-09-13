// Expected content hashes from the publishers' Hugging Face LFS tree APIs,
// verified 2026-09-14. This catalog is never fetched by the running app.
export const trustedModels: Record<string, { sha256: string; size: number; languages: readonly string[] }> = {
  'ggml-tiny.en.bin': { sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f', size: 77704715, languages: ['en'] },
  'qwen2.5-0.5b-instruct-q4_k_m.gguf': { sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db', size: 491400032, languages: ['en'] },
};
