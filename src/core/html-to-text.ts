const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  // Same invisible-preheader-padding characters INVISIBLE_CHARS strips, but
  // some senders write them as named entities instead of raw bytes. Without
  // these mapped, decodeEntities falls through to returning the entity text
  // unchanged (there's no "shy"/"zwnj" case to match), so they'd survive as
  // literal "&shy;"/"&zwnj;" garbage instead of becoming strippable.
  shy: "\u00AD",
  zwnj: "\u200C",
  zwj: "\u200D",
  lrm: "\u200E",
  rlm: "\u200F",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// Invisible formatting characters. ESPs commonly pad a hidden preheader
// with hundreds of these to control the inbox preview snippet. They render
// as nothing but count as real characters, so left alone they silently eat
// into the inline-preview length budget.
//
// Written as \u escapes on purpose: as literal characters these are
// invisible in an editor and in code review, and any tool that "cleans up"
// invisible characters would silently gut this class.
//   U+00AD soft hyphen              U+034F combining grapheme joiner
//   U+200B-U+200F zero-width + directional marks
//   U+202A-U+202E bidi embedding/override
//   U+2060 word joiner              U+FEFF zero-width no-break space (BOM)
const INVISIBLE_CHARS = /[\u00AD\u034F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

const BLOCK_CLOSE_TAGS = /<\/(p|div|tr|table|li|h[1-6]|blockquote|section|article|header|footer)>/gi;
const BREAK_TAGS = /<br\s*\/?>/gi;
const ANCHOR_TAG = /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

// Screen-reader-only accessibility text (e.g. Salesforce Marketing Cloud's
// pattern of a hidden <span> with a label like "Experian header logo" next to
// a logo/icon <img>) is visually hidden via CSS, not omitted from the HTML,
// so a naive tag-strip surfaces it as if it were real, visible link text.
//
// display:none / visibility:hidden are ALSO used for entirely unrelated,
// legitimate reasons in email templates: dark-mode overrides, hidden
// preheader tricks, mobile-vs-desktop alternate layouts. Those can
// wrap huge chunks of the real, intended content. Only treat this as a
// throwaway accessibility label when it's short; an actual a11y label is a
// few words, never a full content block.
const HIDDEN_ELEMENT_CANDIDATE =
  /<(span|div|td|p)\b(?=[^>]*\b(?:class\s*=\s*["'][^"']*(?:sr-only|screen-?reader|visually-?hidden|assistive)[^"']*["']|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["']))[^>]*>[\s\S]*?<\/\1>/gi;
const HIDDEN_ELEMENT_MAX_LENGTH = 300;

// Extracted link URLs are held out of the text entirely and spliced back in
// as the very last step, in whatever form the calling adapter wants (Discord
// wraps them in <> to suppress its auto-embed card; Telegram disables link
// previews at the API level instead and just wants a plain URL). Keeping
// them out of the pipeline means the tag-stripping pass can't mistake a
// literal "<url>" for an HTML tag and delete it, and escaping can't corrupt
// the URL itself. Private-use codepoints, so nothing in real mail collides
// with them.
const URL_SLOT_OPEN = "\uE000";
const URL_SLOT_CLOSE = "\uE001";
const URL_SLOT = /\uE000(\d+)\uE001/g;

function replaceLinks(text: string, urls: string[]): string {
  const seenUrls = new Set<string>();

  return text.replace(ANCHOR_TAG, (match, href: string, inner: string) => {
    // Image-only links (logos, social icons, app-store badges, tracking pixels)
    // carry no readable content. Alt text is for accessibility, not a summary,
    // and surfacing it just clutters the message with decorative noise. Only
    // links with real anchor text are kept.
    const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!label) {
      return "";
    }

    // Decoded here rather than by the pipeline's later pass, since the URL
    // leaves the text at this point and never goes through it. Query strings
    // routinely carry &amp; that has to come back as &.
    const url = decodeEntities(href.trim());
    if (!url || url.startsWith("#") || url.toLowerCase().startsWith("javascript:")) {
      return label;
    }

    // Same destination linked more than once (e.g. a logo and a text CTA
    // pointing at the same tracking URL): keep the first occurrence only.
    if (seenUrls.has(url)) {
      return label;
    }
    seenUrls.add(url);

    urls.push(url);
    return `${label} ${URL_SLOT_OPEN}${urls.length - 1}${URL_SLOT_CLOSE}`;
  });
}

export interface HtmlToTextOptions {
  // Applied to the plain-text body after entities/tags/invisible chars are
  // stripped, but before URLs are spliced back in, so it can never mangle a
  // link's own destination. Discord needs this to escape markdown specials
  // (attacker-controlled mail could otherwise render a fake masked link);
  // Telegram sends as plain text with no markup at all, so it's a no-op there.
  escape: (text: string) => string;
  // Renders one extracted link back into the text at its original position.
  formatLink: (url: string) => string;
}

export function htmlToText(html: string, options: HtmlToTextOptions): string {
  const urls: string[] = [];

  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(HIDDEN_ELEMENT_CANDIDATE, (match) => (match.length <= HIDDEN_ELEMENT_MAX_LENGTH ? "" : match));

  text = replaceLinks(text, urls);

  text = text
    .replace(BREAK_TAGS, "\n")
    .replace(BLOCK_CLOSE_TAGS, "\n")
    .replace(/<[^>]+>/g, "");

  // Entity decoding runs before the invisible-char strip, not after: some
  // senders write this padding as named entities (&shy; &zwnj;) rather than
  // raw bytes, and those only become real (strippable) characters once
  // decoded. Stripping first would miss them entirely.
  text = decodeEntities(text);
  text = text.replace(INVISIBLE_CHARS, "");

  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, i, lines) => line.length > 0 || (i > 0 && (lines[i - 1]?.length ?? 0) > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Escaping runs after entity decoding (so &#91; can't smuggle in an
  // unescaped bracket) and before the URLs are spliced back, so the real
  // destinations are never mangled by it.
  text = options.escape(text);

  return text.replace(URL_SLOT, (_match, index: string) => options.formatLink(urls[Number(index)] ?? ""));
}
