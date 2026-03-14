const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export function isImageFile(file: { type: string; name: string }): boolean {
  if (file.type.startsWith('image/')) return true;
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function hasImageAttachments(files: { type: string; name: string }[]): boolean {
  return files.some((f) => isImageFile(f));
}
