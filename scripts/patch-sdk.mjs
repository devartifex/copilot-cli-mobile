/**
 * Patches @github/copilot-sdk/dist/session.js to fix a missing `.js` extension
 * on the `vscode-jsonrpc/node` import, which causes ERR_MODULE_NOT_FOUND on
 * Node 24 in ESM mode.
 *
 * Bug: import ... from "vscode-jsonrpc/node"
 * Fix: import ... from "vscode-jsonrpc/node.js"
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const target = resolve(root, 'node_modules/@github/copilot-sdk/dist/session.js');

let src;
try {
  src = readFileSync(target, 'utf8');
} catch {
  console.log('[patch-sdk] @github/copilot-sdk/dist/session.js not found, skipping.');
  process.exit(0);
}

const BAD  = '"vscode-jsonrpc/node"';
const GOOD = '"vscode-jsonrpc/node.js"';

if (!src.includes(BAD)) {
  console.log('[patch-sdk] already patched or import not present, nothing to do.');
  process.exit(0);
}

const patched = src.replaceAll(BAD, GOOD);
writeFileSync(target, patched, 'utf8');
console.log('[patch-sdk] patched vscode-jsonrpc/node → vscode-jsonrpc/node.js in @github/copilot-sdk/dist/session.js');
