import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, buildStatus, componentState, dayKey, daysBetween, overallState, previousDaily } from '../scripts/lib.mjs';

const config = {
  title: 'Estado', brand: 'CV', website: 'https://www.example.com', timezone: 'America/Bogota',
  historyDays: 5, incidentDays: 30,
  components: [
    { id: 'tienda', name: 'Tienda online', description: 'd', monitors: ['1'] },
    { id: 'formularios', name: 'Formularios', monitors: ['2', '3'] },
    { id: 'wishlist', name: 'Lista de deseos', monitors: ['4', '3'] },
  ],
};
const now = new Date('2026-11-09T03:00:00Z'); // 8 nov 22:00 en Bogotá

test('dayKey usa la zona del equipo, no UTC', () => {
  assert.equal(dayKey(now, 'America/Bogota'), '2026-11-08');
  assert.equal(dayKey(now, 'UTC'), '2026-11-09');
});

test('addDays y daysBetween cruzan meses', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(daysBetween('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('componentState: el peor gana; pausados y pendientes no cuentan', () => {
  assert.equal(componentState(['up', 'up']), 'operational');
  assert.equal(componentState(['up', 'down']), 'down');
  assert.equal(componentState(['up', 'validating']), 'recovering');
  assert.equal(componentState(['up', 'maintenance']), 'maintenance');
  assert.equal(componentState(['up', 'paused']), 'operational');
  assert.equal(componentState(['paused', 'pending']), 'unknown');
});

test('overallState distingue caída parcial de total', () => {
  assert.equal(overallState(['operational', 'operational']), 'operational');
  assert.equal(overallState(['operational', 'down']), 'partial_outage');
  assert.equal(overallState(['down', 'down', 'unknown']), 'major_outage');
  assert.equal(overallState(['operational', 'recovering']), 'recovering');
  assert.equal(overallState(['unknown']), 'unknown');
});

test('buildStatus: histórico por componente = peor monitor del día; antes de crearse, sin datos', () => {
  const monitors = {
    1: { status: 'up', createdDay: '2026-11-07' },
    2: { status: 'up', createdDay: '2026-11-07' },
    3: { status: 'down', createdDay: '2026-11-07' },
    4: { status: 'up', createdDay: '2026-11-07' },
  };
  const daily = {
    1: { '2026-11-07': 100, '2026-11-08': 100 },
    2: { '2026-11-07': 100, '2026-11-08': 99.5 },
    3: { '2026-11-07': 98, '2026-11-08': 100 },
    4: { '2026-11-07': 100, '2026-11-08': 100 },
  };
  const totals = { 1: 100, 2: 99.7, 3: 99, 4: 100 };
  const s = buildStatus({ config, monitors, daily, totals, incidents: [], now });

  assert.equal(s.overall, 'partial_outage');
  const [tienda, form, wish] = s.components;
  assert.equal(tienda.state, 'operational');
  assert.equal(form.state, 'down');
  assert.equal(wish.state, 'down', 'el monitor 3 es compartido');
  assert.deepEqual(form.history.map((h) => h.day), ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.deepEqual(form.history.map((h) => h.availability), [null, null, null, 98, 99.5]);
  assert.equal(form.availability, 99);
  assert.equal(tienda.availability, 100);
});

test('buildStatus: incidentes públicos sin causas ni URLs, agrupados y del más nuevo al más viejo', () => {
  const monitors = Object.fromEntries(['1', '2', '3', '4'].map((id) => [id, { status: 'up', createdDay: '2026-11-01' }]));
  const incidents = [
    { monitorId: '3', startedAt: '2026-11-08T10:00:00Z', resolvedAt: '2026-11-08T10:12:00Z' },
    { monitorId: '1', startedAt: '2026-11-07T09:00:00Z', resolvedAt: null },
    { monitorId: '99', startedAt: '2026-11-07T08:00:00Z', resolvedAt: null },
  ];
  const s = buildStatus({ config, monitors, daily: {}, totals: {}, incidents, now });
  assert.deepEqual(s.incidents, [
    { startedAt: '2026-11-08T10:00:00Z', resolvedAt: '2026-11-08T10:12:00Z', durationSeconds: 720, components: ['Formularios', 'Lista de deseos'] },
    { startedAt: '2026-11-07T09:00:00Z', resolvedAt: null, durationSeconds: null, components: ['Tienda online'] },
  ]);
  assert.doesNotMatch(JSON.stringify(s), /http(?!s:\/\/www\.example\.com)/);
});

test('previousDaily ignora basura del JSON anterior', () => {
  assert.deepEqual(previousDaily(null), {});
  assert.deepEqual(previousDaily({ _daily: { 1: { '2026-11-07': 100, malo: 1, '2026-11-08': 'x' }, x: {} } }), { 1: { '2026-11-07': 100 } });
});
