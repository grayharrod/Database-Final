# Setting up and loading the Ben 10 database

These scripts sit next to Grayson's models and don't change any of his files
(`models/index.js`, `db.js`, the ERD). Everything new is in `scripts/` and `data/`.

| File | What it does |
|---|---|
| `scripts/sync.js` | Creates all 17 tables from the Sequelize models, then adds the UNIQUE, CHECK and INDEX constraints |
| `scripts/fetch_wiki.js` | Downloads real data from the Ben 10 Fandom wiki API into `data/ben10_wiki.json` |
| `scripts/wiki.js` | Helper functions for reading wiki pages (used by `fetch_wiki.js`) |
| `scripts/seed.js` | Loads `data/ben10_wiki.json` into all 17 tables and prints a row count per table |

## Run it

You need Node.js and a running MySQL server.

1. Create the database once in MySQL: `CREATE DATABASE ben10;`
2. Copy `.env.example` to `.env` and put in your MySQL user and password.
3. From this folder:

```
npm install
node scripts/sync.js          # create tables + constraints (add --force to drop and rebuild)
node scripts/fetch_wiki.js    # download wiki data (needs internet, about 1-3 minutes)
node scripts/seed.js          # load it into MySQL
```

All three scripts can be run again safely. `seed.js` wipes and reloads every
table in one transaction. `fetch_wiki.js` caches pages in `data/cache/`, so a
second run only downloads what's missing.

## Constraints added by sync.js

* **UNIQUE**: `Alien_Form.name`, `Species.name`, `Character.name`, `Location.name`,
  `Ability.name`, `Organization.name`, `Voice_Actor.name`, `Series.title`,
  `Season (series_id, season_number)`
* **CHECK**: `Alien_Form.power_level BETWEEN 1 AND 10`, `Episode.episode_number > 0`,
  `Season.season_number > 0`, `Series.release_year BETWEEN 1990 AND 2100`,
  `Episode_Alien_Form.times_used >= 1`
* **INDEX**: `Episode(air_date)`, `Episode_Character(role_type)`, `Character(gender)`

It also drops one key that Sequelize adds on its own: `belongsToMany` puts a
UNIQUE key on `Character_Voice (character_id, actor_id)`, which would stop the
same actor voicing the same character in more than one season. The composite
primary key `(character_id, actor_id, season_id)` stays.

Quick demo of the CHECK constraint (this should fail):

```sql
UPDATE Alien_Form SET power_level = 11 WHERE alien_form_id = 1;
```

## Where the data comes from

Everything is read from https://ben10.fandom.com through its public MediaWiki
API. Nothing is typed in by hand or made up.

* **Episodes**: every page in Category:Episodes that has an episode infobox
  (series, season, episode number, original air date).
* **Episode_Character / Episode_Alien_Form / Episode_Location**: the
  Characters, Transformations and Locations lists on each episode page.
  `role_type` is the sub-heading the character is listed under (Main,
  Antagonist, Supporting, Minor, Other). `times_used` is how many times the
  alien is listed in that episode's Transformations.
* **Voice_Actor / Character_Voice**: the Cast table on each episode page, tied
  to that episode's season.
* **Character**: character pages with a Charbox infobox (species, first
  appearance). `gender` comes from the page's Category:Males or
  Category:Females tag. `is_human` is true when the species is Human.
* **Organization / Character_Organization**: the character's affiliation list,
  for pages that have a Group infobox.
* **Device**: items linked in the character's equipment list. `description` is
  the note after the item, such as "formerly".
* **Alien_Form / Ability / Alien_Form_Ability**: alien pages with an Infobox
  Alien (species, powers, first appearance).
* **Species / Location**: their own infoboxes (home planet, type, galaxy).
* Columns the wiki doesn't have are left NULL (for example
  `Character_Organization.rank`, `Series.network`, most of `Location.galaxy`).

Two values are worked out from wiki data rather than read directly:

* `Series.release_year` and `Season.year` are the year of the earliest episode air date.
* `Alien_Form.power_level` (1 to 10) is the alien's decile by number of powers
  listed in its infobox, compared with every other alien. Heatblast lists about
  30 powers, so it lands near the top.

Wiki text is CC BY-SA, so credit ben10.fandom.com in the slides.

## Next: the API and the GUI

After the data is loaded, `node scripts/setup_sql.js` creates the VIEW and the
STORED PROCEDURE, and `npm run api` starts the server. Open
http://localhost:3000 for the GUI (browse, create, edit, delete, and natural-language
questions). Copy `LLM_API_KEY` into `.env` before using Ask. See `API.md` for the
endpoints and the step-by-step demo.
