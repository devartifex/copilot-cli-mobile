import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hljs from 'highlight.js/lib/core';
import { addCopyButtons, highlightCodeBlocks, renderMarkdown } from './markdown';

function renderIntoContainer(markdown: string): HTMLDivElement {
	const container = document.createElement('div');
	container.innerHTML = renderMarkdown(markdown);
	return container;
}

describe('renderMarkdown', () => {
	it('renders headings, emphasis, links, and paragraphs', () => {
		const html = renderMarkdown('# Title\n\n**bold** *italic* [Docs](https://example.com)');

		expect(html).toContain('<h1>Title</h1>');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
		expect(html).toContain('<a href="https://example.com">Docs</a>');
	});

	it('renders unordered lists', () => {
		const html = renderMarkdown('- first\n- second\n- third');

		expect(html).toContain('<ul>');
		expect(html).toContain('<li>first</li>');
		expect(html).toContain('<li>second</li>');
		expect(html).toContain('<li>third</li>');
	});

	it('converts single line breaks into br tags', () => {
		const html = renderMarkdown('line one\nline two');

		expect(html).toContain('<p>line one<br>line two</p>');
	});

	it('removes script tags from rendered HTML', () => {
		const html = renderMarkdown('<script>alert("xss")</script>safe');

		expect(html).not.toContain('<script');
		expect(html).toBe('safe');
	});

	it('removes dangerous event handler attributes', () => {
		const html = renderMarkdown('<img src="x" onerror="alert(1)">');

		expect(html).toContain('<img src="x">');
		expect(html).not.toContain('onerror');
	});

	it('strips javascript URLs from links while preserving text', () => {
		const container = renderIntoContainer('[click me](javascript:alert(1))');
		const link = container.querySelector('a');

		expect(link).not.toBeNull();
		expect(link).not.toHaveAttribute('href');
		expect(link).toHaveTextContent('click me');
	});

	it('preserves highlight span tags and attributes allowed by the sanitizer', () => {
		const html = renderMarkdown('<span class="hljs-keyword" data-highlighted="true">const</span>');

		expect(html).toContain('<span class="hljs-keyword" data-highlighted="true">const</span>');
	});

	it('returns an empty string for empty input', () => {
		expect(renderMarkdown('')).toBe('');
	});

	it('throws for null input', () => {
		expect(() => renderMarkdown(null as unknown as string)).toThrow(/input parameter is undefined or null/i);
	});

	it('throws for undefined input', () => {
		expect(() => renderMarkdown(undefined as unknown as string)).toThrow(/input parameter is undefined or null/i);
	});

	it('renders very long strings without truncating content', () => {
		const input = 'hello '.repeat(4000).trim();
		const html = renderMarkdown(input);

		expect(html.startsWith('<p>hello hello')).toBe(true);
		expect(html).toContain('hello hello hello');
		expect(html.length).toBeGreaterThan(input.length);
	});

	it('escapes special HTML characters in markdown text', () => {
		const html = renderMarkdown('& < >');

		expect(html).toContain('&amp; &lt; &gt;');
	});
});

describe('highlightCodeBlocks', () => {
	it('highlights code blocks with an explicit language', () => {
		const container = renderIntoContainer('```javascript\nconst value = 1;\n```');
		const code = container.querySelector('pre code') as HTMLElement;

		highlightCodeBlocks(container);

		expect(code.classList.contains('hljs')).toBe(true);
		expect(code.classList.contains('language-javascript')).toBe(true);
		expect(code.dataset.highlighted).toBe('true');
		expect(code.innerHTML).toContain('hljs-keyword');
	});

	it('highlights code blocks even when no language is specified', () => {
		const container = renderIntoContainer('```\nconst value = 1;\n```');
		const code = container.querySelector('pre code') as HTMLElement;

		highlightCodeBlocks(container);

		expect(code.classList.contains('hljs')).toBe(true);
		expect(code.dataset.highlighted).toBe('true');
		expect(code.innerHTML).toMatch(/hljs-[\w-]+/);
	});

	it('skips blocks that were already highlighted', () => {
		const container = document.createElement('div');
		container.innerHTML = '<pre><code data-highlighted="true">const value = 1;</code></pre>';
		const spy = vi.spyOn(hljs, 'highlightElement');

		highlightCodeBlocks(container);

		expect(spy).not.toHaveBeenCalled();
	});

	it('swallows highlighting errors and still marks the block as processed', () => {
		const container = renderIntoContainer('```javascript\nconst value = 1;\n```');
		const code = container.querySelector('pre code') as HTMLElement;
		vi.spyOn(hljs, 'highlightElement').mockImplementation(() => {
			throw new Error('highlight failed');
		});

		expect(() => highlightCodeBlocks(container)).not.toThrow();
		expect(code.dataset.highlighted).toBe('true');
	});
});

describe('addCopyButtons', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		document.body.innerHTML = '';
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('adds a copy button to each code block container', () => {
		const container = renderIntoContainer('```bash\necho hello\n```\n\n```javascript\nconst value = 1;\n```');

		addCopyButtons(container);

		expect(container.querySelectorAll('.copy-btn')).toHaveLength(2);
		container.querySelectorAll('pre').forEach((pre) => {
			expect(pre).toHaveStyle({ position: 'relative' });
		});
	});

	it('does not add duplicate copy buttons when called twice', () => {
		const container = renderIntoContainer('```bash\necho hello\n```');

		addCopyButtons(container);
		addCopyButtons(container);

		expect(container.querySelectorAll('.copy-btn')).toHaveLength(1);
	});

	it('copies code content and resets the button label after success', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});

		const container = renderIntoContainer('```bash\necho hello\n```');
		const code = container.querySelector('code');
		addCopyButtons(container);
		const button = container.querySelector('.copy-btn') as HTMLButtonElement;

		button.click();
		await Promise.resolve();

		expect(writeText).toHaveBeenCalledWith(code?.textContent ?? '');
		expect(button).toHaveTextContent('Copied!');

		await vi.advanceTimersByTimeAsync(1500);
		expect(button).toHaveTextContent('Copy');
	});
});
