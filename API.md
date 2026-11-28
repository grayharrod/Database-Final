# Ben 10 API: how to run it and what to demo

This is a small web server (Express) that sits on top of the MySQL database.
Other programs (or a browser, or PowerShell) send it HTTP requests like
`GET /api/aliens/1`, and it answers with JSON. Inside, it uses Grayson's
Sequelize models (`models/index.js`) to talk to MySQL, so we write very little SQL by hand.

None of Grayson's files are changed. The new files are:

| File | What it is |
|---|---|
| `server.js` | Starts the API on http://localhost:3000 and lists which tables get endpoints |
| `routes/crud.js` | Create / Read / Update / Delete endpoints, built once and reused for every table |
| `routes/reports.js` | The JOIN, VIEW, STORED PROCEDURE and INDEX endpoints (plain SQL you can read) |
| `routes/errors.js` | Turns a broken constraint into a clear JSON message instead of a crash |
| `sql/view_and_procedure.sql` | `CREATE VIEW v_alien_usage` and `CREATE PROCEDURE sp_character_episodes` |
| `scripts/setup_sql.js` | Runs that .sql file for you |
| `public/` | GUI: browse and edit every main table, ask a question, run the SQL demos |
| `routes/ask.js` | Turns a question into one SELECT, runs it, and answers from those rows |

`package.json` gets one new dependency (`express`) and one new script (`npm run api`).

Open http://localhost:3000 after `npm run api`. Browse is the CRUD screen. Ask needs `LLM_API_KEY` in `.env` (see `.env.example`); it writes a SELECT, runs it on this database, and answers from the rows. Reports runs the join, view, stored procedure, index, and constraint demos in the same window.

---

## 1. Run it (Windows PowerShell)

You already did `sync.js` and `seed.js`, so the database has its 14,076 rows.
Open PowerShell in the project folder:

```powershell
cd "C:\Users\jpfre\OneDrive\Documentos\Database\Database-Final"
npm install                    # picks up express (only needed once)
node scripts/setup_sql.js      # creates the VIEW and the STORED PROCEDURE (only needed once)
npm run api                    # starts the API; leave this window open
```

You should see:

```
Connected to MySQL database "ben10"
API running at http://localhost:3000/api
```

Open http://localhost:3000/api in a browser. It lists every endpoint. Any `GET`
link can be pasted straight into the browser, for example
http://localhost:3000/api/aliens/1.

To stop the server, press `Ctrl+C` in that window.

### A helper for PowerShell

Open a **second** PowerShell window (the first one is busy running the server)
and paste this once. It sends a request and prints the answer, including error
messages:

```powershell
function api($method, $path, $body) {
  $p = @{ Method = $method; Uri = "http://localhost:3000$path"; ContentType = 'application/json' }
  if ($body) { $p.Body = ($body | ConvertTo-Json) }
  try   { Invoke-RestMethod @p | ConvertTo-Json -Depth 6 }
  catch { "HTTP $([int]$_.Exception.Response.StatusCode): $($_.ErrorDetails.Message)" }
}
```

Now `api GET /api/aliens/1` shows alien 1.

---

## 2. The demo, step by step

The assignment asks you to show a constraint, an index, a join, a view, a
stored procedure and an UPDATE. Run these in order.

### a) CRUD (Create, Read, Update, Delete)

Every main table has the same five endpoints: `characters`, `aliens`,
`episodes`, `series`, `seasons`, `species`, `locations`, `abilities`,
`organizations`, `devices`, `voice-actors`.

```powershell
api GET  "/api/characters?search=Kevin&limit=3"          # READ a list (search by name)
api GET  /api/characters/1                               # READ one, with its species and first episode joined in
api POST /api/characters @{ name = "Demo Hero"; species_id = 1; gender = "Female"; is_human = $true }   # CREATE
```

The POST answer shows the new row's `character_id` (909 on a fresh load). Use it below:

```powershell
api PUT    /api/characters/909 @{ gender = "Male" }      # UPDATE (shows before and after)
api DELETE /api/characters/909                           # DELETE
api GET    /api/characters/909                           # now 404: it's gone
```

Under the hood Sequelize writes the SQL: `INSERT INTO \`Character\` ...`,
`UPDATE \`Character\` SET gender = 'Male' WHERE character_id = 909`, and so on.

### b) UPDATE

```powershell
api GET   /api/aliens/1                                  # Goop, power_level 10
api PATCH /api/aliens/1 @{ power_level = 9 }             # UPDATE: answer shows before = 10, after = 9
api PATCH /api/aliens/1 @{ power_level = 10 }            # put it back
```

