/**
 * Email HTML rendered back inside the application.
 *
 * On the tested surface because the author of this markup is not always the
 * reader of it: a ticket body is written by a stranger and displayed inside an
 * agent's session. The guard this replaces removed `<script>` and nothing else,
 * so every case below used to pass straight through.
 */
import { describe, expect, it } from "vitest";

import { isSafeCss, sanitizeEmailHtml } from "./sanitize-email-html";

/** Anything that would run, in whatever spelling. */
const EXECUTES = [
  "<script>alert(1)</script>",
  "<SCRIPT >alert(1)</SCRIPT>",
  "<img src=x onerror=alert(1)>",
  '<img src="x" onerror="alert(1)">',
  // A space inside the value, with the payload after it. The rule for unquoted
  // attributes stops at the first space, so only the quoted rule removes the
  // whole thing — without it, `alert(2)` is left sitting in the markup.
  '<img src="x" onerror="a = 1; alert(2)">',
  "<img src='x' onerror='a = 1; alert(2)'>",
  "<img src='x' ONERROR='alert(1)'>",
  '<div onmouseover="steal()">hover</div>',
  '<a href="javascript:alert(1)">click</a>',
  '<a href="JaVaScRiPt:alert(1)">click</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD4=">click</a>',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="x"></object>',
  '<div style="width:expression(alert(1))">x</div>',
  '<svg><style>@import "https://evil.example"</style></svg>',
  '<form action="https://evil.example"><input name="p"></form>',
];

describe("sanitizeEmailHtml", () => {
  it.each(EXECUTES)("removes what would run: %s", (input) => {
    const out = sanitizeEmailHtml(input).toLowerCase();
    // The payload itself, not merely the attribute name: a rule that strips
    // `onerror="alert(` and leaves `1 )">` behind has removed the word and none
    // of the danger.
    expect(out).not.toContain("alert");
    expect(out).not.toContain("steal");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("onmouseover");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<object");
    expect(out).not.toContain("expression(");
    expect(out).not.toContain("@import");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<input");
  });

  it("keeps what an email is made of", () => {
    const html =
      '<table width="600"><tr><td style="padding:12px;color:#333">' +
      '<h1>Hello</h1><p>Read our <a href="https://example.com/news">news</a>.</p>' +
      '<img src="https://cdn.example.com/logo.png" alt="Logo" width="120"></td></tr></table>';
    const out = sanitizeEmailHtml(html);
    expect(out).toContain("https://example.com/news");
    expect(out).toContain("https://cdn.example.com/logo.png");
    expect(out).toContain("padding:12px");
    expect(out).toContain("<h1>Hello</h1>");
  });

  it("keeps the schemes an email legitimately uses", () => {
    for (const href of ["https://a.example", "http://a.example", "mailto:a@example.com", "tel:+390212345", "#top"]) {
      expect(sanitizeEmailHtml(`<a href="${href}">x</a>`), href).toContain(href);
    }
  });

  it("keeps an inline image but not an inline document", () => {
    const image = '<img src="data:image/png;base64,iVBORw0KGgo=">';
    expect(sanitizeEmailHtml(image)).toContain("data:image/png");
    expect(sanitizeEmailHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">')).not.toContain("data:text/html");
  });

  it("is not fooled by whitespace inside the scheme", () => {
    // A tab or newline inside "javascript:" is the oldest trick there is.
    const out = sanitizeEmailHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("script:");
  });

  it("strips a mail that would cover the application's own screen", () => {
    expect(sanitizeEmailHtml('<div style="position:fixed;top:0;left:0">x</div>')).not.toContain("position:fixed");
  });

  it("returns an empty string for nothing", () => {
    expect(sanitizeEmailHtml("")).toBe("");
  });
});

describe("isSafeCss", () => {
  it("passes ordinary email styling", () => {
    expect(isSafeCss("color:#333;padding:12px;font-family:Arial")).toBe(true);
  });

  it("rejects what can fetch, run, or escape its box", () => {
    for (const css of [
      "width:expression(alert(1))",
      "background:url(javascript:alert(1))",
      "behavior:url(#default#time2)",
      "-moz-binding:url(https://evil.example)",
      "@import url(https://evil.example)",
      "position:fixed;top:0",
      "POSITION : FIXED",
    ]) {
      expect(isSafeCss(css), css).toBe(false);
    }
  });
});
