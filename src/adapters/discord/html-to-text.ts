import { htmlToText as coreHtmlToText } from "../../core/html-to-text.ts";

// Discord renders markdown in bot messages, and every part of an email is
// attacker-controlled: anyone who learns an address can send to it. Without
// this, a body (or an anchor's own label) containing
// `[www.yourbank.com](https://evil.example)` arrives as a clickable link
// whose visible text lies about its destination.
//
// Escaping [ and ] alone is what defeats that, since a masked link needs
// both. The formatting characters are escaped too so a sender can't mangle
// the message's presentation. Deliberately left alone: parentheses, hyphens,
// # and >, which are common in ordinary prose and at worst cosmetic here.
// Backslash goes first so it can't be used to undo the rest.
const MARKDOWN_SPECIALS = /([\\`*_~|[\]])/g;

export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIALS, "\\$1");
}

export function htmlToText(html: string): string {
  return coreHtmlToText(html, {
    escape: escapeMarkdown,
    // Wrapped in <> to suppress Discord's auto-embed preview card.
    formatLink: (url) => `(<${url}>)`,
  });
}