### c) Constraints (UNIQUE, CHECK, NOT NULL, FOREIGN KEY)

Each of these is **supposed to fail**. The point is that MySQL refuses bad data.

```powershell
api GET   /api/reports/constraints                       # lists every UNIQUE and CHECK constraint and our indexes

api PATCH /api/aliens/1 @{ power_level = 11 }            # CHECK:  power_level must be 1 to 10   -> HTTP 400
api POST  /api/characters @{ name = "Ben Tennyson (Classic)" }   # UNIQUE: that name exists already -> HTTP 409
api POST  /api/characters @{ gender = "Male" }           # NOT NULL: a character needs a name      -> HTTP 400
api POST  /api/characters @{ name = "Nobody"; species_id = 99999 }  # FOREIGN KEY: no such species -> HTTP 409
```

### d) INDEX

`sync.js` created the index `idx_episode_air_date` on `Episode(air_date)`.
This endpoint runs a date-range query and also runs `EXPLAIN` on it, which is
MySQL telling you how it plans to find the rows:

```powershell
api GET "/api/reports/index-demo?from=2010-01-01&to=2010-12-31"
```

Look for `"index_used": "idx_episode_air_date"` and `"type": "range"`. That
means MySQL jumped straight to the 2010 episodes using the index instead of
reading all 393 episodes. The same index makes this normal list fast:
`api GET "/api/episodes?from=2010-01-01&to=2010-12-31"`.

### e) Multi-table JOIN

Which aliens Ben used in each episode of a season. This joins **6 tables**:
Series, Season, Episode, Episode_Alien_Form, Alien_Form and Species.

```powershell
api GET "/api/reports/episode-aliens?series=2&season=1&limit=10"   # Alien Force, season 1
api GET "/api/reports/episode-aliens?alien=Heatblast&limit=10"     # every episode with Heatblast
```

The SQL is at the top of `routes/reports.js`. Series ids: 1 = Ben 10 (2005),
2 = Alien Force, 3 = Ultimate Alien, 4 = Omniverse, 5 = Ben 10 (2016).

### f) VIEW

`v_alien_usage` is a saved query: one row per alien with its species, power
level, first episode, number of episodes it appears in and total times used.
You query it like a table.

```powershell
api GET "/api/reports/alien-usage?limit=10"              # most-used aliens
api GET "/api/reports/alien-usage?min_power=9&limit=5"   # strongest aliens only
```

Nice demo: do the UPDATE from step b, then call the view again. The view
shows the new `power_level` right away, because a view is not a copy of the
data, just a stored SELECT.

### g) STORED PROCEDURE

`sp_character_episodes(name)` is a program saved inside MySQL. Give it a name
(or part of one) and it returns every episode that character is in, with
series, season, air date and role.

```powershell
api GET "/api/reports/character-episodes?name=Kevin%20Levin"
api GET "/api/reports/character-episodes?name=Vilgax"
```

The endpoint just runs `CALL sp_character_episodes('Kevin Levin')`.

---

## 3. Showing the same things in MySQL Workbench

If you'd rather show raw SQL during the presentation, these do the same thing:

```sql
USE ben10;
SELECT * FROM v_alien_usage ORDER BY total_uses DESC LIMIT 10;   -- VIEW
CALL sp_character_episodes('Kevin Levin');                        -- STORED PROCEDURE
EXPLAIN SELECT * FROM Episode WHERE air_date BETWEEN '2010-01-01' AND '2010-12-31';  -- INDEX
UPDATE Alien_Form SET power_level = 11 WHERE alien_form_id = 1;   -- CHECK fails
UPDATE Alien_Form SET power_level = 9  WHERE alien_form_id = 1;   -- UPDATE works
```

---

## 4. Good to know

* **Only DELETE rows you just created.** Some foreign keys in the models are
  `ON DELETE CASCADE`. For example, deleting a species also deletes every
  character of that species. If you do delete something by accident, run
  `node scripts/seed.js` to reload everything (then `node scripts/setup_sql.js`
  is not needed again; the view and procedure stay).
* `PUT` and `PATCH` do the same thing here: they change only the columns you send.
* Lists return 20 rows by default. Add `?limit=100&offset=100` to page through.
* `Character` is a reserved word in MySQL, so raw SQL writes it as `` `Character` ``.
* If `npm run api` says it can't connect, MySQL isn't running or the password
  in `.env` is wrong. If it says port 3000 is in use, an old server window is
  still open; close it, or run `$env:PORT=3001; npm run api`.
