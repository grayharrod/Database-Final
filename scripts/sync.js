// scripts/sync.js
// Creates every table from the Sequelize models in models/index.js, then adds
// the constraints and indexes the assignment asks for (UNIQUE, CHECK, INDEX).
//
// Usage (run from the repo root so db.js can find .env):
//   node scripts/sync.js           create missing tables, add missing constraints
//   node scripts/sync.js --force   DROP all 17 tables and rebuild them empty
//
// Safe to run more than once: each constraint/index is only added if it
// isn't already there.

const models = require('../models');
const { sequelize } = models;

const FORCE = process.argv.includes('--force');

// ---- Constraints and indexes added on top of the models ------------------
// kind: 'unique' | 'check' | 'index'
const EXTRAS = [
  // UNIQUE: no two alien forms / species / characters / etc. share a name
  { kind: 'unique', table: 'Alien_Form', name: 'uq_alien_form_name', sql: 'UNIQUE (name)' },
  { kind: 'unique', table: 'Species', name: 'uq_species_name', sql: 'UNIQUE (name)' },
  { kind: 'unique', table: 'Character', name: 'uq_character_name', sql: 'UNIQUE (name)' },
  { kind: 'unique', table: 'Location', name: 'uq_location_name', sql: 'UNIQUE (name)' },
  { kind: 'unique', table: 'Ability', name: 'uq_ability_name', sql: 'UNIQUE (name)' },
  { kind: 'unique', table: 'Organization', name: 'uq_organization_name', sql: 'UNIQUE (name)' },
  { kind: 'unique', table: 'Voice_Actor', name: 'uq_voice_actor_name', sql: 'UNIQUE (name)' },
  { kind: 'unique', table: 'Series', name: 'uq_series_title', sql: 'UNIQUE (title)' },
  { kind: 'unique', table: 'Season', name: 'uq_season_series_number', sql: 'UNIQUE (series_id, season_number)' },

  // CHECK: keep values in a sensible range
  { kind: 'check', table: 'Alien_Form', name: 'chk_alien_power_level', sql: 'CHECK (power_level BETWEEN 1 AND 10)' },
  { kind: 'check', table: 'Episode', name: 'chk_episode_number_positive', sql: 'CHECK (episode_number > 0)' },
  { kind: 'check', table: 'Season', name: 'chk_season_number_positive', sql: 'CHECK (season_number > 0)' },
  { kind: 'check', table: 'Series', name: 'chk_series_release_year', sql: 'CHECK (release_year BETWEEN 1990 AND 2100)' },
  { kind: 'check', table: 'Episode_Alien_Form', name: 'chk_times_used_positive', sql: 'CHECK (times_used >= 1)' },

  // INDEX: speed up common lookups (episodes by date, characters by role)
  { kind: 'index', table: 'Episode', name: 'idx_episode_air_date', sql: '(air_date)' },
  { kind: 'index', table: 'Episode_Character', name: 'idx_episode_character_role', sql: '(role_type)' },
  { kind: 'index', table: 'Character', name: 'idx_character_gender', sql: '(gender)' },
];

async function exists(table, name, kind) {
  const db = sequelize.config.database;
  if (kind === 'index' || kind === 'unique') {
    const [rows] = await sequelize.query(
      'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
      { replacements: [db, table, name] }
    );
    return rows.length > 0;
  }
  const [rows] = await sequelize.query(
    'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1',
    { replacements: [db, table, name] }
  );
  return rows.length > 0;
}

async function addExtras() {
  for (const e of EXTRAS) {
    if (await exists(e.table, e.name, e.kind)) {
      console.log(`  = ${e.kind.padEnd(6)} ${e.name} (already there)`);
      continue;
    }
    const ddl =
      e.kind === 'index'
        ? `CREATE INDEX \`${e.name}\` ON \`${e.table}\` ${e.sql}`
        : `ALTER TABLE \`${e.table}\` ADD CONSTRAINT \`${e.name}\` ${e.sql}`;
    await sequelize.query(ddl);
    console.log(`  + ${e.kind.padEnd(6)} ${e.name} on ${e.table}`);
  }
}

// Sequelize's belongsToMany adds a UNIQUE key on just (character_id, actor_id)
// to Character_Voice. That blocks the same actor voicing the same character in
// more than one season, which the composite PK (character_id, actor_id,
// season_id) is meant to allow. Drop that extra key if sync created it.
async function relaxCharacterVoice() {
  const db = sequelize.config.database;
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Character_Voice'
        AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
      GROUP BY INDEX_NAME`,
    { replacements: [db] }
  );
  for (const r of rows) {
    if (r.cols === 'character_id,actor_id' || r.cols === 'actor_id,character_id') {
      // (the primary key still starts with character_id, so the FK keeps an index)
      await sequelize.query(`ALTER TABLE \`Character_Voice\` DROP INDEX \`${r.INDEX_NAME}\``);
      console.log(`  - dropped ${r.INDEX_NAME} on Character_Voice (allows one actor per character per season)`);
    }
  }
}

async function main() {
  await sequelize.authenticate();
  console.log(`Connected to ${sequelize.config.database} on ${sequelize.config.host}`);

  if (FORCE) {
    console.log('--force: dropping and recreating all tables');
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await sequelize.sync({ force: true });
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  } else {
    await sequelize.sync();
  }
  console.log(`Tables ready (${Object.keys(sequelize.models).length} models)`);

  await relaxCharacterVoice();
  console.log('Constraints and indexes:');
  await addExtras();
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
