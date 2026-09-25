// Real ALBERT tokenizer, ported from the training checkpoint's tokenizer files.
//
// This is NOT a fake: it implements the exact chain recorded in the ALBERT
// tokenizer.json shipped with the checkpoint (`albert-base-v2/tokenizer.json`,
// identical to `ml/training/runs/trigger-classifier/best/tokenizer.json`):
//
//   normalizer:    Replace("``" -> "\"") -> Replace("''" -> "\"") -> NFKD
//                  -> StripAccents -> Lowercase -> Precompiled(charsmap)
//   pre_tokenizer: WhitespaceSplit -> Metaspace("▁", prepend always, split)
//   model:         Unigram (30,000 pieces, scores, unk_id 1) via Viterbi
//   post_process:  TemplateProcessing "[CLS] $A [SEP]"
//
// The Precompiled normalizer is a port of the SentencePiece
// `precompiled_charsmap` binary format (trie blob + normalized string), exactly
// as parsed by google/sentencepiece and the HuggingFace `spm_precompiled` crate
// that `tokenizers` uses for ALBERT. The trie is a Darts double array:
//   file := u32 trie_size | u32 * trie_size | normalized UTF-8 bytes
// (spm_precompiled/src/lib.rs, Apache-2.0, HuggingFace Inc. team.)
//
// Correctness is pinned by fixtures generated from the real checkpoint with the
// real HuggingFace tokenizer (see testAlbertTokenizer.ts) — the tokenizer's
// output for every fixture must equal the reference ids exactly.
//
// Truncation/padding matches training: max_seq_len 64, [CLS]/[SEP] framing,
// right-pad with <pad> (id 0), attention_mask 1 on real tokens and specials.

/** Special token ids — fixed by the ALBERT checkpoint's tokenizer.json. */
export const ALBERT_SPECIAL_IDS = {
  pad: 0,
  unk: 1,
  cls: 2,
  sep: 3,
  mask: 4,
} as const;

/** Unigram Viterbi candidate cap, as in HuggingFace tokenizers (Unigram). */
const MAX_TOKEN_LENGTH = 16;

/** Unigram unknown penalty, as in HuggingFace tokenizers. */
const K_UNK_PENALTY = 10.0;

// ---------------------------------------------------------------------------
// Precompiled charsmap (SentencePiece double-array trie)
// ---------------------------------------------------------------------------

class SpTrie {
  private readonly array: Int32Array;
  private readonly normalizedUtf8: Uint8Array;

  constructor(charsmap: Uint8Array) {
    if (charsmap.length < 4) throw new Error('Precompiled charsmap too short.');
    const trieSize = readU32(charsmap, 0);
    if (trieSize % 4 !== 0) throw new Error('Precompiled charsmap trie size must be a multiple of 4.');
    if (4 + trieSize > charsmap.length) throw new Error('Precompiled charsmap trie exceeds blob length.');
    const unitCount = trieSize / 4;
    this.array = new Int32Array(unitCount);
    for (let i = 0; i < unitCount; i += 1) {
      this.array[i] = readU32(charsmap, 4 + i * 4) | 0;
    }
    this.normalizedUtf8 = charsmap.subarray(4 + trieSize);
  }

  // Darts double-array common-prefix search over UTF-8 bytes. Returns match
  // values ordered shortest-prefix first, exactly as the Rust port does.
  private commonPrefixSearch(key: Uint8Array): number[] {
    const results: number[] = [];
    let nodePos = 0;
    let unit = this.array[nodePos];
    nodePos ^= offsetOf(unit);
    for (let i = 0; i < key.length; i += 1) {
      const c = key[i];
      if (c === 0) break;
      nodePos ^= c;
      if (nodePos < 0 || nodePos >= this.array.length) return results;
      unit = this.array[nodePos];
      if (labelOf(unit) !== c) return results;
      nodePos ^= offsetOf(unit);
      if (nodePos < 0 || nodePos >= this.array.length) return results;
      if (hasLeaf(unit)) {
        results.push(this.array[nodePos]);
      }
    }
    return results;
  }

