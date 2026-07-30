#!/usr/bin/env node
// Checks internal (relative) links in every markdown file against the filesystem.
// External links (http/https/mailto) are not checked — that requires network access
// this script deliberately avoids so it can run offline in CI.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'coverage', '.next', 'out',
]);

function findMarkdownFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.devcontainer') continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findMarkdownFiles(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

function extractHeadingSlugs(content) {
  const slugs = new Set();
  const headingRe = /^#{1,6}\s+(.+)$/gm;
  let match;
  while ((match = headingRe.exec(content)) !== null) {
    const slug = match[1]
      .trim()
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    slugs.add(slug);
  }

  const namedAnchorRe = /<a\s+name=["']([^"']+)["']/gi;
  while ((match = namedAnchorRe.exec(content)) !== null) {
    slugs.add(match[1].toLowerCase());
  }

  return slugs;
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function checkFile(file, allFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const problems = [];
  let match;

  while ((match = LINK_RE.exec(content)) !== null) {
    let link = match[1];

    if (/^(https?:|mailto:)/i.test(link)) continue;
    if (link.startsWith('#')) {
      const slugs = extractHeadingSlugs(content);
      const anchor = link.slice(1).toLowerCase();
      if (anchor && !slugs.has(anchor)) {
        problems.push(`  broken anchor: ${match[0]}`);
      }
      continue;
    }

    const [targetPath, anchor] = link.split('#');
    if (!targetPath) continue;

    const resolved = path.resolve(dir, decodeURIComponent(targetPath));
    if (!fs.existsSync(resolved)) {
      problems.push(`  broken link: ${link} -> ${path.relative(ROOT, resolved)}`);
      continue;
    }

    if (anchor && resolved.endsWith('.md')) {
      const targetContent = fs.readFileSync(resolved, 'utf8');
      const slugs = extractHeadingSlugs(targetContent);
      if (!slugs.has(anchor.toLowerCase())) {
        problems.push(`  broken anchor: ${link} (heading not found in ${path.relative(ROOT, resolved)})`);
      }
    }
  }

  return problems;
}

function listTrackedMarkdownFiles() {
  let files;
  try {
    files = execSync('git ls-files "*.md"', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((f) => path.join(ROOT, f));
  } catch {
    files = findMarkdownFiles(ROOT);
  }
  return files.filter((f) => !f.split(path.sep).includes('node_modules'));
}

const files = listTrackedMarkdownFiles();
let failed = false;

for (const file of files) {
  const problems = checkFile(file, files);
  if (problems.length > 0) {
    failed = true;
    console.error(`\n❌ ${path.relative(ROOT, file)}`);
    problems.forEach((p) => console.error(p));
  }
}

if (failed) {
  console.error('\nBroken internal markdown links found.');
  process.exit(1);
} else {
  console.log(`✅ Checked ${files.length} markdown files — all internal links resolve.`);
}
