// scripts/setup_sql.js
// Creates the VIEW v_alien_usage and the STORED PROCEDURE sp_character_episodes
// by running sql/view_and_procedure.sql against the database in .env.
//
// Usage (from the repo root, after sync.js and seed.js):
//   node scripts/setup_sql.js
//
// Safe to run again: the .sql file drops each object before creating it.

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const SQL_FILE = path.join(__dirname, '..', 'sql', 'view_and_procedure.sql');

// The .sql file uses "DELIMITER $$" so it also works in MySQL Workbench.
// DELIMITER is a Workbench/command-line feature, not SQL, so here we drop
// those lines and the USE line (the database comes from .env), then split
// the file on $$ and send each statement on its own.
function statements(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(DELIMITER|USE)\b/i.test(line))
    .join('\n')
    .split('$$')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim() !== '');
}

async function main() {
  await sequelize.authenticate();
  console.log(`Connected to ${sequelize.config.database}`);

  for (const stmt of statements(fs.readFileSync(SQL_FILE, 'utf8'))) {
    const firstLine = stmt.replace(/--.*$/gm, '').trim().split('\n')[0];
    await sequelize.query(stmt);
    console.log(`  ok  ${firstLine}`);
  }

  // quick check that both work
  const [view] = await sequelize.query('SELECT COUNT(*) AS n FROM v_alien_usage');
  const proc = await sequelize.query("CALL sp_character_episodes('Kevin')");
  console.log(`v_alien_usage has ${view[0].n} rows`);
  console.log(`CALL sp_character_episodes('Kevin') returned ${proc.length} rows`);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
