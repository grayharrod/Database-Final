// scripts/wiki.js
// Small helpers for reading MediaWiki wikitext from the Ben 10 Fandom wiki.
// Used by fetch_wiki.js. No dependencies.

const API = process.env.WIKI_API || 'https://ben10.fandom.com/api.php';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET the MediaWiki API with retries.
async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'CMSC4323-Ben10-DB-student-project/1.0' } });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return await res.json();
    } catch (err) {
      if (attempt === 5) throw err;
      await sleep(1000 * attempt * attempt);
    }
  }
}

// Find a template like {{EpisodeInfoBox ... }} and return its parameters as
// { lowercased key: raw value }. `names` is a list of template names to try.
function getTemplate(text, names) {
  if (!text) return null;
  const re = new RegExp('\\{\\{\\s*(' + names.map(escapeRe).join('|') + ')\\s*(\\||\\n|\\}\\})', 'i');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + 2;
  // walk to the matching }}
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    if (text.startsWith('{{', i)) { depth++; i += 2; }
    else if (text.startsWith('}}', i)) { depth--; i += 2; }
    else i++;
  }
  const body = text.slice(start, i - 2);
  return parseParams(body);
}

// Split template body on top-level pipes.
function parseParams(body) {
  const parts = [];
  let cur = '';
  let curly = 0;
  let square = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.substr(i, 2);
    if (two === '{{') { curly++; cur += two; i++; continue; }
    if (two === '}}') { curly--; cur += two; i++; continue; }
    if (two === '[[') { square++; cur += two; i++; continue; }
    if (two === ']]') { square--; cur += two; i++; continue; }
    if (body[i] === '|' && curly === 0 && square === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  const params = {};
  parts.slice(1).forEach((p, idx) => {
    const eq = p.indexOf('=');
    if (eq === -1) params[String(idx + 1)] = p.trim();
    else params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  });
  return params;
}

const SKIP_NS = /^(file|image|category|template|user|w|wikipedia|wp|help|special|media|[a-z]{2}(-[a-z]{2})?):/i;

function cleanTitle(t) {
  t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.startsWith(':')) t = t.slice(1);
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// All [[link]] targets in a string, in order.
function links(s) {
  if (!s) return [];
  const out = [];
  const re = /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(s))) {
    const target = m[1].trim();
    if (!target || SKIP_NS.test(target)) continue;
    out.push(cleanTitle(target));
  }
  return out;
}

// Remove templates, refs and markup, keep the visible text.
function stripMarkup(s) {
  if (!s) return '';
  let t = s;
  t = t.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '');
  t = removeTemplates(t, /^(refn|ref|efn|note|citation needed|cn)\b/i);
  t = t.replace(/\{\{\s*w\s*\|([^}|]+)(\|([^}]+))?\}\}/gi, (_, a, __, b) => b || a); // {{W|...}}
  t = t.replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
  t = t.replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1');
  t = t.replace(/'{2,}/g, '').replace(/<[^>]+>/g, ' ');
  t = t.replace(/\{\{[^{}]*\}\}/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

function removeTemplates(t, nameRe) {
  let out = '';
  let i = 0;
  while (i < t.length) {
    if (t.startsWith('{{', i)) {
      const name = t.slice(i + 2, i + 40);
      if (nameRe.test(name.trim())) {
        let depth = 1;
        let j = i + 2;
        while (j < t.length && depth > 0) {
          if (t.startsWith('{{', j)) { depth++; j += 2; }
          else if (t.startsWith('}}', j)) { depth--; j += 2; }
          else j++;
        }
        i = j;
        continue;
      }
    }
    out += t[i++];
  }
  return out;
}

// Split an infobox list value into items. The wiki separates list entries
// with <br> (sometimes wrapped in {{Scroll|...}}).
function listItems(s) {
  if (!s) return [];
  let t = s.replace(/^\s*\{\{\s*scroll\s*\|/i, '').replace(/\}\}\s*$/, '');
  t = t.replace(/<ref[\s\S]*?<\/ref>/gi, '');
  t = removeTemplates(t, /^(refn|ref|efn|note)\b/i);
  return t
    .split(/<br\s*\/?>|\n|\{\{\s*!\s*\}\}/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Text of a "==Heading==" section (level 2), up to the next level-2 heading.
function section(text, headingRe) {
  if (!text) return '';
  const lines = text.split('\n');
  let on = false;
  const out = [];
  for (const line of lines) {
    const h = /^==([^=].*?)==\s*$/.exec(line.trim());
    if (h) {
      if (on) break;
      if (headingRe.test(h[1].trim())) on = true;
      continue;
    }
    if (on) out.push(line);
  }
  return out.join('\n');
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

// "December 27, 2005" -> "2005-12-27"
function parseDate(s) {
  const t = stripMarkup(s);
  let m = new RegExp('(' + MONTHS + ')\\s+(\\d{1,2}),?\\s+(\\d{4})', 'i').exec(t);
  if (m) {
    const mon = MONTHS.split('|').findIndex((x) => x.toLowerCase() === m[1].toLowerCase()) + 1;
    return `${m[3]}-${String(mon).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return m[0];
  return null;
}

function firstInt(s) {
  const m = /\d+/.exec(stripMarkup(s || ''));
  return m ? parseInt(m[0], 10) : null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { api, sleep, getTemplate, links, stripMarkup, listItems, section, parseDate, firstInt, cleanTitle };
