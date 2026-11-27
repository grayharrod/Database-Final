// scripts/fetch_wiki.js
// Downloads real data from the Ben 10 Fandom wiki (ben10.fandom.com) through
// its public MediaWiki API and saves it to data/ben10_wiki.json.
// seed.js then loads that file into MySQL, so you only need internet for this
// step.
//
// Usage (from the repo root):  node scripts/fetch_wiki.js
//
// What it reads:
//   * every page in Category:Episodes  -> series, season, number, air date,
//     and the page's Characters / Transformations / Locations / Cast sections
//   * each character page (Charbox infobox)  -> species, debut,
//     affiliations (organizations) and equipment (devices); gender comes
//     from the page's Category:Males / Category:Females tag
//   * each alien page (Infobox Alien)        -> species, powers, debut
//   * species, location, organization and series pages for their infoboxes
//
// Pages are cached in data/cache/pages.json, so re-running is fast and only
// downloads what's missing. Delete that file to force a fresh download.

const fs = require('fs');
const path = require('path');
const W = require('./wiki');

const ROOT = path.join(__dirname, '..');
const CACHE_FILE = path.join(ROOT, 'data', 'cache', 'pages.json');
const OUT_FILE = path.join(ROOT, 'data', 'ben10_wiki.json');
const BATCH = 50; // MediaWiki max titles per content request

// ---------------------------------------------------------------- cache ----
fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
let cache = { pages: {}, alias: {} };
if (fs.existsSync(CACHE_FILE)) cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));

function resolve(title) {
  let t = W.cleanTitle(title);
  for (let i = 0; i < 5 && cache.alias[t]; i++) t = cache.alias[t];
  return t;
}

// Fetch wikitext for many titles. lead=true keeps only the part before the
// first "==Heading==" (where the infobox lives) to keep the cache small.
async function fetchPages(titles, { lead = true, label = 'pages' } = {}) {
  const todo = [...new Set(titles.map(W.cleanTitle))].filter((t) => t && !(resolve(t) in cache.pages));
  if (todo.length) console.log(`  fetching ${todo.length} ${label}...`);
  for (let i = 0; i < todo.length; i += BATCH) {
    let batch = todo.slice(i, i + BATCH);
    // big pages can overflow one response; retry leftovers in smaller chunks
    for (let size = batch.length; batch.length && size >= 1; size = Math.floor(size / 2)) {
      const left = [];
      for (let j = 0; j < batch.length; j += size) {
        const chunk = batch.slice(j, j + size);
        const data = await W.api({
          action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
          redirects: '1', titles: chunk.join('|'),
        });
        const q = data.query || {};
        for (const n of q.normalized || []) cache.alias[W.cleanTitle(n.from)] = W.cleanTitle(n.to);
        for (const r of q.redirects || []) cache.alias[W.cleanTitle(r.from)] = W.cleanTitle(r.to);
        for (const p of q.pages || []) {
          const t = W.cleanTitle(p.title);
          if (p.missing || p.invalid) { cache.pages[t] = null; continue; }
          const rev = p.revisions && p.revisions[0];
          if (!rev) continue; // not returned this time -> retry
          let content = rev.slots ? rev.slots.main.content : rev.content;
          if (lead) {
            const cut = content.search(/\n==[^=]/);
            if (cut > 0) content = content.slice(0, cut);
          }
          cache.pages[t] = content;
        }
        for (const t of chunk) if (!(resolve(t) in cache.pages)) left.push(t);
        await W.sleep(150);
      }
      batch = left;
    }
    for (const t of batch) cache.pages[resolve(t)] = null; // give up on these
    saveCache();
    process.stdout.write(`    ${Math.min(i + BATCH, todo.length)}/${todo.length}\r`);
  }
  if (todo.length) process.stdout.write('\n');
}

const page = (t) => cache.pages[resolve(t)] || null;

// Gender comes from the wiki's Category:Males / Category:Females tags
// (character infoboxes don't have a gender field).
async function fetchGenders(titles) {
  cache.gender = cache.gender || {};
  const todo = titles.filter((t) => !(t in cache.gender));
  if (todo.length) console.log(`  fetching gender categories for ${todo.length} characters...`);
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    let cont = {};
    const found = {};
    do {
      const data = await W.api({
        action: 'query', prop: 'categories', clcategories: 'Category:Males|Category:Females',
        cllimit: 'max', titles: chunk.join('|'), ...cont,
      });
      for (const p of (data.query && data.query.pages) || []) {
        for (const c of p.categories || []) {
          found[W.cleanTitle(p.title)] = c.title === 'Category:Males' ? 'Male' : 'Female';
        }
      }
      cont = data.continue || null;
      await W.sleep(150);
    } while (cont);
    for (const t of chunk) cache.gender[t] = found[t] || null;
    saveCache();
  }
}

async function categoryMembers(cat) {
  const out = [];
  let cont = {};
  do {
    const data = await W.api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmnamespace: '0', cmlimit: '500', ...cont });
    out.push(...data.query.categorymembers.map((m) => W.cleanTitle(m.title)));
    cont = data.continue || null;
  } while (cont);
  return out;
}

