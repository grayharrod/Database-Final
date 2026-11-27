// scripts/seed.js
// Loads data/ben10_wiki.json (made by fetch_wiki.js from the Ben 10 Fandom
// wiki) into all 17 tables.
//
// Usage (from the repo root, after `node scripts/sync.js`):
//   node scripts/seed.js
//
// Re-runnable: it empties every table and reloads everything inside one
// transaction, so a failed run leaves the old data in place.
//
// Where each column comes from (all from the wiki, nothing made up):
//   Series.release_year  = year of the series' earliest episode air date
//   Season.year          = year of the season's earliest episode air date
//   Alien_Form.power_level (1-10) = decile of how many powers the alien's
//                          wiki infobox lists, compared with all other aliens
//   Episode_Character.role_type = the Characters sub-heading the character is
//                          listed under on the episode page (Main, Antagonist...)
//   Episode_Alien_Form.times_used = times the alien is listed under the
//                          episode's Transformations section
//   Character_Voice      = the episode's Cast table, tied to that episode's season
//   Device.description   = the note after the item in the character's
//                          equipment list, e.g. "formerly"

const fs = require('fs');
const path = require('path');
const m = require('../models');
const { sequelize } = m;

const DATA_FILE = path.join(__dirname, '..', 'data', 'ben10_wiki.json');

// keeps one id per name, case-insensitively (MySQL's default collation
// treats "Earth" and "earth" as the same value for UNIQUE)
class IdMap {
  constructor() { this.ids = new Map(); this.rows = []; }
  key(name) { return String(name).trim().toLowerCase(); }
  get(name) { return name == null ? null : this.ids.get(this.key(name)) || null; }
  add(name, row) {
    const k = this.key(name);
    if (this.ids.has(k)) return this.ids.get(k);
    const id = this.rows.length + 1;
    this.ids.set(k, id);
    this.rows.push({ id, ...row });
    return id;
  }
}

const cut = (s, n) => (s == null ? null : String(s).slice(0, n));
const yearOf = (d) => (d ? parseInt(d.slice(0, 4), 10) : null);
const minYear = (dates) => {
  const ys = dates.map(yearOf).filter((y) => y && y >= 1990 && y <= 2100);
  return ys.length ? Math.min(...ys) : null;
};

