/**
 * Shared escaping for HTML email output.
 *
 * Every dynamic value that lands in an HTML email (text nodes, attributes,
 * link targets) must pass through one of these helpers. Plain-text bodies do
 * not use them: they stay raw so they remain readable.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Escape a value for use in HTML text or a quoted attribute. */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Return the URL trimmed when it is an absolute http, https or mailto URL
 * without whitespace or control characters. Anything else (javascript:, data:,
 * relative paths, malformed input) returns null.
 */
export function safeUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || /[\u0000- \u007F]/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  return ALLOWED_URL_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
}

/**
 * Value for an `href="..."` attribute. Unsafe URLs become "#" so a link never
 * carries an active script or data payload.
 */
export function hrefAttr(value: string | null | undefined): string {
  return escapeHtml(safeUrl(value) ?? "#");
}
