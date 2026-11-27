// routes/reports.js
// The endpoints that show off the SQL features the assignment asks for.
// These use plain SQL (through Sequelize's query()) so you can read exactly
// what runs. `Character` is a reserved word in MySQL, so it is in backticks.
//
//   GET /api/reports/episode-aliens       multi-table JOIN (6 tables)
//   GET /api/reports/alien-usage          SELECT from the VIEW v_alien_usage
//   GET /api/reports/character-episodes   CALL the STORED PROCEDURE sp_character_episodes
//   GET /api/reports/index-demo           EXPLAIN a query that uses idx_episode_air_date
//   GET /api/reports/constraints          list the UNIQUE / CHECK / INDEX constraints

const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const { wrap } = require('./errors');

const router = express.Router();
const select = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const int = (v, dflt) => (v === undefined || v === '' ? dflt : Number.parseInt(v, 10));

// ---------------------------------------------------------------------------
// Multi-table JOIN: which aliens Ben used in each episode of a season.
// Series -> Season -> Episode -> Episode_Alien_Form -> Alien_Form -> Species
//   ?series=2&season=1   (series_id and season_number; both optional)
//   ?alien=Heatblast     (optional, part of an alien name)
// ---------------------------------------------------------------------------
router.get('/episode-aliens', wrap(async (req, res) => {
  const series = int(req.query.series, null);
  const season = int(req.query.season, null);
  const alien = req.query.alien || null;
  const limit = Math.min(int(req.query.limit, 100), 1000);

  const sql = `
    SELECT  sr.title          AS series,
            sn.season_number  AS season,
            e.episode_number,
            e.title           AS episode,
            e.air_date,
            af.name           AS alien,
            sp.name           AS species,
            eaf.times_used
      FROM  Series sr
      JOIN  Season sn              ON sn.series_id     = sr.series_id
      JOIN  Episode e              ON e.season_id      = sn.season_id
      JOIN  Episode_Alien_Form eaf ON eaf.episode_id   = e.episode_id
      JOIN  Alien_Form af          ON af.alien_form_id = eaf.alien_form_id
 LEFT JOIN  Species sp             ON sp.species_id    = af.species_id
     WHERE  (:series IS NULL OR sr.series_id     = :series)
       AND  (:season IS NULL OR sn.season_number = :season)
       AND  (:alien  IS NULL OR af.name LIKE CONCAT('%', :alien, '%'))
  ORDER BY  sr.series_id, sn.season_number, e.episode_number, af.name
     LIMIT  :limit`;
  const rows = await select(sql, { series, season, alien, limit });
  res.json({ count: rows.length, rows });
}));

// ---------------------------------------------------------------------------
// VIEW: v_alien_usage (created by scripts/setup_sql.js from sql/view_and_procedure.sql)
// One row per alien: species, power level, episodes it appears in, total uses.
//   ?limit=10  ?species=Pyronite  ?min_power=8
// ---------------------------------------------------------------------------
router.get('/alien-usage', wrap(async (req, res) => {
  const limit = Math.min(int(req.query.limit, 20), 500);
  const species = req.query.species || null;
  const minPower = int(req.query.min_power, null);
  const rows = await select(
    `SELECT *
       FROM v_alien_usage
      WHERE (:species  IS NULL OR species LIKE CONCAT('%', :species, '%'))
        AND (:minPower IS NULL OR power_level >= :minPower)
   ORDER BY total_uses DESC, alien
      LIMIT :limit`,
    { species, minPower, limit }
  );
  res.json({ view: 'v_alien_usage', count: rows.length, rows });
}));

// ---------------------------------------------------------------------------
// STORED PROCEDURE: sp_character_episodes(name)
// Every episode a character appears in, with series, season and role.
//   ?name=Kevin
// ---------------------------------------------------------------------------
router.get('/character-episodes', wrap(async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Add ?name=, for example ?name=Kevin' });
  // For CALL, Sequelize returns the procedure's result set as an array of rows.
  const rows = await sequelize.query('CALL sp_character_episodes(:name)', { replacements: { name } });
  res.json({ procedure: 'sp_character_episodes', name, count: rows.length, rows });
}));

// ---------------------------------------------------------------------------
// INDEX demo: EXPLAIN shows MySQL using idx_episode_air_date for a date range.
//   ?from=2010-01-01&to=2010-12-31
// ---------------------------------------------------------------------------
router.get('/index-demo', wrap(async (req, res) => {
  const from = req.query.from || '2010-01-01';
  const to = req.query.to || '2010-12-31';
  const sql = 'SELECT episode_id, title, air_date FROM Episode WHERE air_date BETWEEN :from AND :to ORDER BY air_date';
  const plan = await select(`EXPLAIN ${sql}`, { from, to });
  const rows = await select(sql, { from, to });
  res.json({
    query: sql.replace(':from', `'${from}'`).replace(':to', `'${to}'`),
    index_used: plan[0] && plan[0].key,
    explain: plan,
    count: rows.length,
    rows,
  });
}));

// ---------------------------------------------------------------------------
// Lists the constraints and indexes on the database (from information_schema)
// ---------------------------------------------------------------------------
router.get('/constraints', wrap(async (req, res) => {
  const db = sequelize.config.database;
  const constraints = await select(
    `SELECT tc.TABLE_NAME AS table_name, tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS type,
            cc.CHECK_CLAUSE AS check_clause
       FROM information_schema.TABLE_CONSTRAINTS tc
  LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
         ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA = :db AND tc.CONSTRAINT_TYPE IN ('UNIQUE', 'CHECK')
   ORDER BY tc.CONSTRAINT_TYPE, tc.TABLE_NAME`,
    { db }
  );
  const indexes = await select(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS name,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = :db AND INDEX_NAME LIKE 'idx\\_%'
   GROUP BY TABLE_NAME, INDEX_NAME`,
    { db }
  );
  res.json({ constraints, indexes });
}));

module.exports = router;
