const state = {
  meta: null,
  view: 'browse',
  resource: 'characters',
  search: '',
  from: '',
  to: '',
  offset: 0,
  limit: 20,
  total: 0,
};

const $ = (id) => document.getElementById(id);
const title = $('title');
const kicker = $('kicker');
const status = $('status');
const view = $('view');
const editor = $('editor');

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function labelize(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function currentResource() {
  return state.meta.resources.find((r) => r.path === state.resource) || state.meta.resources[0];
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.join(' ') : data.detail;
    const err = new Error([data.error, detail].filter(Boolean).join(': ') || res.statusText);
    err.body = data;
    throw err;
  }
  return data;
}

function setStatus(text) {
  status.textContent = text || '';
}

function banner(message) {
  return h('div', { class: 'banner', role: 'alert' }, message);
}

function cellText(value) {
  if (value == null || value === '') return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function dataTable(rows) {
  if (!rows.length) return h('p', { class: 'empty' }, 'No rows.');
  const keys = Object.keys(rows[0]);
  return h('div', { class: 'table-wrap' }, h('table', {}, [
    h('thead', {}, h('tr', {}, keys.map((key) => h('th', {}, labelize(key))))),
    h('tbody', {}, rows.map((row) => h('tr', {}, keys.map((key) => {
      const text = cellText(row[key]);
      return h('td', { title: text }, text);
    })))),
  ]));
}

function go(nextView, resource) {
  const path = nextView === 'browse'
    ? `#/browse/${resource || state.resource}`
    : `#/${nextView}`;
  if (location.hash !== path) location.hash = path;
  else render();
}

function readHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'ask' || hash === 'reports') return { view: hash };
  if (hash.startsWith('browse/')) {
    return { view: 'browse', resource: decodeURIComponent(hash.slice('browse/'.length)) };
  }
  return { view: 'browse', resource: state.resource || 'characters' };
}

function render() {
  const route = readHash();
  state.view = route.view;
  if (route.resource && state.meta.resources.some((r) => r.path === route.resource)) {
    if (route.resource !== state.resource) {
      state.resource = route.resource;
      state.offset = 0;
      state.search = '';
      state.from = '';
      state.to = '';
    }
  }
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === state.view);
  });
  view.replaceChildren();
  if (state.view === 'ask') renderAsk();
  else if (state.view === 'reports') renderReports();
  else renderBrowse();
}

function renderBrowse() {
  const resource = currentResource();
  kicker.textContent = 'Browse';
  title.textContent = resource.label;
  setStatus('');

  const search = resource.search
    ? h('label', {}, ['Search', h('input', {
      type: 'search',
      value: state.search,
      placeholder: labelize(resource.search),
      oninput: (e) => { state.search = e.target.value; },
    })])
    : null;
  const from = resource.dateFilter
    ? h('label', {}, ['From', h('input', { type: 'date', value: state.from, oninput: (e) => { state.from = e.target.value; } })])
    : null;
  const to = resource.dateFilter
    ? h('label', {}, ['To', h('input', { type: 'date', value: state.to, oninput: (e) => { state.to = e.target.value; } })])
    : null;

  const form = h('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); state.offset = 0; loadRows(); } }, [
    h('label', {}, ['Table', h('select', {
      onchange: (e) => go('browse', e.target.value),
    }, state.meta.resources.map((r) => h('option', {
      value: r.path,
      selected: r.path === resource.path,
    }, r.label)))]),
    search,
    from,
    to,
    h('button', { class: 'btn', type: 'submit' }, 'Apply'),
    h('button', { class: 'btn-ghost', type: 'button', onclick: () => openEditor(null) }, 'New row'),
  ]);
  view.append(form, h('div', { id: 'rows' }));
  loadRows();
}

