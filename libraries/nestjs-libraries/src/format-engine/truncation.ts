// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/format-engine/truncation.ts
// NetAmplify — shared truncation strategy used by all formatters.
//
// Per docs/02-SRS.md FR-011:
//   "Deterministic; truncation strategy = trim description, then summary,
//   never title; ellipsis marker before link."

/**
 * The truncation strategy:
 *   1. Trim description first (it's the longest field)
 *   2. If still over limit, trim summary
 *   3. NEVER trim title (per FR-011)
 *   4. Insert ellipsis before any URL/link
 *
 * The ellipsis marker `…` is inserted before the link so the user knows
 * content was cut. The link itself is never truncated (URLs must be valid).
 */

const ELLIPSIS = '…';

/**
 * Truncate a string to `maxChars` grapheme count, inserting ellipsis.
 * Pure function — no Date.now/random.
 */
export function truncateWithEllipsis(
  text: string,
  maxChars: number,
  ellipsis: string = ELLIPSIS
): string {
  if (maxChars <= 0) return '';
  // Count graphemes (Unicode-aware)
  const graphemes = Array.from(text);
  if (graphemes.length <= maxChars) return text;
  // Reserve room for ellipsis
  if (maxChars <= ellipsis.length) return ellipsis.slice(0, maxChars);
  return graphemes.slice(0, maxChars - ellipsis.length).join('') + ellipsis;
}

/**
 * Truncate a string preserving a URL at the end. The URL is never cut;
 * the body before it is shortened to fit. If the URL itself is longer
 * than maxChars, the URL is preserved verbatim and the body is empty.
 *
 * Per FR-011: "ellipsis marker before link."
 */
export function truncatePreservingUrl(
  body: string,
  url: string | undefined,
  maxChars: number
): { body: string; truncated: boolean } {
  if (!url) {
    const truncated = truncateWithEllipsis(body, maxChars);
    return { body: truncated, truncated: truncated !== body };
  }
  // Reserve space for url + ellipsis + newline
  const urlLine = `\n${url}`;
  const reserved = urlLine.length;
  if (maxChars <= reserved) {
    // URL is too long for the limit — return URL only
    return { body: '', truncated: true };
  }
  const bodyMax = maxChars - reserved;
  const truncatedBody = truncateWithEllipsis(body, bodyMax);
  return {
    body: truncatedBody + urlLine,
    truncated: truncatedBody !== body,
  };
}

/**
 * Strip markdown from a string. Used for LinkedIn (plain text) and
 * Telegram (HTML, no markdown).
 *
 * Conservative: removes # headers, * emphasis, [link](url) → "link (url)",
 * `code` → "code". Doesn't try to handle every markdown spec edge case.
 */
export function stripMarkdown(s: string): string {
  return s
    // Headers: "## Title" → "Title"
    .replace(/^#{1,6}\s+/gm, '')
    // Bold + italic: **x** / *x* / __x__ → x
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Inline code: `x` → x
    .replace(/`([^`]+)`/g, '$1')
    // Code blocks: ```...``` → first line only
    .replace(/```[\s\S]*?```/g, (m) => m.split('\n').slice(1, -1).join('\n').trim())
    // Links: [text](url) → "text (url)"
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    // Images: ![alt](url) → "alt (url)"
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    // Blockquotes: > x → x
    .replace(/^>\s+/gm, '')
    // List markers: - x / * x / 1. x → x
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Horizontal rules: --- → (empty)
    .replace(/^---+\s*$/gm, '')
    .trim();
}

/**
 * Convert hashtags to "x" → "#x" (lowercase, alphanumeric only).
 * Per FR-011: tags from techStack → hashtags appended if room.
 */
export function toHashtags(techStack: string[]): string[] {
  return techStack
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 0);
}