// --------------------------------------------------------------- parsing ---
const EP_BOX = ['EpisodeInfoBox', 'Episode InfoBox', 'Episode Infobox', 'Infobox Episode'];
const CHAR_BOX = ['Charbox', 'Character', 'Infobox Character'];
const ALIEN_BOX = ['Infobox Alien'];
const SPECIES_BOX = ['Infobox Species'];
const GROUP_BOX = ['Group', 'Infobox Group', 'Organization'];
const LOC_BOX = ['Location', 'Infobox Location', 'Planet', 'Infobox Planet', 'Dimension'];
const SERIES_BOX = ['Television infobox', 'Infobox Series', 'Series Infobox', 'Infobox Show', 'Infobox TV Series'];

// Bullet list in a section -> [{ title, heading, line }], first link per line.
function bullets(sectionText) {
  const out = [];
  let heading = '';
  for (const raw of sectionText.split('\n')) {
    const line = raw.trim();
    const h = /^={3,}\s*(.*?)\s*={3,}$/.exec(line);
    if (h) { heading = h[1]; continue; }
    if (!line.startsWith('*')) continue;
    const l = W.links(line)[0];
    if (l) out.push({ title: resolve(l), heading, line });
  }
  return out;
}

function roleFor(heading) {
  const h = heading.toLowerCase();
  if (/main/.test(h)) return 'Main';
  if (/antagon|villain/.test(h)) return 'Antagonist';
  if (/support|ally|allies|hero|protagon/.test(h)) return 'Supporting';
  if (/minor|cameo/.test(h)) return 'Minor';
  return 'Other';
}

function timesUsed(line) {
  const m = /[x×](\d+)\b/i.exec(W.stripMarkup(line)) || /\((\d+)\s*times?\)/i.exec(line);
  if (m) return Math.max(1, parseInt(m[1], 10));
  if (/\btwice\b/i.test(line)) return 2;
  if (/\bthrice\b/i.test(line)) return 3;
  return 1;
}

function parseEpisode(title, text) {
  const box = W.getTemplate(text, EP_BOX);
  if (!box) return null;
  const seriesRaw = box['series'] || '';
  const series = resolve(W.links(seriesRaw)[0] || W.stripMarkup(seriesRaw));
  const season = W.firstInt(box['season']);
  const number = W.firstInt(box['episode number'] || box['episode']);
  if (!series || !season || !number) return null;

  const characters = new Map();
  for (const b of bullets(W.section(text, /^characters?$/i))) {
    if (!characters.has(b.title)) characters.set(b.title, { title: b.title, role: roleFor(b.heading), first: /first appearance/i.test(b.line) });
  }
  const aliens = new Map();
  for (const b of bullets(W.section(text, /^(transformations?|aliens used)$/i))) {
    const cur = aliens.get(b.title) || { title: b.title, count: 0, first: false };
    cur.count += timesUsed(b.line);
    cur.first = cur.first || /first appearance/i.test(b.line);
    aliens.set(b.title, cur);
  }
  const locations = [...new Set(bullets(W.section(text, /^locations?$/i)).map((b) => b.title))];

  const cast = [];
  const castBox = W.getTemplate(W.section(text, /^(cast|voice cast)$/i), ['Cast']);
  if (castBox) {
    for (const k of Object.keys(castBox)) {
      if (!/^\d+$/.test(k)) continue;
      const actor = W.stripMarkup(castBox[k]);
      const chars = W.links(castBox['char' + k] || '').map(resolve);
      if (actor && chars.length) cast.push({ actor, characters: [...new Set(chars)] });
    }
  }

  return {
    title,
    series,
    season,
    episode_number: number,
    air_date: W.parseDate(box['original broadcast'] || box['airdate'] || box['air date'] || ''),
    characters: [...characters.values()],
    aliens: [...aliens.values()],
    locations,
    cast,
  };
}

// "(formerly)" style note at the end of a list item
const note = (item) => {
  const m = /\(([^()]*)\)\s*$/.exec(W.stripMarkup(item));
  return m ? m[1].trim().slice(0, 100) : null;
};

