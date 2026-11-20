// apps/frontend/src/lib/markdown-converter.ts
// NetAmplify — bidirectional markdown ↔ HTML converter for the Tiptap editor.
//
// The PostCard stores `description` as MARKDOWN (the Format Engine + all
// platform adapters expect markdown). Tiptap outputs HTML. These converters
// bridge the gap: markdown → HTML when loading content into the editor,
// HTML → markdown when saving.
//
// No external dependencies — uses the browser's DOMParser (available in all
// modern browsers + jsdom for tests). Handles the subset of formatting the
// PostCard composer supports: paragraphs, headings (h1-h3), bold, italic,
// links, bullet lists, ordered lists, blockquotes, inline code, code blocks,
// horizontal rules, line breaks.

/**
 * Convert HTML (from Tiptap's editor.getHTML()) to markdown.
 *
 * Uses DOMParser to parse the HTML into a DOM tree, then recursively
 * traverses it producing markdown. Handles the tags Tiptap's StarterKit
 * generates: p, h1-h3, strong/b, em/i, u, a, ul, ol, li, blockquote,
 * pre/code, code, hr, br.
 *
 * Unknown tags are passed through (their children are converted).
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === '') return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const result = convertNode(doc.body);
  // Collapse 3+ newlines into 2 (paragraph spacing) + trim
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Recursively convert a DOM node to markdown.
 */
function convertNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent || '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map(convertNode).join('');

  switch (tag) {
    case 'p':
      return children.trim() + '\n\n';
    case 'h1':
      return `# ${children.trim()}\n\n`;
    case 'h2':
      return `## ${children.trim()}\n\n`;
    case 'h3':
      return `### ${children.trim()}\n\n`;
    case 'h4':
      return `#### ${children.trim()}\n\n`;
    case 'h5':
      return `##### ${children.trim()}\n\n`;
    case 'h6':
      return `###### ${children.trim()}\n\n`;
    case 'strong':
    case 'b':
      return `**${children}**`;
    case 'em':
    case 'i':
      return `*${children}*`;
    case 'u':
      // Markdown has no native underline — just pass the text through.
      return children;
    case 's':
    case 'del':
    case 'strike':
      return `~~${children}~~`;
    case 'a': {
      const href = el.getAttribute('href') || '';
      const text = children.trim();
      if (!href) return text;
      return `[${text}](${href})`;
    }
    case 'ul': {
      const items = Array.from(el.children)
        .filter((li) => li.tagName.toLowerCase() === 'li')
        .map((li) => `- ${convertNode(li).trim()}`)
        .join('\n');
      return items + '\n\n';
    }
    case 'ol': {
      const items = Array.from(el.children)
        .filter((li) => li.tagName.toLowerCase() === 'li')
        .map((li, i) => `${i + 1}. ${convertNode(li).trim()}`)
        .join('\n');
      return items + '\n\n';
    }
    case 'li':
      // Handled by parent ul/ol which adds the bullet/number prefix.
      // Return just the children text (trimmed) so the parent can format it.
      return children.trim();
    case 'blockquote': {
      const inner = children.trim().replace(/\n/g, '\n> ');
      return `> ${inner}\n\n`;
    }
    case 'pre': {
      const code = el.textContent || '';
      return `\`\`\`\n${code}\n\`\`\`\n\n`;
    }
    case 'code':
      return `\`${children}\``;
    case 'hr':
      return '---\n\n';
    case 'br':
      return '\n';
    case 'div':
      return children + '\n';
    case 'span':
      return children;
    default:
      return children;
  }
}

/**
 * Convert markdown to HTML (for loading into Tiptap's `content` prop).
 *
 * Handles the same subset as htmlToMarkdown. Uses regex-based conversion —
 * not a full markdown parser, but sufficient for PostCard descriptions
 * (which are user-authored and use basic formatting).
 *
 * Unknown markdown constructs are passed through as plain text.
 */
export function markdownToHtml(md: string): string {
  if (!md || md.trim() === '') return '<p></p>';

  let html = md;

  // Escape HTML entities so user-typed < > & don't break the DOM parser.
  html = html.replace(/&/g, '&amp;');
  html = html.replace(/</g, '&lt;');
  html = html.replace(/>/g, '&gt;');

  // Fenced code blocks (```lang\n...```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Headings (process h3 before h2 before h1 to avoid partial matches)
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Blockquote (lines starting with >)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Bold (**text** or __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic (*text* or _text_) — avoid matching ** (bold) by checking no
  // adjacent asterisk.
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

  // Strikethrough (~~text~~)
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Inline code (`text`) — process after code blocks to avoid clobbering.
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // Bullet list items (lines starting with - or *) — collect consecutive
  // bullet lines into a <ul>
  html = html.replace(
    /(?:^[-*] .+\n?)+/gm,
    (match) => {
      const items = match
        .trim()
        .split('\n')
        .map((line) => line.replace(/^[-*] /, ''))
        .map((item) => `<li>${item}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    },
  );

  // Ordered list items (lines starting with 1. 2. etc.)
  html = html.replace(
    /(?:^\d+\. .+\n?)+/gm,
    (match) => {
      const items = match
        .trim()
        .split('\n')
        .map((line) => line.replace(/^\d+\. /, ''))
        .map((item) => `<li>${item}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    },
  );

  // Split into blocks by double-newline, wrap non-tagged blocks in <p>.
  const blocks = html.split(/\n\n+/);
  html = blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      // Already a block-level tag — don't wrap in <p>.
      if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|div)/i.test(trimmed)) {
        return trimmed;
      }
      // Single newlines within a paragraph → <br>
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  // Collapse adjacent blockquote lines into one blockquote.
  html = html.replace(/(<blockquote>.+?<\/blockquote>\s*)+/g, (match) => {
    const inner = match
      .replace(/<\/?blockquote>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `<blockquote>${inner}</blockquote>`;
  });

  return html || '<p></p>';
}
