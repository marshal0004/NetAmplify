// apps/frontend/src/lib/markdown-converter.test.ts
// Vitest unit tests for the bidirectional markdown ↔ HTML converter.
//
// These tests verify the conversion both ways (MD→HTML for loading into
// Tiptap, HTML→MD for saving from Tiptap) covers: paragraphs, headings,
// bold, italic, links, bullet lists, ordered lists, blockquotes, code blocks,
// inline code, horizontal rules, and edge cases (empty input, plain text,
// nested formatting).

import { describe, it, expect } from 'vitest';
import { markdownToHtml, htmlToMarkdown } from './markdown-converter';

describe('markdownToHtml', () => {
  it('converts plain text to a <p> tag', () => {
    const html = markdownToHtml('Hello world');
    expect(html).toContain('<p>');
    expect(html).toContain('Hello world');
  });

  it('converts headings', () => {
    expect(markdownToHtml('# Title')).toContain('<h1>Title</h1>');
    expect(markdownToHtml('## Subtitle')).toContain('<h2>Subtitle</h2>');
    expect(markdownToHtml('### Section')).toContain('<h3>Section</h3>');
  });

  it('converts bold and italic', () => {
    const html = markdownToHtml('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('converts links', () => {
    const html = markdownToHtml('[Click here](https://example.com)');
    expect(html).toContain('<a href="https://example.com">Click here</a>');
  });

  it('converts bullet lists', () => {
    const html = markdownToHtml('- Item 1\n- Item 2\n- Item 3');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Item 1</li>');
    expect(html).toContain('<li>Item 2</li>');
    expect(html).toContain('<li>Item 3</li>');
  });

  it('converts ordered lists', () => {
    const html = markdownToHtml('1. First\n2. Second');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>First</li>');
    expect(html).toContain('<li>Second</li>');
  });

  it('converts blockquotes', () => {
    const html = markdownToHtml('> This is a quote');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a quote');
  });

  it('converts inline code', () => {
    const html = markdownToHtml('Use `npm install` to install');
    expect(html).toContain('<code>npm install</code>');
  });

  it('converts code blocks', () => {
    const html = markdownToHtml('```\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('const x = 1');
  });

  it('converts horizontal rules', () => {
    const html = markdownToHtml('---');
    expect(html).toContain('<hr');
  });

  it('handles empty input', () => {
    expect(markdownToHtml('')).toBe('<p></p>');
    expect(markdownToHtml('   ')).toBe('<p></p>');
  });

  it('escapes HTML entities in input', () => {
    const html = markdownToHtml('Use <div> and & symbols');
    expect(html).toContain('&lt;div&gt;');
    expect(html).toContain('&amp;');
  });
});

describe('htmlToMarkdown', () => {
  it('converts <p> to plain text with paragraph spacing', () => {
    const md = htmlToMarkdown('<p>Hello world</p>');
    expect(md.trim()).toBe('Hello world');
  });

  it('converts headings', () => {
    expect(htmlToMarkdown('<h1>Title</h1>').trim()).toBe('# Title');
    expect(htmlToMarkdown('<h2>Subtitle</h2>').trim()).toBe('## Subtitle');
    expect(htmlToMarkdown('<h3>Section</h3>').trim()).toBe('### Section');
  });

  it('converts bold and italic', () => {
    const md = htmlToMarkdown('<p><strong>bold</strong> and <em>italic</em></p>');
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
  });

  it('converts links', () => {
    const md = htmlToMarkdown('<p><a href="https://example.com">Click here</a></p>');
    expect(md).toContain('[Click here](https://example.com)');
  });

  it('converts bullet lists', () => {
    const md = htmlToMarkdown('<ul><li>Item 1</li><li>Item 2</li></ul>');
    expect(md).toContain('- Item 1');
    expect(md).toContain('- Item 2');
  });

  it('converts ordered lists', () => {
    const md = htmlToMarkdown('<ol><li>First</li><li>Second</li></ol>');
    expect(md).toContain('1. First');
    expect(md).toContain('2. Second');
  });

  it('converts blockquotes', () => {
    const md = htmlToMarkdown('<blockquote>This is a quote</blockquote>');
    expect(md).toContain('> This is a quote');
  });

  it('converts inline code', () => {
    const md = htmlToMarkdown('<p>Use <code>npm install</code></p>');
    expect(md).toContain('`npm install`');
  });

  it('converts code blocks', () => {
    const md = htmlToMarkdown('<pre><code>const x = 1;</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });

  it('converts horizontal rules', () => {
    expect(htmlToMarkdown('<hr>').trim()).toBe('---');
  });

  it('handles empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('<p></p>')).toBe('');
  });

  it('handles multiple paragraphs', () => {
    const md = htmlToMarkdown('<p>First paragraph</p><p>Second paragraph</p>');
    expect(md).toContain('First paragraph');
    expect(md).toContain('Second paragraph');
    // Paragraphs are separated by double newline
    expect(md).toMatch(/First paragraph\n\nSecond paragraph/);
  });
});

describe('round-trip conversion (MD → HTML → MD)', () => {
  it('preserves bold formatting through round-trip', () => {
    const original = 'This is **bold** text';
    const html = markdownToHtml(original);
    const back = htmlToMarkdown(html);
    expect(back).toContain('**bold**');
  });

  it('preserves italic formatting through round-trip', () => {
    const original = 'This is *italic* text';
    const html = markdownToHtml(original);
    const back = htmlToMarkdown(html);
    expect(back).toContain('*italic*');
  });

  it('preserves links through round-trip', () => {
    const original = 'Check [this link](https://example.com)';
    const html = markdownToHtml(original);
    const back = htmlToMarkdown(html);
    expect(back).toContain('[this link](https://example.com)');
  });

  it('preserves headings through round-trip', () => {
    const original = '# Heading';
    const html = markdownToHtml(original);
    const back = htmlToMarkdown(html);
    expect(back.trim()).toBe('# Heading');
  });

  it('preserves bullet lists through round-trip', () => {
    const original = '- Item 1\n- Item 2';
    const html = markdownToHtml(original);
    const back = htmlToMarkdown(html);
    expect(back).toContain('- Item 1');
    expect(back).toContain('- Item 2');
  });
});