async function loadRows() {
  const resource = currentResource();
  const slot = $('rows');
  if (!slot) return;
  slot.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset),
  });
  if (state.search) params.set('search', state.search);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  try {
    const data = await api(`/api/${resource.path}?${params}`);
    state.total = data.total;
    const page = Math.floor(state.offset / state.limit) + 1;
    const pages = Math.max(1, Math.ceil(data.total / state.limit));
    setStatus(`${data.total} ${data.total === 1 ? 'row' : 'rows'}`);
    const table = data.rows.length
      ? h('div', { class: 'table-wrap' }, h('table', {}, [
        h('thead', {}, h('tr', {}, [
          ...resource.columns.map((col) => h('th', {}, labelize(col.name))),
          h('th', {}, ''),
        ])),
        h('tbody', {}, data.rows.map((row) => h('tr', {}, [
          ...resource.columns.map((col) => {
            const text = cellText(row[col.name]);
            return h('td', { title: text }, text);
          }),
          h('td', {}, h('div', { class: 'row-actions' }, [
            h('button', { class: 'btn-ghost', type: 'button', onclick: () => openEditor(row) }, 'Edit'),
            h('button', { class: 'btn-danger', type: 'button', onclick: () => removeRow(row) }, 'Delete'),
          ])),
        ]))),
      ]))
      : h('p', { class: 'empty' }, 'No rows match.');
    slot.replaceChildren(
      table,
      h('div', { class: 'pager' }, [
        h('button', {
          class: 'btn-ghost',
          type: 'button',
          disabled: state.offset === 0,
          onclick: () => { state.offset = Math.max(0, state.offset - state.limit); loadRows(); },
        }, 'Previous'),
        h('span', { class: 'muted' }, `Page ${page} of ${pages}`),
        h('button', {
          class: 'btn-ghost',
          type: 'button',
          disabled: state.offset + state.limit >= data.total,
          onclick: () => { state.offset += state.limit; loadRows(); },
        }, 'Next'),
      ]),
    );
  } catch (err) {
    setStatus('');
    slot.replaceChildren(banner(err.message));
  }
}

function fieldInput(col, value) {
  const id = `f-${col.name}`;
  if (col.primaryKey) {
    return h('label', {}, [labelize(col.name), h('input', { id, value: value ?? '', disabled: true })]);
  }
  if (col.type === 'BOOLEAN') {
    const current = value == null ? '' : (value ? 'true' : 'false');
    return h('label', {}, [labelize(col.name), h('select', { id, name: col.name }, [
      h('option', { value: '', selected: current === '' }, 'Unknown'),
      h('option', { value: 'true', selected: current === 'true' }, 'Yes'),
      h('option', { value: 'false', selected: current === 'false' }, 'No'),
    ])]);
  }
  const numeric = /INT|DECIMAL|FLOAT|DOUBLE/.test(col.type);
  const date = col.type === 'DATEONLY' || col.type === 'DATE';
  return h('label', {}, [labelize(col.name), h('input', {
    id,
    name: col.name,
    type: date ? 'date' : numeric ? 'number' : 'text',
    value: value == null ? '' : (date ? String(value).slice(0, 10) : value),
    required: !col.allowNull,
    maxlength: col.maxLength || undefined,
  })]);
}

function readField(col, root) {
  if (col.primaryKey) return undefined;
  const input = root.querySelector(`[name="${col.name}"]`);
  if (!input) return undefined;
  if (col.type === 'BOOLEAN') {
    if (input.value === '') return null;
    return input.value === 'true';
  }
  if (input.value === '') return null;
  if (/INT|DECIMAL|FLOAT|DOUBLE/.test(col.type)) return Number(input.value);
  return input.value;
}

function openEditor(row) {
  const resource = currentResource();
  const creating = !row;
  editor.replaceChildren(
    h('form', { onsubmit: (e) => saveRow(e, row) }, [
      h('div', { class: 'editor-head' }, [
        h('p', { class: 'kicker' }, creating ? 'Create' : 'Update'),
        h('h3', { id: 'editor-title' }, creating ? 'Add a row' : 'Edit row'),
      ]),
      h('div', { class: 'editor-body' }, resource.columns
        .filter((col) => creating ? !col.autoIncrement : true)
        .map((col) => fieldInput(col, row ? row[col.name] : null))),
      h('div', { id: 'editor-error' }),
      h('div', { class: 'editor-actions' }, [
        h('button', { class: 'btn-ghost', type: 'button', onclick: () => editor.close() }, 'Cancel'),
        h('button', { class: 'btn', type: 'submit' }, creating ? 'Create' : 'Save'),
      ]),
    ]),
  );
  editor.showModal();
}