  // SentencePiece Normalizer::NormalizePrefix equivalent: take the FIRST
  // match value returned by the trie walk (shortest prefix), then decode the
  // replacement string that starts at that index in the normalized blob.
  transform(chunk: string): string | null {
    const results = this.commonPrefixSearch(utf8Encode(chunk));
    if (results.length === 0) return null;
    const start = results[0];
    if (start < 0 || start >= this.normalizedUtf8.length) return null;
    let end = start;
    while (end < this.normalizedUtf8.length && this.normalizedUtf8[end] !== 0) end += 1;
    return utf8Decode(this.normalizedUtf8.subarray(start, end));
  }

  // spm_precompiled::Precompiled::normalize_string, including its intentional
  // quirk: chunks shorter than 6 bytes (single graphemes in practice) are
  // looked up as a whole first, before per-character fallback.
  normalizeString(original: string): string {
    let out = '';
    for (const grapheme of graphemeChunks(original)) {
      if (utf8Length(grapheme) < 6) {
        const norm = this.transform(grapheme);
        if (norm !== null) {
          out += norm;
          continue;
        }
      }
      for (const ch of grapheme) {
        const norm = this.transform(ch);
        out += norm !== null ? norm : ch;
      }
    }
    return out;
  }
}

function readU32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function hasLeaf(unit: number): boolean {
  return ((unit >>> 8) & 1) === 1;
}

function valueOf(unit: number): number {
  return unit & ((1 << 31) - 1);
}

function labelOf(unit: number): number {
  return unit & ((1 << 31) | 0xff);
}

function offsetOf(unit: number): number {
  return (unit >>> 10) << (((unit & (1 << 9)) >> 6) as 0 | 1);
}

// ---------------------------------------------------------------------------
// UTF-8 helpers (no TextEncoder dependency: must run in plain Node and RN)
// ---------------------------------------------------------------------------

function utf8Length(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        i += 1;
        continue;
      }
    }
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}

function utf8Encode(text: string): Uint8Array {
  const bytes = new Uint8Array(utf8Length(text));
  let at = 0;
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code <= 0x7f) {
      bytes[at] = code;
      at += 1;
    } else if (code <= 0x7ff) {
      bytes[at] = 0xc0 | (code >> 6);
      bytes[at + 1] = 0x80 | (code & 0x3f);
      at += 2;
    } else if (code <= 0xffff) {
      bytes[at] = 0xe0 | (code >> 12);
      bytes[at + 1] = 0x80 | ((code >> 6) & 0x3f);
      bytes[at + 2] = 0x80 | (code & 0x3f);
      at += 3;
    } else {
      bytes[at] = 0xf0 | (code >> 18);
      bytes[at + 1] = 0x80 | ((code >> 12) & 0x3f);
      bytes[at + 2] = 0x80 | ((code >> 6) & 0x3f);
      bytes[at + 3] = 0x80 | (code & 0x3f);
      at += 4;
    }
  }
  return bytes;
}

