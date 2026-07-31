/**
 * Shared Sanitizer Module
 *
 * Single canonical XSS sanitization implementation consumed by both
 * `backend/` and `api/`.  Provides context-specific encoding for the
 * four output contexts present in SwiftRemit:
 *
 *   • JSON responses  — strip all HTML; entity-encode residual angle brackets
 *   • HTML email      — strip dangerous tags/attrs; allow safe formatting tags
 *   • PDF text        — strip ALL markup; plain text only (PDFKit renders raw
 *                       strings so any surviving tag becomes visible noise)
 *   • On-chain memo   — plain text, max 28 bytes (Stellar text memo limit),
 *                       no HTML, no control characters
 *
 * Usage in Zod schemas:
 *   memo: z.string().max(28).transform(sanitizeOnChainMemo)
 *
 * Usage in Joi schemas (via .custom()):
 *   Joi.string().custom((v) => sanitizeForJson(v))
 *
 * Call-site sanitization is intentionally preserved in existing routes for
 * defence-in-depth; the schema layer is the primary enforcement point.
 */

import xss, { IWhiteList } from 'xss';

// ── Context: JSON / REST responses ───────────────────────────────────────────

/**
 * Strip all HTML and encode residual `<` / `>` characters.
 * Safe for embedding in JSON string values and plain log output.
 */
export function sanitizeForJson(input: unknown): string {
  if (!input || typeof input !== 'string') return '';
  // xss() with an empty whitelist strips every tag.
  return xss(input.trim(), { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script', 'style'] });
}

// Alias used throughout both services as the default sanitizer.
export const sanitizeInput = sanitizeForJson;

/**
 * Check whether the xss library would modify the string.
 * Returns true when suspicious / malicious content is detected.
 */
export function containsXss(input: string): boolean {
  if (!input) return false;
  return xss(input, { whiteList: {}, stripIgnoreTag: true }) !== input;
}

// ── Context: HTML email ───────────────────────────────────────────────────────

/**
 * Allowlist of tags and attributes that are safe inside HTML email bodies.
 * Restricts to formatting-only elements; no interactive or media tags.
 */
const EMAIL_WHITELIST: IWhiteList = {
  a: ['href', 'title'],      // href is sanitized by xss (no javascript:)
  b: [],
  strong: [],
  i: [],
  em: [],
  u: [],
  p: [],
  br: [],
  span: ['style'],           // inline colour/font — xss strips dangerous CSS
  ul: [],
  ol: [],
  li: [],
  h1: [],
  h2: [],
  h3: [],
  table: ['width', 'cellpadding', 'cellspacing', 'border'],
  thead: [],
  tbody: [],
  tr: [],
  td: ['width', 'align', 'valign', 'colspan', 'rowspan'],
  th: ['width', 'align', 'valign', 'colspan', 'rowspan'],
  hr: [],
};

/**
 * Sanitize a value for embedding in an HTML email.
 * Preserves safe formatting tags while stripping scripts, iframes,
 * event handlers, and javascript: URLs.
 */
export function sanitizeForHtmlEmail(input: unknown): string {
  if (!input || typeof input !== 'string') return '';
  return xss(input.trim(), {
    whiteList: EMAIL_WHITELIST,
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    onTagAttr(_tag, _name, value) {
      // Block any attribute value that begins with a javascript: URL scheme
      // even after case-folding and whitespace insertion tricks.
      const normalised = value.replace(/[\s\0]/g, '').toLowerCase();
      if (/^javascript:/i.test(normalised) || /^vbscript:/i.test(normalised)) {
        return ''; // drop the attribute
      }
      return undefined; // let xss apply its own rules
    },
  });
}

// ── Context: PDF text ─────────────────────────────────────────────────────────

/**
 * Sanitize a value for rendering as plain text inside a PDFKit document.
 * PDFKit does not parse HTML — any surviving tag would appear literally in
 * the output and confuse readers.  Strip everything to plain text.
 */
export function sanitizeForPdf(input: unknown): string {
  if (!input || typeof input !== 'string') return '';
  // First pass: xss strips dangerous content
  const stripped = xss(input.trim(), {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style'],
  });
  // Second pass: remove any residual HTML entities and angle brackets so
  // PDFKit output is genuinely clean plain text.
  return stripped
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#[xX]?[0-9a-fA-F]+;/g, '') // remove any numeric HTML entities
    .replace(/[<>]/g, '')                   // strip any surviving angle brackets
    .trim();
}

// ── Context: Stellar on-chain memo ────────────────────────────────────────────

/** Stellar text memo max byte length per the protocol spec. */
const STELLAR_MEMO_MAX_BYTES = 28;

/**
 * Sanitize a memo field for writing on-chain via the Stellar network.
 *
 * Rules:
 *   1. Strip all HTML markup and entities (no XSS in explorer UIs).
 *   2. Remove ASCII control characters (NUL, BEL, etc.) — these corrupt
 *      TOML / SEP-24 parsers that read the memo back.
 *   3. Truncate to 28 bytes (Stellar text memo limit) using UTF-8 byte
 *      counting so multi-byte characters aren't split mid-sequence.
 */
export function sanitizeOnChainMemo(input: unknown): string {
  if (!input || typeof input !== 'string') return '';

  const stripped = xss(input.trim(), {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style'],
  });

  // Remove control characters (U+0000–U+001F, U+007F)
  // eslint-disable-next-line no-control-regex
  const clean = stripped.replace(/[\u0000-\u001F\u007F]/g, '');

  // Truncate to STELLAR_MEMO_MAX_BYTES bytes without splitting multi-byte chars
  const encoder = new TextEncoder();
  const bytes = encoder.encode(clean);
  if (bytes.length <= STELLAR_MEMO_MAX_BYTES) return clean;

  // Walk back from the byte limit until we land on a valid UTF-8 boundary
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(bytes.slice(0, STELLAR_MEMO_MAX_BYTES)).replace(/\uFFFD/g, '');
}

// ── Object-level helpers ─────────────────────────────────────────────────────

/**
 * Sanitize all top-level string values in a plain object for JSON output.
 * Non-string values are left unchanged.  Returns a new object.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') {
      (result as Record<string, unknown>)[key] = sanitizeForJson(result[key] as string);
    }
  }
  return result;
}
