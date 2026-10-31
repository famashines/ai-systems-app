const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repo = path.resolve(__dirname, '..');
const roots = ['src', 'scripts', '.github/workflows'];
const skipDirs = new Set(['node_modules', '__pycache__']);
const keep = /^(\/\/|\/\*)\s*(eslint-|eslint\s|global\s|@ts-(expect-error|ignore|nocheck)|\/ <reference|@license|SPDX-License-Identifier|!)/;
const hashKeep = /^#\s*(\/\/\/( script)?$|@generated|@end|noqa|type:\s*ignore|pyright:|yaml-language-server:)/;

function scriptComments(text, fileName) {
  const kind = /\.(tsx|jsx|js)$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const seen = new Map();
  const add = (ranges) => {
    for (const range of ranges ?? []) seen.set(range.pos, range);
  };
  const visit = (node) => {
    if (node.kind !== ts.SyntaxKind.JsxText) {
      add(ts.getLeadingCommentRanges(text, node.pos));
      add(ts.getTrailingCommentRanges(text, node.end));
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return [...seen.values()]
    .sort((a, b) => a.pos - b.pos)
    .filter((range) => !keep.test(text.slice(range.pos, range.end).split('\n')[0]))
    .map((range) => ({ ...range, line: source.getLineAndCharacterOfPosition(range.pos).line + 1 }));
}

function hashComments(text) {
  const hits = [];
  let inScript = false;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line.startsWith('#')) {
      const stripped = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
      const mark = stripped.match(/(^|\s)(#.*)$/);
      if (mark && !hashKeep.test(mark[2])) hits.push({ line: index + 1 });
      return;
    }
    if (index === 0 && line.startsWith('#!')) return;
    if (line === '# /// script') inScript = true;
    if (inScript) {
      if (line === '# ///') inScript = false;
      return;
    }
    if (!hashKeep.test(line)) hits.push({ line: index + 1 });
  });
  return hits;
}

function findComments(text, fileName) {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(fileName)) return scriptComments(text, fileName);
  if (/\.(py|sh|ya?ml)$/.test(fileName)) return hashComments(text);
  return [];
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function files() {
  const found = fs
    .readdirSync(repo)
    .filter((name) => /^(jest\..*|eslint\.config)\.js$/.test(name))
    .map((name) => path.join(repo, name));
  for (const root of roots) {
    const dir = path.join(repo, root);
    if (fs.existsSync(dir)) found.push(...walk(dir));
  }
  return found;
}

if (require.main === module) {
  let count = 0;
  for (const file of files()) {
    for (const hit of findComments(fs.readFileSync(file, 'utf8'), file)) {
      count += 1;
      console.log(`${path.relative(repo, file)}:${hit.line}`);
    }
  }
  if (count) {
    console.error(`${count} comment(s) found. The project rule is no code comments.`);
    process.exit(1);
  }
}

module.exports = { findComments, files };