async function saveRow(event, existing) {
  event.preventDefault();
  const resource = currentResource();
  const body = {};
  for (const col of resource.columns) {
    const value = readField(col, event.target);
    if (value !== undefined) body[col.name] = value;
  }
  const errorSlot = $('editor-error');
  try {
    if (existing) {
      await api(`/api/${resource.path}/${existing[resource.primaryKey]}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setStatus('Row updated.');
    } else {
      await api(`/api/${resource.path}`, { method: 'POST', body: JSON.stringify(body) });
      setStatus('Row created.');
    }
    editor.close();
    loadRows();
  } catch (err) {
    errorSlot.replaceChildren(banner(err.message));
  }
}

async function removeRow(row) {
  const resource = currentResource();
  const id = row[resource.primaryKey];
  const cascade = resource.path === 'series' || resource.path === 'seasons'
    ? ' Seasons or episodes that belong to it will be deleted too.'
    : '';
  if (!window.confirm(`Delete ${resource.label} ${id}?${cascade}`)) return;
  try {
    await api(`/api/${resource.path}/${id}`, { method: 'DELETE' });
    setStatus(`Deleted ${id}.`);
    if (state.offset >= state.total - 1) state.offset = Math.max(0, state.offset - state.limit);
    loadRows();
  } catch (err) {
    setStatus('');
    const slot = $('rows');
    if (slot) slot.prepend(banner(err.message));
  }
}

function renderAsk() {
  kicker.textContent = 'Ask';
  title.textContent = 'Questions';
  setStatus('Answers come from a SELECT run on this database.');
  const examples = [
    'Which five alien forms have been used the most?',
    'Which episodes feature Vilgax?',
    'How many episodes are in each series?',
    'Who voices Ben Tennyson?',
  ];
  const input = h('textarea', { name: 'question', placeholder: 'Ask about the rows in this database' });
  const result = h('div', { id: 'ask-result' });
  view.append(
    h('p', { class: 'hint' }, 'Each question is turned into SQL, run against MySQL, and answered from those rows only.'),
    h('div', { class: 'chips' }, examples.map((q) => h('button', {
      class: 'chip',
      type: 'button',
      onclick: () => { input.value = q; ask(q, result); },
    }, q))),
    h('form', { class: 'ask-form', onsubmit: (e) => { e.preventDefault(); ask(input.value, result); } }, [
      h('label', { style: 'flex:1' }, ['Question', input]),
      h('button', { class: 'btn', type: 'submit', id: 'ask-btn' }, 'Ask'),
    ]),
    result,
  );
}

async function ask(question, result) {
  const btn = $('ask-btn');
  btn.disabled = true;
  result.replaceChildren(h('p', { class: 'muted' }, 'Writing a query and running it…'));
  try {
    const data = await api('/api/ask', { method: 'POST', body: JSON.stringify({ question }) });
    const parts = [
      h('article', { class: 'answer' }, [
        h('p', { class: 'kicker' }, data.sql ? 'From the query result' : 'No query'),
        h('p', {}, data.answer || 'No answer.'),
      ]),
    ];
    if (data.sql) parts.push(h('pre', { class: 'sql' }, data.sql));
    if (data.rows) parts.push(dataTable(data.rows));
    if (data.truncated) parts.push(h('p', { class: 'muted' }, 'Showing the first 50 rows.'));
    result.replaceChildren(...parts);
  } catch (err) {
    const parts = [banner(err.message)];
    if (err.body && err.body.sql) parts.push(h('pre', { class: 'sql' }, err.body.sql));
    result.replaceChildren(...parts);
  } finally {
    btn.disabled = false;
  }
}

function renderReports() {
  kicker.textContent = 'Reports';
  title.textContent = 'SQL features';
  setStatus('');
  view.append(h('div', { class: 'report-grid' }, [
    reportCard({
      title: 'Multi-table join',
      text: 'Aliens used in each episode. Joins series, season, episode, alien form, and species.',
      fields: [
        ['series', 'Series id', 'number', '2'],
        ['season', 'Season', 'number', '1'],
        ['alien', 'Alien', 'text', ''],
      ],
      path: (v) => `/api/reports/episode-aliens?series=${encodeURIComponent(v.series)}&season=${encodeURIComponent(v.season)}&alien=${encodeURIComponent(v.alien)}&limit=20`,
    }),
    reportCard({
      title: 'View',
      text: 'Reads v_alien_usage, the saved alien usage query.',
      fields: [
        ['min_power', 'Minimum power', 'number', '8'],
        ['species', 'Species', 'text', ''],
      ],
      path: (v) => `/api/reports/alien-usage?min_power=${encodeURIComponent(v.min_power)}&species=${encodeURIComponent(v.species)}&limit=15`,
    }),
    reportCard({
      title: 'Stored procedure',
      text: 'Calls sp_character_episodes for one character name.',
      fields: [['name', 'Character', 'text', 'Vilgax']],
      path: (v) => `/api/reports/character-episodes?name=${encodeURIComponent(v.name)}`,
    }),
    reportCard({
      title: 'Index',
      text: 'EXPLAIN for episodes in a date range. The plan should use idx_episode_air_date.',
      fields: [
        ['from', 'From', 'date', '2010-01-01'],
        ['to', 'To', 'date', '2010-12-31'],
      ],
      path: (v) => `/api/reports/index-demo?from=${encodeURIComponent(v.from)}&to=${encodeURIComponent(v.to)}`,
      render: (data, slot) => {
        slot.replaceChildren(
          h('p', {}, ['Index used: ', h('span', { class: 'index-used' }, data.index_used || 'none')]),
          dataTable(data.rows || []),
        );
      },
    }),
    reportCard({
      title: 'Constraints',
      text: 'UNIQUE and CHECK constraints, plus the indexes added for this project.',
      fields: [],
      path: () => '/api/reports/constraints',
      render: (data, slot) => {
        slot.replaceChildren(
          h('h3', {}, 'Constraints'),
          dataTable(data.constraints || []),
          h('h3', {}, 'Indexes'),
          dataTable(data.indexes || []),
        );
      },
    }),
  ]));
}

function reportCard({ title: heading, text, fields, path, render: draw }) {
  const inputs = {};
  const slot = h('div');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      slot.replaceChildren(h('p', { class: 'muted' }, 'Running…'));
      const values = {};
      for (const [name] of fields) values[name] = inputs[name].value;
      try {
        const data = await api(path(values));
        if (draw) draw(data, slot);
        else slot.replaceChildren(dataTable(data.rows || []));
      } catch (err) {
        slot.replaceChildren(banner(err.message));
      }
    },
  }, [
    ...fields.map(([name, label, type, value]) => {
      const input = h('input', { type, value, name });
      inputs[name] = input;
      return h('label', {}, [label, input]);
    }),
    h('button', { class: 'btn', type: 'submit' }, 'Run'),
  ]);
  return h('article', { class: 'report-card' }, [
    h('h3', {}, heading),
    h('p', {}, text),
    form,
    slot,
  ]);
}

editor.addEventListener('click', (e) => {
  if (e.target === editor) editor.close();
});
editor.addEventListener('close', () => editor.replaceChildren());

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => go(btn.dataset.view));
});

window.addEventListener('hashchange', render);

api('/api/meta').then((meta) => {
  state.meta = meta;
  if (!location.hash) location.hash = '#/browse/characters';
  else render();
}).catch((err) => {
  view.append(banner(err.message));
});
