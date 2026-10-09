/**
 * Verification patch check: list actionable gaps between JSX class usage and the
 * design-system CSS. Run with: node tools/check-classes.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync('src/styles/global.css', 'utf8');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.jsx?$/.test(path)) files.push(path);
  }
};
walk('src');

const used = new Map();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const raw = match[1] || match[2] || match[3] || '';
    for (const token of raw.split(/[\s${}?:'"+]+/)) {
      const name = token.trim();
      if (!name || name.includes('/')) continue;
      if (!used.has(name)) used.set(name, new Set());
      used.get(name).add(file);
    }
  }
}

const ignored = /^(<|===|\.|active\.|item\.|planet\.|row\.|state\.|statusClass|phase-|[a-z]+\.[a-zA-Z]+|[a-z][A-Za-z]*[A-Z][A-Za-z]*)$/;

const missing = [...used.entries()].filter(([name]) => !defined.has(name) && !ignored.test(name)).sort();
console.log(`classes used in JSX: ${used.size}`);
console.log(`classes defined in CSS: ${defined.size}`);
console.log(`\nused but undefined (${missing.length}):`);
for (const [name, where] of missing) console.log(`  ${name}  ← ${[...where].map((f) => f.replace(/\\/g, '/')).join(', ')}`);

const unusedSample = [...defined].filter((name) => !used.has(name) && !/^(w3|css|org|on|open|active|done|ready|visible)$/.test(name));
console.log(`\ndefined but unused in JSX (informational, ${unusedSample.length}):`);
console.log(`  ${unusedSample.slice(0, 60).join(' ')}`);
