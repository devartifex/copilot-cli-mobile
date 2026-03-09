// Type declarations for CDN-loaded libraries (marked, DOMPurify, highlight.js)

interface MarkedOptions {
  breaks?: boolean;
  gfm?: boolean;
}

declare const marked: {
  parse(src: string, options?: MarkedOptions): string;
};

interface DOMPurifyConfig {
  ADD_TAGS?: string[];
  ADD_ATTR?: string[];
}

declare const DOMPurify: {
  sanitize(dirty: string, config?: DOMPurifyConfig): string;
};

declare const hljs: {
  highlightElement(block: Element): void;
};