// --------------------------------------------------------------- main ------
async function main() {
  console.log('Reading Category:Episodes from ben10.fandom.com ...');
  const epTitles = await categoryMembers('Category:Episodes');
  console.log(`  ${epTitles.length} pages in category`);
  await fetchPages(epTitles, { lead: false, label: 'episode pages' });

  const episodes = [];
  for (const t of epTitles) {
    const e = parseEpisode(resolve(t), page(t));
    if (e) episodes.push(e);
  }
  console.log(`  ${episodes.length} pages parsed as episodes`);

  // characters, aliens and locations named on episode pages
  const charTitles = new Set();
  const alienTitles = new Set();
  const locTitles = new Set();
  for (const e of episodes) {
    e.characters.forEach((c) => charTitles.add(c.title));
    e.cast.forEach((c) => c.characters.forEach((x) => charTitles.add(x)));
    e.aliens.forEach((a) => alienTitles.add(a.title));
    e.locations.forEach((l) => locTitles.add(l));
  }
  await fetchPages([...charTitles], { label: 'character pages' });
  await fetchPages([...alienTitles], { label: 'alien pages' });

  const characters = {};
  const organizations = {};
  const speciesTitles = new Set();
  const orgTitles = new Set();
  const affiliations = [];
  const devices = [];
  for (const t of charTitles) {
    const text = page(t);
    const box = W.getTemplate(text, CHAR_BOX);
    if (!box) continue;
    const title = resolve(t);
    const species = W.links(box['species'] || '')[0];
    characters[title] = {
      species: species ? resolve(species) : null,
      gender: null, // filled in from categories below
      first: W.stripMarkup(W.links(box['first'] || '')[0] || box['first'] || '') || null,
    };
    if (species) speciesTitles.add(resolve(species));
    for (const item of W.listItems(box['affiliation'] || '')) {
      const org = W.links(item)[0];
      if (!org) continue;
      orgTitles.add(resolve(org));
      affiliations.push({ character: title, organization: resolve(org) });
    }
    for (const item of W.listItems(box['equipment'] || '')) {
      const dev = W.links(item)[0];
      if (!dev) continue;
      devices.push({ name: resolve(dev), owner: title, note: note(item) });
    }
  }
  console.log(`  ${Object.keys(characters).length} character pages have a Charbox`);
  await fetchGenders(Object.keys(characters));
  for (const t of Object.keys(characters)) characters[t].gender = cache.gender[t] || null;

  const aliens = {};
  for (const t of alienTitles) {
    const box = W.getTemplate(page(t), ALIEN_BOX);
    if (!box) continue;
    const species = W.links(box['species'] || '')[0];
    if (species) speciesTitles.add(resolve(species));
    const powers = W.listItems(box['power'] || box['powers'] || box['abilities'] || '')
      .map(W.stripMarkup)
      .map((p) => p.replace(/\s*\(.*$/, '').replace(/[:.]+$/, '').trim())
      .filter((p) => p.length >= 3 && p.length <= 100 && !/only$/i.test(p));
    aliens[resolve(t)] = {
      species: species ? resolve(species) : null,
      powers: [...new Set(powers)],
      first: W.stripMarkup(W.links(box['1st-appearance'] || box['first'] || '')[0] || box['1st-appearance'] || box['first'] || '') || null,
    };
  }
  console.log(`  ${Object.keys(aliens).length} alien pages have an Infobox Alien`);

  await fetchPages([...speciesTitles], { label: 'species pages' });
  await fetchPages([...orgTitles], { label: 'organization pages' });

  const species = {};
  for (const t of speciesTitles) {
    const box = W.getTemplate(page(t), SPECIES_BOX) || {};
    const home = W.links(box['home-planet'] || box['home planet'] || box['homeworld'] || box['home world'] || '')[0];
    species[t] = { homeworld: home ? resolve(home) : null };
    if (home) locTitles.add(resolve(home));
  }
  for (const t of orgTitles) {
    const box = W.getTemplate(page(t), GROUP_BOX);
    if (!box) continue;
    const base = W.links(box['base'] || box['headquarters'] || box['headquarter'] || box['location'] || '')[0];
    organizations[t] = { type: W.stripMarkup(box['type'] || '').slice(0, 50) || null, base: base ? resolve(base) : null };
    if (base) locTitles.add(resolve(base));
  }
  console.log(`  ${Object.keys(organizations).length} organization pages have a Group infobox`);

  await fetchPages([...locTitles], { label: 'location pages' });
  const locations = {};
  for (const t of locTitles) {
    const box = W.getTemplate(page(t), LOC_BOX) || {};
    locations[t] = {
      type: W.stripMarkup(box['type'] || '').slice(0, 50) || null,
      galaxy: W.stripMarkup(box['galaxy'] || '').slice(0, 50) || null,
    };
  }

  const seriesTitles = [...new Set(episodes.map((e) => e.series))];
  await fetchPages(seriesTitles, { label: 'series pages' });
  // "Ben 10: Alien Force" is a disambiguation page; the show is "... (TV Series)"
  await fetchPages(seriesTitles.map((t) => t + ' (TV Series)'), { label: 'series pages' });
  const series = {};
  for (const t of seriesTitles) {
    const box = W.getTemplate(page(t), SERIES_BOX) || W.getTemplate(page(t + ' (TV Series)'), SERIES_BOX) || {};
    const net = W.stripMarkup(W.listItems(box['network'] || box['channel'] || box['original network'] || '')[0] || '');
    series[t] = { network: net ? net.slice(0, 50) : null };
  }

  const out = {
    source: 'https://ben10.fandom.com (MediaWiki API, CC BY-SA)',
    fetched_at: new Date().toISOString(),
    series, episodes, characters, aliens, species, locations, organizations, affiliations, devices,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
  console.log(`Saved ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`  series ${Object.keys(series).length}, episodes ${episodes.length}, characters ${Object.keys(characters).length}, aliens ${Object.keys(aliens).length}, species ${Object.keys(species).length}, locations ${Object.keys(locations).length}, organizations ${Object.keys(organizations).length}, devices ${devices.length}`);
}

main().catch((err) => {
  console.error('Fetch failed:', err.message);
  process.exitCode = 1;
});
