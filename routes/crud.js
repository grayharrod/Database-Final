// routes/crud.js
// Builds the five CRUD endpoints for one Sequelize model:
//
//   GET    /            list rows   ?limit=20&offset=0&search=text&from=&to=
//   GET    /:id         one row, with its related rows joined in
//   POST   /            create a row from the JSON body
//   PUT    /:id         update the columns given in the JSON body (PATCH works too)
//   DELETE /:id         delete the row
//
// All SQL is written by Sequelize (the ORM), using the models in models/index.js.

const express = require('express');
const { Op } = require('sequelize');
const { wrap } = require('./errors');

module.exports = function crud({ model, search, include = [], dateFilter }) {
  const router = express.Router();
  const pk = model.primaryKeyAttribute; // e.g. character_id
  const columns = Object.keys(model.rawAttributes).filter((c) => c !== pk);

  // only keep body fields that are real columns (and never the primary key)
  const pick = (body) => {
    const out = {};
    for (const c of columns) if (body && body[c] !== undefined) out[c] = body[c];
    return out;
  };

  const badId = (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
      res.status(400).json({ error: `${pk} must be a whole number` });
      return true;
    }
    return false;
  };

  // READ (list)
  router.get('/', wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 500);
    const offset = Number(req.query.offset) || 0;
    const where = {};
    if (search && req.query.search) where[search] = { [Op.like]: `%${req.query.search}%` };
    if (dateFilter && (req.query.from || req.query.to)) {
      where[dateFilter] = {};
      if (req.query.from) where[dateFilter][Op.gte] = req.query.from;
      if (req.query.to) where[dateFilter][Op.lte] = req.query.to;
    }
    const { count, rows } = await model.findAndCountAll({
      where,
      limit,
      offset,
      order: [[dateFilter || pk, 'ASC']],
    });
    res.json({ total: count, limit, offset, rows });
  }));

  // READ (one)
  router.get('/:id', wrap(async (req, res) => {
    if (badId(req, res)) return;
    const row = await model.findByPk(req.params.id, { include });
    if (!row) return res.status(404).json({ error: `No ${model.name} with ${pk} ${req.params.id}` });
    res.json(row);
  }));

  // CREATE
  router.post('/', wrap(async (req, res) => {
    const row = await model.create(pick(req.body));
    res.status(201).json(row);
  }));

  // UPDATE
  const update = wrap(async (req, res) => {
    if (badId(req, res)) return;
    const changes = pick(req.body);
    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: `Send at least one of: ${columns.join(', ')}` });
    }
    const row = await model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: `No ${model.name} with ${pk} ${req.params.id}` });
    const before = row.toJSON();
    await row.update(changes); // runs: UPDATE <table> SET ... WHERE <pk> = :id
    res.json({ before, after: row.toJSON() });
  });
  router.put('/:id', update);
  router.patch('/:id', update);

  // DELETE
  router.delete('/:id', wrap(async (req, res) => {
    if (badId(req, res)) return;
    const row = await model.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: `No ${model.name} with ${pk} ${req.params.id}` });
    await row.destroy();
    res.json({ deleted: row.toJSON() });
  }));

  return router;
};
