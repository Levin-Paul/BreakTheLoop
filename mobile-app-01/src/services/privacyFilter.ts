// Privacy filter for locally permitted device signals.
//
// This module is the gate every raw signal must pass before it can reach any
// local model or storage. It is deliberately pure (no React, no React Native, no
// database), so its behavior is identical wherever it runs and can be tested in
// Node.
//
// What it does:
//   - rejects obvious secrets (passwords, OTPs, auth tokens, card numbers,
//     government IDs, API keys, private keys) instead of passing them along,
//   - redacts those same patterns from text that is otherwise allowed,
//   - never touches images: a visual signal may only be a coarse text label,
//     never raw pixels or base64 image data.
//
// What it does NOT do (and must never do):
//   - read private messages in the background,
//   - capture or store screenshots,
//   - upload anything anywhere.
//
// Monitoring is opt-in, visible, locally processed, and disableable. Callers
// pass `enabled: false` to the pipeline when the user has switched monitoring off.

/** Kinds of obviously sensitive content the filter recognizes. */
export type SensitiveKind =
  | 'password'
  | 'otp'
  | 'auth_token'
  | 'payment_card'
  | 'government_id'
  | 'api_key'
  | 'secret';

/** Longest text signal accepted after trimming. Longer text is truncated first. */
export const MAX_SIGNAL_TEXT_LENGTH = 280;

/** Placeholder inserted where sensitive content was removed. */
export function redactionPlaceholder(kind: SensitiveKind): string {
  return `[redacted:${kind}]`;
}

interface SensitiveRule {
  kind: SensitiveKind;
  pattern: RegExp;
}

/**
 * Ordered rules. Each pattern is intentionally narrow: it is better to let an
 * ambiguous string through than to flag ordinary text as sensitive. Labels are
 * only matched when attached to an explicit key (e.g. "password:", "api_key=").
 */
const RULES: readonly SensitiveRule[] = [
  // JWT-shaped strings and bearer headers.
  { kind: 'auth_token', pattern: /\bearer\s+[A-Za-z0-9\-._~+/]{10,}=*/gi },
  {
    kind: 'auth_token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  },
  {
    kind: 'auth_token',
    pattern:
      /\b(?:access|refresh|auth|session|id|csrf|x-api)[-_ ]?token\b\s*[:=]\s*\S+/gi,
  },
  // Passwords.
  {
    kind: 'password',
    pattern: /\b(?:password|passwd|pwd|passphrase|passcode)\b\s*[:=]\s*\S+/gi,
  },
  // One-time codes only when labeled, so ordinary 4-digit numbers are not flagged.
  {
    kind: 'otp',
    pattern:
      /\b(?:otp|one[-\s]?time\s?(?:code|password)|verification\s?code|2fa\s?code|security\s?code)\b\s*(?:is|:|=)?\s*\d{4,8}/gi,
  },
  // API keys and client secrets, both labeled key/value and common prefixes.
  {
    kind: 'api_key',
    pattern:
      /\b(?:api[_-]?key|apikey|client[_-]?secret|secret[_-]?key|private[_-]?key|access[_-]?key)\b\s*[:=]\s*['"]?\S+/gi,
  },
  { kind: 'api_key', pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/g },
  { kind: 'api_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  // Seeds / recovery phrases / explicit secrets.
  {
    kind: 'secret',
    pattern:
      /\b(?:seed\s?phrase|mnemonic|recovery\s?phrase|private\s?key)\b\s*[:=]\s*\S+/gi,
  },
  // Government IDs: US SSN shape only (no bare digit runs, to avoid false hits).
  { kind: 'government_id', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
];

/** 13-19 digit candidate, allowing spaces or dashes as separators. */
const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;

/** Luhn checksum, used to keep the card rule from flagging arbitrary digits. */
function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/[ -]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (value < 0 || value > 9) return false;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Returns the kinds of sensitive content found in `text`, deduplicated and in
 * rule order. An empty array means nothing obvious was detected.
 */
export function detectSensitive(text: string): SensitiveKind[] {
  const kinds = new Set<SensitiveKind>();
  if (!text) return [];

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      kinds.add(rule.kind);
    }
  }

  CARD_CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CARD_CANDIDATE.exec(text)) !== null) {
    if (passesLuhn(match[0])) {
      kinds.add('payment_card');
    }
  }

  return [...kinds];
}

/** Outcome of redacting sensitive content from a string. */
export interface RedactionResult {
  text: string;
  redactions: SensitiveKind[];
}

/**
 * Replaces every detected sensitive span with `[redacted:kind]`. Always
 * succeeds: use this when the surrounding text is still useful, and prefer
 * `screenText` when the whole signal should be rejected instead.
 */
export function redactSensitive(text: string, maxLength = MAX_SIGNAL_TEXT_LENGTH): RedactionResult {
  let output = text;
  const redactions = new Set<SensitiveKind>();

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    output = output.replace(rule.pattern, () => {
      redactions.add(rule.kind);
      return redactionPlaceholder(rule.kind);
    });
  }

  // Card numbers need the checksum, so they are handled span-by-span.
  CARD_CANDIDATE.lastIndex = 0;
  output = output.replace(CARD_CANDIDATE, (candidate) => {
    if (!passesLuhn(candidate)) return candidate;
    redactions.add('payment_card');
    return redactionPlaceholder('payment_card');
  });

  return { text: output.slice(0, maxLength), redactions: [...redactions] };
}

/** Outcome of screening a text signal for sensitivity. */
export interface TextFilterResult {
  allowed: boolean;
  /** Present only when `allowed`. */
  text: string;
  redactions: SensitiveKind[];
  /** Present only when `!allowed`, explaining why the signal was rejected. */
  reason?: string;
}

/**
 * Screens a text signal. Sensitive content causes the *whole* signal to be
 * rejected rather than quietly emitted, because a partially redacted fragment
 * can still leak context. Call `redactSensitive` first if the caller genuinely
 * wants the non-sensitive remainder.
 */
export function screenText(text: string, maxLength = MAX_SIGNAL_TEXT_LENGTH): TextFilterResult {
  const trimmed = text.trim().slice(0, maxLength);
  if (trimmed.length === 0) {
    return { allowed: false, text: '', redactions: [], reason: 'Empty text signal.' };
  }
  const redactions = detectSensitive(trimmed);
  if (redactions.length > 0) {
    return {
      allowed: false,
      text: '',
      redactions,
      reason: `Sensitive content detected (${redactions.join(', ')}); signal rejected.`,
    };
  }
  return { allowed: true, text: trimmed, redactions: [] };
}

/** Coarse visual labels a visual signal is allowed to carry. No images, ever. */
export const ALLOWED_VISUAL_LABELS = [
  'none',
  'text',
  'image',
  'video',
  'social_feed',
  'unknown',
] as const;

export type VisualLabel = (typeof ALLOWED_VISUAL_LABELS)[number];

/**
 * Screens a visual signal. Only a coarse label from `ALLOWED_VISUAL_LABELS` is
 * accepted; anything that looks like raw image data (base64, data URIs, long
 * opaque strings) is rejected outright.
 */
export function screenVisual(value: string): { allowed: boolean; label?: VisualLabel; reason?: string } {
  const candidate = value.trim().toLowerCase();
  if (candidate.length === 0) return { allowed: false, reason: 'Empty visual signal.' };
  if (!(ALLOWED_VISUAL_LABELS as readonly string[]).includes(candidate)) {
    return {
      allowed: false,
      reason: 'Visual signals may only carry a coarse label; raw image data is never accepted.',
    };
  }
  return { allowed: true, label: candidate as VisualLabel };
}
