// server.js
// Express REST API for the Ben 10 database.
//
// Run from the repo root (so db.js finds .env):
//   node server.js
// Then open http://localhost:3000/api in a browser for the list of endpoints.
//
// Routes:
//   /api/<resource>        CRUD for each main table (see routes/crud.js)
//   /api/reports/...       multi-table JOIN, VIEW, STORED PROCEDURE, INDEX demo
//                          (see routes/reports.js)

const express = require('express');
const models = require('./models');
const crud = require('./routes/crud');
const reports = require('./routes/reports');
const { errorHandler } = require('./routes/errors');

const { sequelize } = models;
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json());

// One CRUD router per table. `search` is the text column ?search= looks in,
// `include` is what GET /:id joins in so the answer is readable.
const RESOURCES = [
  {
    path: 'characters',
    model: models.Character,
    search: 'name',
    include: [
      { model: models.Species, attributes: ['species_id', 'name'] },
      { model: models.Episode, as: 'FirstEpisode', attributes: ['episode_id', 'title', 'air_date'] },
    ],
  },
  {
    path: 'aliens',
    model: models.AlienForm,
    search: 'name',
    include: [
      { model: models.Species, attributes: ['species_id', 'name'] },
      { model: models.Episode, as: 'FirstEpisode', attributes: ['episode_id', 'title', 'air_date'] },
      { model: models.Ability, attributes: ['ability_id', 'name'], through: { attributes: [] } },
    ],
  },
  {
    path: 'episodes',
    model: models.Episode,
    search: 'title',
    dateFilter: 'air_date', // ?from=YYYY-MM-DD&to=YYYY-MM-DD (uses idx_episode_air_date)
    include: [
      {
        model: models.Season,
        attributes: ['season_id', 'season_number'],
        include: [{ model: models.Series, attributes: ['series_id', 'title'] }],
      },
    ],
  },
  { path: 'series', model: models.Series, search: 'title' },
  {
    path: 'seasons',
    model: models.Season,
    include: [{ model: models.Series, attributes: ['series_id', 'title'] }],
  },
  {
    path: 'species',
    model: models.Species,
    search: 'name',
    include: [{ model: models.Location, as: 'Homeworld', attributes: ['location_id', 'name'] }],
  },
  { path: 'locations', model: models.Location, search: 'name' },
  { path: 'abilities', model: models.Ability, search: 'name' },
  {
    path: 'organizations',
    model: models.Organization,
    search: 'name',
    include: [{ model: models.Location, as: 'BaseLocation', attributes: ['location_id', 'name'] }],
  },
  {
    path: 'devices',
    model: models.Device,
    search: 'name',
    include: [{ model: models.Character, as: 'Owner', attributes: ['character_id', 'name'] }],
  },
  { path: 'voice-actors', model: models.VoiceActor, search: 'name' },
];

for (const r of RESOURCES) {
  app.use(`/api/${r.path}`, crud(r));
}
app.use('/api/reports', reports);

// Index page: lists every endpoint so you can click around in a browser.
app.get(['/', '/api'], (req, res) => {
  res.json({
    message: 'Ben 10 database API',
    crud: RESOURCES.map((r) => ({
      list: `GET /api/${r.path}?limit=20&offset=0${r.search ? '&search=...' : ''}${r.dateFilter ? '&from=YYYY-MM-DD&to=YYYY-MM-DD' : ''}`,
      one: `GET /api/${r.path}/:id`,
      create: `POST /api/${r.path}`,
      update: `PUT or PATCH /api/${r.path}/:id`,
      delete: `DELETE /api/${r.path}/:id`,
    })),
    reports: [
      'GET /api/reports/episode-aliens?series=2&season=1   (multi-table JOIN)',
      'GET /api/reports/alien-usage?limit=10                (reads the VIEW v_alien_usage)',
      'GET /api/reports/character-episodes?name=Kevin       (calls the STORED PROCEDURE sp_character_episodes)',
      'GET /api/reports/index-demo?from=2010-01-01&to=2010-12-31  (EXPLAIN shows idx_episode_air_date is used)',
      'GET /api/reports/constraints                         (lists the UNIQUE / CHECK / INDEX constraints)',
    ],
  });
});

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));
app.use(errorHandler); // turns constraint errors into readable JSON (routes/errors.js)

async function start() {
  await sequelize.authenticate();
  app.listen(PORT, () => {
    console.log(`Connected to MySQL database "${sequelize.config.database}"`);
    console.log(`API running at http://localhost:${PORT}/api`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Could not start the API:', err.message);
    process.exit(1);
  });
}

module.exports = app;
