import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addDays, dayKey, daysBetween } from '../scripts/lib.mjs';

const root = new URL('..', import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const ids = [...new Set(config.components.flatMap((c) => c.monitors))];

/** Respuestas falsas de la API para "hoy", con monitores creados hace 3 días. */
function fixture({ previous } = {}) {
  const today = dayKey(new Date(), config.timezone);
  const created = addDays(today, -3);
  const f = {
    '/api/v2/monitors?per_page=250': {
      data: [
        ...ids.map((id) => ({ id, attributes: { status: id === '5201150' ? 'down' : 'up', created_at: `${created}T15:00:00Z` } })),
        { id: '1', attributes: { status: 'down', created_at: '2026-01-01T00:00:00Z' } }, // otro proyecto: se ignora
      ],
      pagination: { next: null },
    },
    [`/api/v3/incidents?from=${addDays(today, -config.incidentDays)}&to=${today}&per_page=50`]: {
      data: [
        { attributes: { started_at: `${today}T12:00:00Z`, resolved_at: null }, relationships: { monitor: { data: { id: '5201150' } } } },
        { attributes: { started_at: `${today}T11:00:00Z`, resolved_at: null }, relationships: { monitor: { data: { id: '1' } } } },
      ],
      pagination: { next: null },
    },
    previous,
  };
  for (const id of ids) {
    for (const d of daysBetween(created, today)) f[`/api/v2/monitors/${id}/sla?from=${d}&to=${d}`] = { data: { attributes: { availability: d === today && id === '5201150' ? 97.5 : 100 } } };
    f[`/api/v2/monitors/${id}/sla?from=${created}&to=${today}`] = { data: { attributes: { availability: id === '5201150' ? 99.4 : 100 } } };
  }
  return { f, today, created };
}

function run(f) {
  const dir = mkdtempSync(join(tmpdir(), 'cvstatus-'));
  const file = join(dir, 'fixture.json');
  writeFileSync(file, JSON.stringify(f));
  const out = execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, env: { ...process.env, FIXTURE: file, CUSTOM_DOMAIN: 'status.example.com' }, encoding: 'utf8' });
  return { out, status: JSON.parse(readFileSync(join(root, 'dist/status.json'), 'utf8')) };
}

test('build: genera dist/ con estado, histórico e incidentes solo de los monitores del config', () => {
  const { f, today, created } = fixture();
  const { status, out } = run(f);
  assert.equal(status.overall, 'partial_outage');
  const form = status.components.find((c) => c.id === 'formularios');
  assert.equal(form.state, 'down');
  assert.equal(form.availability, 99.4);
  assert.equal(form.history.length, config.historyDays);
  assert.equal(form.history.at(-1).day, today);
  assert.equal(form.history.at(-1).availability, 97.5);
  assert.equal(form.history.find((h) => h.day === addDays(created, -1)).availability, null);
  assert.equal(status.components.find((c) => c.id === 'tienda').state, 'operational');
  assert.equal(status.incidents.length, 1);
  assert.deepEqual(status.incidents[0].components, ['Formularios']);
  assert.equal(readFileSync(join(root, 'dist/CNAME'), 'utf8'), 'status.example.com\n');
  assert.match(readFileSync(join(root, 'dist/index.html'), 'utf8'), /status\.json/);
  assert.match(out, /^ok: partial_outage, 5 monitores, 1 incidentes, \d+ llamadas/);
});

test('build: reutiliza el histórico anterior y solo vuelve a pedir hoy y ayer', () => {
  const { f, today, created } = fixture();
  const first = run(f).status;
  // Sin las respuestas de días viejos: si el build las pidiera, el fixture fallaría.
  const { f: g } = fixture({ previous: first });
  for (const id of ids) for (const d of daysBetween(created, addDays(today, -2))) delete g[`/api/v2/monitors/${id}/sla?from=${d}&to=${d}`];
  const { out, status } = run(g);
  const calls = Number(/(\d+) llamadas/.exec(out)[1]);
  assert.equal(calls, 1 + ids.length * 2 + ids.length + 1, 'monitores + hoy/ayer + totales + incidentes');
  assert.deepEqual(status.components.map((c) => c.history), first.components.map((c) => c.history));
});
