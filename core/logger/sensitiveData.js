// Auto-masking for anything that originates from the data/sensitive folder.
//
// How it works
//   1. Every value stored under data/sensitive/** is loaded once (JSON leaf strings, and
//      "KEY: value" / "KEY=value" lines in .txt/.env/.properties files).
//   2. Text that flows through the framework's output paths (Logger, the execution-trace
//      attachment, saved logs) is scanned for those values and they are replaced with
//      [MASKED:<key>].
//
// Tuning (all optional)
//   SENSITIVE_MASK_MIN_LENGTH   values shorter than this are ignored (default 4), otherwise
//                               short strings would mask unrelated text
//   UNMASKED_KEYS               keys whose values are display data, not secrets. "Name" stays
//                               readable so step titles like "Login as Jack Howe" survive

const fs = require('fs');
const path = require('path');
const { SENSITIVE_DIR } = require('../../utils/global/paths');

const MIN_LENGTH = Number(process.env.SENSITIVE_MASK_MIN_LENGTH) || 4;
const UNMASKED_KEYS = new Set(['name']); // compared lower-case
const TEXT_EXTENSIONS = new Set(['.txt', '.env', '.properties', '.ini', '.cfg']);

let entries = null; // [{ variant, label }], longest value first

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collectJson(node, key, found) {
  if (typeof node === 'string') {
    found.push({ key, value: node });
  } else if (Array.isArray(node)) {
    node.forEach((child) => collectJson(child, key, found));
  } else if (node && typeof node === 'object') {
    for (const [childKey, child] of Object.entries(node)) collectJson(child, childKey, found);
  }
}

function collectText(raw, fallbackKey, found) {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    // "KEY: value" or "KEY=value" (the first separator wins, so URLs stay intact)
    const match = trimmed.match(/^([^:=]+?)\s*[:=]\s*(.+)$/);
    if (match) {
      found.push({ key: match[1].trim(), value: match[2].trim().replace(/^["']|["']$/g, '') });
    } else {
      found.push({ key: fallbackKey, value: trimmed });
    }
  }
}

// A secret can appear in logs as-is, URL-encoded, JSON-escaped or without a trailing slash
function variantsOf(value) {
  const out = new Set([value]);
  if (value.length > 1 && value.endsWith('/')) out.add(value.slice(0, -1));
  out.add(encodeURIComponent(value));
  out.add(JSON.stringify(value).slice(1, -1));
  return [...out].filter((variant) => variant.length >= MIN_LENGTH);
}

function load() {
  const registry = [];
  const seen = new Set();

  for (const file of walk(SENSITIVE_DIR)) {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file, ext);
    const found = [];

    try {
      const raw = fs.readFileSync(file, 'utf-8');
      if (ext === '.json') collectJson(JSON.parse(raw), base, found);
      else if (TEXT_EXTENSIONS.has(ext) || path.basename(file).startsWith('.env')) collectText(raw, base, found);
    } catch {
      continue; // unreadable or malformed file: skip it rather than break the test run
    }

    for (const { key, value } of found) {
      if (UNMASKED_KEYS.has(String(key).toLowerCase())) continue;
      if (typeof value !== 'string' || value.length < MIN_LENGTH) continue;
      for (const variant of variantsOf(value)) {
        if (seen.has(variant)) continue;
        seen.add(variant);
        registry.push({ variant, label: key });
      }
    }
  }

  // Longest first so a long value is masked before any shorter value inside it
  return registry.sort((a, b) => b.variant.length - a.variant.length);
}

function getEntries() {
  if (!entries) entries = load();
  return entries;
}

/** Replaces every value that came from data/sensitive in a string. */
function redactString(text) {
  if (typeof text !== 'string' || text.length === 0) return text;

  let out = text;
  for (const { variant, label } of getEntries()) {
    if (out.includes(variant)) out = out.split(variant).join(`[MASKED:${label}]`);
  }
  return out;
}

/** Deep version of redactString for objects / arrays (keys are left untouched). */
function redact(data) {
  if (typeof data === 'string') return redactString(data);
  if (Array.isArray(data)) return data.map(redact);
  if (data && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, redact(value)]));
  }
  return data;
}

/**
 * Partial mask for values that are NOT in data/sensitive (e.g. credentials typed straight into a test):
 * mask('secret123') -> 's*******3'
 */
function mask(value, visibleChars = 1) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (value.length <= visibleChars * 2) return '*'.repeat(value.length);
  const head = value.slice(0, visibleChars);
  const tail = value.slice(-visibleChars);
  return `${head}${'*'.repeat(value.length - visibleChars * 2)}${tail}`;
}

module.exports = { redactString, redact, mask };
