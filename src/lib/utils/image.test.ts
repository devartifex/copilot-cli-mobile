import { describe, it, expect } from 'vitest';
import { isImageFile, hasImageAttachments } from './image.js';

describe('isImageFile', () => {
  it('returns true for image MIME types', () => {
    expect(isImageFile({ type: 'image/png', name: 'photo.png' })).toBe(true);
    expect(isImageFile({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(true);
    expect(isImageFile({ type: 'image/gif', name: 'anim.gif' })).toBe(true);
    expect(isImageFile({ type: 'image/webp', name: 'photo.webp' })).toBe(true);
    expect(isImageFile({ type: 'image/svg+xml', name: 'icon.svg' })).toBe(true);
  });

  it('returns true for image extensions when MIME type is empty', () => {
    expect(isImageFile({ type: '', name: 'photo.jpg' })).toBe(true);
    expect(isImageFile({ type: '', name: 'photo.jpeg' })).toBe(true);
    expect(isImageFile({ type: '', name: 'photo.png' })).toBe(true);
    expect(isImageFile({ type: '', name: 'photo.gif' })).toBe(true);
    expect(isImageFile({ type: '', name: 'photo.webp' })).toBe(true);
  });

  it('is case-insensitive for extensions', () => {
    expect(isImageFile({ type: '', name: 'photo.JPG' })).toBe(true);
    expect(isImageFile({ type: '', name: 'photo.PNG' })).toBe(true);
  });

  it('returns false for non-image files', () => {
    expect(isImageFile({ type: 'text/plain', name: 'readme.txt' })).toBe(false);
    expect(isImageFile({ type: 'application/json', name: 'data.json' })).toBe(false);
    expect(isImageFile({ type: '', name: 'script.ts' })).toBe(false);
    expect(isImageFile({ type: '', name: 'styles.css' })).toBe(false);
  });

  it('returns false for files with no extension', () => {
    expect(isImageFile({ type: '', name: 'Makefile' })).toBe(false);
  });
});

describe('hasImageAttachments', () => {
  it('returns true when at least one file is an image', () => {
    const files = [
      { type: 'text/plain', name: 'readme.txt' },
      { type: 'image/png', name: 'screenshot.png' },
    ];
    expect(hasImageAttachments(files)).toBe(true);
  });

  it('returns false when no files are images', () => {
    const files = [
      { type: 'text/plain', name: 'readme.txt' },
      { type: 'application/json', name: 'config.json' },
    ];
    expect(hasImageAttachments(files)).toBe(false);
  });

  it('returns false for an empty array', () => {
    expect(hasImageAttachments([])).toBe(false);
  });
});
