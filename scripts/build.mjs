// Genera dist/ (página + status.json) con datos de la API de Better Stack Uptime.
//
//   BETTERSTACK_TOKEN=... PUBLIC_URL=https://status.carminavillegas.com node scripts/build.mjs
//
// - BETTERSTACK_TOKEN: token de solo lectura del equipo (secreto del repo en GitHub).
// - PUBLIC_URL: dónde está publicada la página; de ahí se lee el status.json anterior para
//   reutilizar el histórico y pedir a la API solo hoy y ayer. Si no existe, recalcula todo.
// - CUSTOM_DOMAIN (opcional): escribe dist/CNAME para GitHub Pages.
// - FIXTURE (opcional, para pruebas locales): ruta a un JSON con respuestas falsas de la API.
//
// Si la API falla, termina con error y no se publica nada: queda la versión anterior y la
// página avisa que los datos están desactualizados.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { buildStatus, dayKey, addDays, daysBetween, previousDaily } from './lib.mjs';

const API = 'https://incidents.betterstack.com';
const root = new URL('..', import.meta.url);
const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
const now = new Date();
const today = dayKey(now, config.timezone);
const yesterday = addDays(today, -1);
const firstDay = addDays(today, -(config.historyDays - 1));

const fixture = process.env.FIXTURE ? JSON.parse(await readFile(process.env.FIXTURE, 'utf8')) : null;
const token = process.env.BETTERSTACK_TOKEN;
if (!fixture && !token) {
  console.error('Falta BETTERSTACK_TOKEN');
  process.exit(1);
}

let calls = 0;
async function api(pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  calls++;
  if (fixture) {
    const u = new URL(url);
    const key = `${u.pathname}${u.search}`;
    if (!(key in fixture)) throw new Error(`fixture sin respuesta para ${key}`);
    return fixture[key];
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return res.json();
    const retry = (res.status === 429 || res.status >= 500) && attempt < 3;
    if (!retry) throw new Error(`Better Stack ${res.status} en ${new URL(url).pathname}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

async function paginate(path) {
  const out = [];
  for (let next = path; next; ) {
    const page = await api(next);
    out.push(...page.data);
    next = page.pagination?.next ?? null;
  }
  return out;
}

async function sla(id, from, to) {
  const r = await api(`/api/v2/monitors/${id}/sla?from=${from}&to=${to}`);
  const v = r?.data?.attributes?.availability;
  return typeof v === 'number' ? v : null;
}

async function previousStatus() {
  if (fixture) return fixture.previous ?? null;
  const base = process.env.PUBLIC_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/status.json?t=${Date.now()}`, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// 1. Monitores del config.
const wanted = new Set(config.components.flatMap((c) => c.monitors));
const all = await paginate('/api/v2/monitors?per_page=250');
const monitors = {};
for (const m of all) {
  if (!wanted.has(String(m.id))) continue;
  monitors[String(m.id)] = {
    status: m.attributes.status,
    createdDay: dayKey(new Date(m.attributes.created_at), config.timezone),
  };
}
const missing = [...wanted].filter((id) => !monitors[id]);
if (missing.length) throw new Error(`Monitores del config que no existen en Better Stack: ${missing.join(', ')}`);

// 2. Disponibilidad diaria: se reutiliza lo anterior y se piden solo los días que faltan,
//    más hoy y ayer (ayer cambia hasta que termina el día en la zona del equipo).
const prevDaily = previousDaily(await previousStatus());
const daily = {};
for (const id of wanted) {
  const start = monitors[id].createdDay > firstDay ? monitors[id].createdDay : firstDay;
  daily[id] = {};
  for (const day of daysBetween(start, today)) {
    const known = prevDaily[id]?.[day];
    daily[id][day] = known !== undefined && day < yesterday ? known : await sla(id, day, day);
  }
}

// 3. Disponibilidad del periodo completo (lo que se muestra como "% disponible").
const totals = {};
for (const id of wanted) {
  const start = monitors[id].createdDay > firstDay ? monitors[id].createdDay : firstDay;
  totals[id] = await sla(id, start, today);
}

// 4. Incidentes recientes de esos monitores.
const rawIncidents = await paginate(`/api/v3/incidents?from=${addDays(today, -config.incidentDays)}&to=${today}&per_page=50`);
const incidents = rawIncidents
  .map((i) => ({
    monitorId: String(i.relationships?.monitor?.data?.id ?? ''),
    startedAt: i.attributes.started_at,
    resolvedAt: i.attributes.resolved_at,
  }))
  .filter((i) => wanted.has(i.monitorId));

const status = { ...buildStatus({ config, monitors, daily, totals, incidents, now }), _daily: daily };

// 5. dist/
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(new URL('site/', root), dist, { recursive: true });
await writeFile(new URL('status.json', dist), JSON.stringify(status));
if (process.env.CUSTOM_DOMAIN) await writeFile(new URL('CNAME', dist), `${process.env.CUSTOM_DOMAIN}\n`);
console.log(`ok: ${status.overall}, ${Object.keys(monitors).length} monitores, ${incidents.length} incidentes, ${calls} llamadas a la API`);