function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 < 0xf0) {
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      const code = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const adjusted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
      i += 4;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lightweight grapheme chunking (only used for the <6-byte whole-chunk lookup
// shortcut of the precompiled normalizer; extended clusters beyond these rules
// fall back to per-character lookups, which is the algorithm's own fallback).
// ---------------------------------------------------------------------------

function isCombiningMark(code: number): boolean {
  // Combining Diacritical Marks + extended blocks that matter for the
  // SentencePiece charsmap rewrites (devanagari, arabic, hangul jamo, etc.).
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x0483 && code <= 0x0489) ||
    (code >= 0x0591 && code <= 0x05bd) ||
    (code >= 0x0610 && code <= 0x061a) ||
    (code >= 0x064b && code <= 0x065f) ||
    (code >= 0x0900 && code <= 0x0903) ||
    (code >= 0x093a && code <= 0x094f) ||
    (code >= 0x0951 && code <= 0x0957) ||
    (code >= 0x0e31 && code <= 0x0e3a) ||
    (code >= 0x0e47 && code <= 0x0e4e) ||
    (code >= 0x200c && code <= 0x200d) ||
    code === 0x3099 ||
    code === 0x309a ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

function isRegionalIndicator(code: number): boolean {
  return code >= 0x1f1e6 && code <= 0x1f1ff;
}

function* graphemeChunks(text: string): Generator<string> {
  let i = 0;
  while (i < text.length) {
    const start = i;
    let code = text.codePointAt(i) as number;
    i += code > 0xffff ? 2 : 1;
    if (isRegionalIndicator(code)) {
      // Regional indicators pair up (flags).
      const next = i < text.length ? text.codePointAt(i) : undefined;
      if (next !== undefined && isRegionalIndicator(next)) i += 2;
    } else {
      while (i < text.length) {
        const next = text.codePointAt(i) as number;
        if (isCombiningMark(next) || next === 0x200d) {
          i += next > 0xffff ? 2 : 1;
          // After a ZWJ, include the joined character as well.
          if (next === 0x200d && i < text.length) {
            const joined = text.codePointAt(i) as number;
            i += joined > 0xffff ? 2 : 1;
          }
        } else {
          break;
        }
      }
    }
    yield text.slice(start, i);
  }
}

// ---------------------------------------------------------------------------
// Normalizer chain (exact order of the checkpoint's tokenizer.json)
// ---------------------------------------------------------------------------

const STRIP_ACCENTS_RANGE = /[\u0300-\u036f]/g;

function normalizeText(charsmap: SpTrie, text: string): string {
  // (replaceAll is intentionally avoided: the Node test suite targets es2019.)
  let out = text.replace(/``/g, '"').replace(/''/g, '"');
  out = out.normalize('NFKD');
  // StripAccents: NFKD composes accents as combining marks; remove them.
  out = out.replace(STRIP_ACCENTS_RANGE, '');
  out = out.toLowerCase();
  out = charsmap.normalizeString(out);
  return out;
}

// ---------------------------------------------------------------------------
// Pre-tokenizer: WhitespaceSplit -> Metaspace("▁", prepend always, split)
// ---------------------------------------------------------------------------

const METASPACE = '▁';

function pretokenize(text: string): string[] {
  const chunks = text.split(/\s+/);
  const out: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    // Metaspace: prepend ▁ (scheme "always" applies to every whitespace-split
    // sequence), replace remaining spaces with ▁, then split on ▁ keeping the
    // marker attached to what follows.
    let piece = METASPACE + chunk.replace(/ /g, METASPACE);
    for (const segment of piece.split(METASPACE)) {
      if (segment.length > 0) out.push(METASPACE + segment);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Unigram model (Viterbi over the 30,000-piece vocabulary)
// ---------------------------------------------------------------------------

export interface AlbertTokenizerOptions {
  /** Vocab entries as [piece, score] in id order (from tokenizer.json). */
  readonly vocab: readonly (readonly [string, number])[];
  /** Base64 `precompiled_charsmap` from the tokenizer.json normalizer. */
  readonly precompiledCharsmap: string;
  /** Known special-token strings that must never be normalized away. */
  readonly addedTokens?: readonly string[];
}

export class AlbertTokenizer {
  readonly maxLength: number;
  private readonly vocabIndex: Map<string, { readonly id: number; readonly score: number }>;
  private readonly minScore: number;
  private readonly unkScore: number;
  private readonly trie: SpTrie;
  private readonly addedTokens: ReadonlySet<string>;

  constructor(options: AlbertTokenizerOptions, maxLength: number) {
    this.maxLength = maxLength;
    this.vocabIndex = new Map();
    let minScore = Number.POSITIVE_INFINITY;
    options.vocab.forEach(([piece, score], id) => {
      this.vocabIndex.set(piece, { id, score });
      if (score < minScore) minScore = score;
    });
    this.minScore = minScore;
    this.unkScore = minScore - K_UNK_PENALTY;
    this.trie = new SpTrie(decodeBase64(options.precompiledCharsmap));
    this.addedTokens = new Set(options.addedTokens ?? []);
  }

  /** Raw Unigram Viterbi segmentation of one piece of text (no specials). */
  private encodeUnigram(text: string): number[] {
    const chars = Array.from(text);
    const n = chars.length;
    if (n === 0) return [];

    // best[i] = best total score for the first i chars; back[i] = segment start.
    const best = new Float64Array(n + 1).fill(Number.NEGATIVE_INFINITY);
    const back = new Int32Array(n + 1).fill(-1);
    const idAt = new Int32Array(n + 1).fill(ALBERT_SPECIAL_IDS.unk);
    best[0] = 0;

    for (let i = 0; i < n; i += 1) {
      if (best[i] === Number.NEGATIVE_INFINITY) continue;
      const maxLen = Math.min(MAX_TOKEN_LENGTH, n - i);
      for (let len = 1; len <= maxLen; len += 1) {
        const target = i + len;
        const piece = chars.slice(i, target).join('');
        const entry = this.vocabIndex.get(piece);
        let score: number;
        let id: number;
        if (entry === undefined) {
          if (len !== 1) continue;
          score = this.unkScore;
          id = ALBERT_SPECIAL_IDS.unk;
        } else {
          score = entry.score;
          id = entry.id;
        }
        const candidate = best[i] + score;
        if (candidate > best[target]) {
          best[target] = candidate;
          back[target] = i;
          idAt[target] = id;
        }
      }
    }

    // Backtrack.
    const ids: number[] = [];
    let at = n;
    while (at > 0) {
      const start = back[at];
      if (start < 0) return []; // unreachable position; defensive
      ids.push(idAt[at]);
      at = start;
    }
    ids.reverse();
    // fuse_unk (SentencePiece/HF default): consecutive unknown tokens are
    // fused into a single unk, e.g. an unsegmentable word becomes one unk
    // instead of one unk per character.
    const fused: number[] = [];
    for (const id of ids) {
      if (id === ALBERT_SPECIAL_IDS.unk && fused[fused.length - 1] === ALBERT_SPECIAL_IDS.unk) continue;
      fused.push(id);
    }
    return fused;
  }

  /**
   * Full tokenization of user text: normalize -> pre-tokenize -> Unigram ->
   * [CLS]/[SEP] framing -> truncate/pad to `maxLength`. Matches the checkpoint
   * tokenizer with truncation=True, max_length=64, padding='max_length'.
   */
  encode(text: string): { readonly inputIds: readonly number[]; readonly attentionMask: readonly number[] } {
    const normalized = normalizeText(this.trie, text);
    const pieces = pretokenize(normalized);

    // Unigram model + fuse_unk, per pre-tokenized piece.
    const ids: number[] = [];
    for (const piece of pieces) {
      if (this.addedTokens.has(piece)) continue; // never re-emit specials
    for (const id of this.encodeUnigram(piece)) ids.push(id);
    }

    // Truncation applies to the CONTENT before specials are added (HF tokenizers:
    // truncate the model output to num_special_tokens_to_add fewer than
    // max_length, THEN the TemplateProcessor appends [CLS]/[SEP]). This keeps
    // [SEP] present even for very long inputs.
    const contentBudget = this.maxLength - 2; // [CLS] + [SEP]
    const truncated = ids.slice(0, contentBudget);

    // TemplateProcessing "[CLS] $A [SEP]".
    const withSpecials = [ALBERT_SPECIAL_IDS.cls, ...truncated, ALBERT_SPECIAL_IDS.sep];
    const inputIds = [...withSpecials];
    const attentionMask = withSpecials.map(() => 1);
    while (inputIds.length < this.maxLength) {
      inputIds.push(ALBERT_SPECIAL_IDS.pad);
      attentionMask.push(0);
    }
    return { inputIds, attentionMask };
  }
}

// ---------------------------------------------------------------------------
// Base64 (small, dependency-free; the charsmap is ~237 KB)
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) lookup[BASE64_ALPHABET.charCodeAt(i)] = i;
  return lookup;
})();

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
  const length = clean.length;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < length; i += 1) {
    const digit = BASE64_LOOKUP[clean.charCodeAt(i)];
    if (digit < 0) throw new Error('Invalid base64 character in precompiled charsmap.');
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      // Drop the consumed bits so the buffer can never overflow 32 bits.
      buffer &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// Asset loading
// ---------------------------------------------------------------------------

export interface AlbertTokenizerAssets {
  /** Parsed tokenizer.json `model.vocab` ([[piece, score], ...]). */
  readonly vocab: readonly (readonly [string, number])[];
  /** tokenizer.json normalizer Precompiled `precompiled_charsmap` (base64). */
  readonly precompiledCharsmap: string;
}

/**
 * Builds the tokenizer from already-loaded JSON content. Callers load the
 * tokenizer.json asset (via expo-asset + fetch) and pass the parsed values;
 * loading failures are therefore the caller's to handle, keeping this module
 * pure and testable.
 */
export function createAlbertTokenizer(assets: AlbertTokenizerAssets, maxLength: number): AlbertTokenizer {
  return new AlbertTokenizer(
    {
      vocab: assets.vocab,
      precompiledCharsmap: assets.precompiledCharsmap,
      addedTokens: ['<pad>', '<unk>', '[CLS]', '[SEP]', '[MASK]'],
    },
    maxLength,
  );
}
