// routes/ask.js
// Natural-language questions over the Ben 10 database.
//
// The model does not answer from memory. It writes one read-only SELECT,
// MySQL runs that query, and a second model call may only use those rows.

const express = require('express');
const { QueryTypes } = require('sequelize');
const models = require('../models');
const { wrap } = require('./errors');

const { sequelize } = models;
const router = express.Router();
const MAX_ROWS = 50;
const MAX_QUESTION = 500;

// Checked after string literals are removed, so a search for the word
// "update" or "use" inside a quoted name does not get blocked.
const BANNED = /\b(insert|update|delete|drop|alter|create|truncate|rename|grant|revoke|call|into|load_file|outfile|dumpfile|sleep|benchmark|information_schema|performance_schema)\b/i;

function schemaDocument() {
  const lines = [];
  for (const model of Object.values(models)) {
    if (!model || typeof model.getTableName !== 'function' || !model.rawAttributes) continue;
    const tableName = model.getTableName();
    const table = typeof tableName === 'string' ? tableName : tableName.tableName;
    const cols = Object.entries(model.rawAttributes).map(([name, attr]) => {
      const flags = [];
      if (attr.primaryKey) flags.push('primary key');
      if (attr.allowNull === false) flags.push('required');
      return `${name} ${attr.type.key}${flags.length ? ` (${flags.join(', ')})` : ''}`;
    });
    lines.push(`- ${table}: ${cols.join('; ')}`);
  }
  return lines.join('\n');
}

const SCHEMA_NOTES = `
Relationships:
- Season.series_id -> Series.series_id
- Episode.season_id -> Season.season_id
- Species.homeworld_id -> Location.location_id
- Organization.base_location_id -> Location.location_id
- Character.species_id -> Species.species_id
- Character.first_episode_id -> Episode.episode_id
- Alien_Form.species_id -> Species.species_id
- Alien_Form.first_episode_id -> Episode.episode_id
- Device.owner_character_id -> Character.character_id
- Episode_Alien_Form (episode_id, alien_form_id, times_used) links episodes to alien forms
- Episode_Location (episode_id, location_id) links episodes to locations
- Episode_Character (episode_id, character_id, role_type) links episodes to characters. role_type is Main, Antagonist, Supporting, Minor, or Other
- Alien_Form_Ability (alien_form_id, ability_id) links alien forms to abilities
- Character_Organization (character_id, org_id, rank, joined_season_id) links characters to organizations
- Character_Voice (character_id, actor_id, season_id) links a character to a voice actor in a season
- View v_alien_usage (alien_form_id, alien, species, power_level, first_episode, episodes_appeared, total_uses) is one row per alien form

Rules for names:
- Character is a reserved word. Always write it as \`Character\`.
- Alien_Form.power_level is an integer from 1 to 10.
- Match names with LIKE '%text%' because wiki titles include qualifiers such as "Ben Tennyson (Classic)".
`.trim();

function systemPrompt() {
  return `You translate questions about a Ben 10 MySQL database into one read-only SELECT.
Use only the tables and columns below. Do not answer from outside knowledge of the show.
If the question cannot be answered from these tables, set sql to null.

${schemaDocument()}

${SCHEMA_NOTES}

Return a JSON object and nothing else, in this shape:
{"sql":"SELECT ...","note":"short description of the query"}
or
{"sql":null,"note":"why this database cannot answer that"}

SQL rules:
- One SELECT (or WITH ... SELECT) only. No semicolon.
- No INSERT, UPDATE, DELETE, DDL, or CALL.
- Qualify ambiguous columns. With ONLY_FULL_GROUP_BY, every selected column is grouped or aggregated.
- Add ORDER BY when the question asks for a top, most, or latest list.
- Do not add a LIMIT above 50.`;
}

const ANSWER_SYSTEM = `You answer a question about a Ben 10 database.
Use only the SQL rows in the user message. Do not add names, dates, counts, or facts that are not in those rows.
If the row list is empty, say the database returned no matching rows.
If the list was truncated, say the answer uses the first rows returned, not the full table.
Write 2 to 4 plain sentences. Quote names exactly as they appear.`;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertReadOnly(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw httpError('The model did not return a SQL query.', 400);
  }
  if (sql.length > 4000) throw httpError('The query was too long to run.', 400);
  let text = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/#[^\n]*/g, ' ').trim();
  text = text.replace(/;+\s*$/g, '').trim();
  if (!/^(select|with)\b/i.test(text)) throw httpError('Only a read-only SELECT is allowed.', 400);
  const code = text.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:\\"|[^"])*"/g, '""');
  if (code.includes(';')) throw httpError('Only a single SELECT statement is allowed.', 400);
  if (BANNED.test(code)) throw httpError('That query is not read-only, so it was not run.', 400);
  return text;
}

function parseModelJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) throw httpError('The model did not return a query.', 502);
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw httpError('The model did not return a query.', 502);
  }
}

async function chat(messages) {
  const key = process.env.LLM_API_KEY;
  if (!key) {
    throw httpError('Set LLM_API_KEY in .env before asking questions. Browsing and editing still work without it.', 503);
  }
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, temperature: 0, messages }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    throw httpError(`Could not reach the language model (${err.message}).`, 502);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.error && body.error.message ? body.error.message : `status ${res.status}`;
    throw httpError(`Language model request failed: ${detail}`, 502);
  }
  return (body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content) || '';
}

router.post('/', wrap(async (req, res) => {
  const question = String((req.body && req.body.question) || '').trim();
  if (!question) return res.status(400).json({ error: 'Type a question first.' });
  if (question.length > MAX_QUESTION) {
    return res.status(400).json({ error: `Keep the question under ${MAX_QUESTION} characters.` });
  }

  const plan = parseModelJson(await chat([
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: question },
  ]));

  if (!plan.sql) {
    return res.json({
      answer: plan.note || 'That question cannot be answered from this database.',
      sql: null,
      rows: [],
      rowCount: 0,
      truncated: false,
    });
  }

  const sql = assertReadOnly(plan.sql);
  let rows;
  try {
    rows = await sequelize.query(
      `SELECT * FROM (${sql}) AS ask_result LIMIT ${MAX_ROWS}`,
      { type: QueryTypes.SELECT }
    );
  } catch (err) {
    return res.status(400).json({
      error: (err.original && err.original.sqlMessage) || err.message,
      sql,
      rows: [],
    });
  }

  const preview = JSON.stringify(rows).slice(0, 12000);
  let answer;
  try {
    answer = (await chat([
      { role: 'system', content: ANSWER_SYSTEM },
      {
        role: 'user',
        content: `Question: ${question}\n\nSQL:\n${sql}\n\nRows returned: ${rows.length}${rows.length === MAX_ROWS ? ' (truncated to 50)' : ''}\n${preview}`,
      },
    ])).trim();
  } catch {
    answer = 'The query ran, but the summary step failed. The rows below are the database result.';
  }

  res.json({
    answer,
    sql,
    rows,
    rowCount: rows.length,
    truncated: rows.length === MAX_ROWS,
  });
}));

router.assertReadOnly = assertReadOnly;
module.exports = router;
