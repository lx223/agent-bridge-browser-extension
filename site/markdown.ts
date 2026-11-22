import { Marked, type Token, type Tokens } from 'marked';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim();
}

export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export interface RenderedMarkdown {
  title: string;
  description: string;
  html: string;
}

const SHORT_DESCRIPTION = 80;

export interface LinkParts {
  href: string;
  text: string;
}

export function renderMarkdown(markdown: string, rewriteLink: (link: LinkParts) => LinkParts): RenderedMarkdown {
  const usedIds = new Map<string, number>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const base = githubSlug(htmlToText(inner));
        const seen = usedIds.get(base) ?? 0;
        usedIds.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
    },
  });

  const tokens = marked.lexer(markdown);
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'image') {
      const image = token as Tokens.Image;
      image.href = rewriteLink({ href: image.href, text: image.text }).href;
    }
    if (token.type === 'link') {
      const link = token as Tokens.Link;
      const rewritten = rewriteLink({ href: link.href, text: link.text });
      link.href = rewritten.href;
      if (rewritten.text !== link.text) {
        link.text = rewritten.text;
        link.tokens = [{ type: 'text', raw: rewritten.text, text: rewritten.text, escaped: false }];
      }
    }
  });

  const titleIndex = tokens.findIndex((token) => token.type === 'heading' && (token as Tokens.Heading).depth === 1);
  if (titleIndex === -1) throw new Error('Markdown page has no level 1 heading');
  const [titleToken] = tokens.splice(titleIndex, 1) as Tokens.Heading[];
  const title = htmlToText(marked.parser([paragraphOf(titleToken)]));

  const paragraphs = tokens.filter((token): token is Tokens.Paragraph => token.type === 'paragraph');
  let description = paragraphs.length > 0 ? htmlToText(marked.parser([paragraphs[0]])) : title;
  if (description.length < SHORT_DESCRIPTION && paragraphs.length > 1) {
    description = `${description} ${htmlToText(marked.parser([paragraphs[1]]))}`;
  }

  return { title, description, html: marked.parser(tokens) };
}

function paragraphOf(heading: Tokens.Heading): Token {
  return { type: 'paragraph', raw: heading.raw, text: heading.text, tokens: heading.tokens };
}

export function rewriteMarkdownLinks(markdown: string, rewriteHref: (href: string) => string): string {
  return markdown
    .split(/(```[\s\S]*?```)/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/\]\(([^)\s]+)/g, (_match, href: string) => `](${rewriteHref(href)}`),
    )
    .join('');
}
