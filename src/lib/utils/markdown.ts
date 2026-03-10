import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

const marked = new Marked({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(content: string): string {
  const rawHtml = marked.parse(content) as string;
  return DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['span'],
    ADD_ATTR: ['class', 'data-highlighted'],
  });
}

export function highlightCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll('pre code').forEach((block) => {
    if (block instanceof HTMLElement && !block.dataset.highlighted) {
      try {
        hljs.highlightElement(block);
      } catch {
        /* ignore highlight errors */
      }
      block.dataset.highlighted = 'true';
    }
  });
}

export function addCopyButtons(container: HTMLElement): void {
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copy-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent ?? '' : pre.textContent ?? '';
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = 'Copy';
        }, 1500);
      });
    });

    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}