function build(data) {
  const series = new IdMap();
  const seasons = new IdMap();
  const episodes = new IdMap();
  const locations = new IdMap();
  const species = new IdMap();
  const characters = new IdMap();
  const aliens = new IdMap();
  const abilities = new IdMap();
  const orgs = new IdMap();
  const actors = new IdMap();
  const devices = [];
  const links = { epAlien: new Map(), epLoc: new Map(), epChar: new Map(), alienAbility: new Map(), charOrg: new Map(), charVoice: new Map() };

  // --- series, seasons, episodes (sorted by air date so ids follow airing order)
  const eps = [...data.episodes].sort((a, b) => (a.air_date || '9999').localeCompare(b.air_date || '9999'));
  for (const e of eps) {
    const sTitle = cut(e.series, 100);
    const sDates = eps.filter((x) => x.series === e.series).map((x) => x.air_date);
    const seriesId = series.add(sTitle, {
      title: sTitle,
      release_year: minYear(sDates),
      network: cut((data.series[e.series] || {}).network, 50),
    });
    const seasonKey = `${seriesId}#${e.season}`;
    const seasonId = seasons.add(seasonKey, {
      series_id: seriesId,
      season_number: e.season,
      year: minYear(eps.filter((x) => x.series === e.series && x.season === e.season).map((x) => x.air_date)),
    });
    episodes.add(e.title, { season_id: seasonId, title: cut(e.title, 150), episode_number: e.episode_number, air_date: e.air_date });
  }
  const seasonOfEpisode = (title) => {
    const id = episodes.get(title);
    return id ? episodes.rows[id - 1].season_id : null;
  };

  // --- locations (episode locations, species homeworlds, org bases)
  const addLoc = (title) => {
    if (!title) return null;
    const info = data.locations[title] || {};
    return locations.add(cut(title, 100), { name: cut(title, 100), type: cut(info.type, 50), galaxy: cut(info.galaxy, 50) });
  };
  data.episodes.forEach((e) => e.locations.forEach(addLoc));

  // --- species
  const addSpecies = (title) => {
    if (!title) return null;
    const info = data.species[title] || {};
    return species.add(cut(title, 100), { name: cut(title, 100), homeworld_id: addLoc(info.homeworld) });
  };

  // --- episode "first appearance" fallback for debut episodes
  const firstSeen = new Map();
  for (const e of eps) {
    for (const c of e.characters) if (c.first && !firstSeen.has('c:' + c.title)) firstSeen.set('c:' + c.title, e.title);
    for (const a of e.aliens) if (a.first && !firstSeen.has('a:' + a.title)) firstSeen.set('a:' + a.title, e.title);
  }

  // --- characters
  for (const [title, c] of Object.entries(data.characters)) {
    const sp = addSpecies(c.species);
    characters.add(cut(title, 100), {
      name: cut(title, 100),
      species_id: sp,
      gender: cut(c.gender, 20),
      is_human: c.species ? /^human\b/i.test(c.species) : null,
      first_episode_id: episodes.get(c.first) || episodes.get(firstSeen.get('c:' + title)),
    });
  }

  // --- alien forms + abilities; power_level = decile of listed-power count
  const alienEntries = Object.entries(data.aliens);
  const counts = alienEntries.map(([, a]) => a.powers.length).sort((x, y) => x - y);
  const decile = (n) => {
    const below = counts.filter((x) => x < n).length;
    return Math.min(10, Math.max(1, Math.floor((below / counts.length) * 10) + 1));
  };
  for (const [title, a] of alienEntries) {
    const id = aliens.add(cut(title, 100), {
      name: cut(title, 100),
      species_id: addSpecies(a.species),
      power_level: decile(a.powers.length),
      first_episode_id: episodes.get(a.first) || episodes.get(firstSeen.get('a:' + title)),
    });
    for (const p of a.powers) {
      const abId = abilities.add(cut(p, 100), { name: cut(p, 100), description: null });
      links.alienAbility.set(`${id}#${abId}`, { alien_form_id: id, ability_id: abId });
    }
  }

  // --- organizations
  for (const [title, o] of Object.entries(data.organizations)) {
    orgs.add(cut(title, 100), { name: cut(title, 100), type: cut(o.type, 50), base_location_id: addLoc(o.base) });
  }
  for (const a of data.affiliations) {
    const cId = characters.get(a.character);
    const oId = orgs.get(a.organization);
    if (cId && oId) links.charOrg.set(`${cId}#${oId}`, { character_id: cId, org_id: oId, rank: null, joined_season_id: null });
  }

  // --- devices
  const seenDev = new Set();
  for (const d of data.devices) {
    const owner = characters.get(d.owner);
    if (!owner) continue;
    const k = `${d.name.toLowerCase()}#${owner}`;
    if (seenDev.has(k)) continue;
    seenDev.add(k);
    devices.push({ id: devices.length + 1, name: cut(d.name, 100), owner_character_id: owner, description: cut(d.note, 100) });
  }

  // --- episode link tables + voice cast
  for (const e of data.episodes) {
    const epId = episodes.get(e.title);
    if (!epId) continue;
    for (const c of e.characters) {
      const cId = characters.get(c.title);
      if (cId) links.epChar.set(`${epId}#${cId}`, { episode_id: epId, character_id: cId, role_type: c.role });
    }
    for (const a of e.aliens) {
      const aId = aliens.get(a.title);
      if (aId) links.epAlien.set(`${epId}#${aId}`, { episode_id: epId, alien_form_id: aId, times_used: a.count });
    }
    for (const l of e.locations) {
      const lId = locations.get(l);
      if (lId) links.epLoc.set(`${epId}#${lId}`, { episode_id: epId, location_id: lId });
    }
    const seasonId = seasonOfEpisode(e.title);
    for (const c of e.cast) {
      const aId = actors.add(cut(c.actor, 100), { name: cut(c.actor, 100) });
      for (const ch of c.characters) {
        const cId = characters.get(ch);
        if (cId) links.charVoice.set(`${cId}#${aId}#${seasonId}`, { character_id: cId, actor_id: aId, season_id: seasonId });
      }
    }
  }

  const withPk = (rows, pk) => rows.map(({ id, ...r }) => ({ [pk]: id, ...r }));
  // insert order respects foreign keys
  return [
    [m.Series, withPk(series.rows, 'series_id')],
    [m.Season, withPk(seasons.rows, 'season_id')],
    [m.Episode, withPk(episodes.rows, 'episode_id')],
    [m.Location, withPk(locations.rows, 'location_id')],
    [m.Species, withPk(species.rows, 'species_id')],
    [m.Character, withPk(characters.rows, 'character_id')],
    [m.AlienForm, withPk(aliens.rows, 'alien_form_id')],
    [m.Ability, withPk(abilities.rows, 'ability_id')],
    [m.Organization, withPk(orgs.rows, 'org_id')],
    [m.Device, withPk(devices, 'device_id')],
    [m.VoiceActor, withPk(actors.rows, 'actor_id')],
    [m.EpisodeAlienForm, [...links.epAlien.values()]],
    [m.EpisodeLocation, [...links.epLoc.values()]],
    [m.EpisodeCharacter, [...links.epChar.values()]],
    [m.AlienFormAbility, [...links.alienAbility.values()]],
    [m.CharacterOrganization, [...links.charOrg.values()]],
    [m.CharacterVoice, [...links.charVoice.values()]],
  ];
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error('data/ben10_wiki.json not found. Run `node scripts/fetch_wiki.js` first.');
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const plan = build(data);

  await sequelize.transaction(async (transaction) => {
    // empty children first, then parents
    for (const [model] of [...plan].reverse()) {
      await model.destroy({ where: {}, transaction });
    }
    for (const [model, rows] of plan) {
      for (let i = 0; i < rows.length; i += 1000) {
        await model.bulkCreate(rows.slice(i, i + 1000), { transaction });
      }
    }
  });

  let total = 0;
  console.log(`Loaded data fetched ${data.fetched_at} from ${data.source}`);
  console.log('Table                    Rows');
  for (const [model] of plan) {
    const n = await model.count();
    total += n;
    console.log(`${model.tableName.padEnd(24)} ${String(n).padStart(5)}`);
  }
  console.log(`${'TOTAL'.padEnd(24)} ${String(total).padStart(5)}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
