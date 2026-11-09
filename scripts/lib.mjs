// Lógica pura (sin red) para armar status.json. La usan build.mjs y los tests.

/** 'YYYY-MM-DD' del instante `date` en la zona `tz`. */
export function dayKey(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Suma `n` días a una fecha 'YYYY-MM-DD' (aritmética de calendario, sin zona). */
export function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lista de días [desde, hasta], ambos incluidos. */
export function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// Estado público de un componente, de mejor a peor.
export const SEVERITY = { operational: 0, maintenance: 1, recovering: 2, down: 3 };

/**
 * Estado de un componente a partir de sus monitores de Better Stack.
 * paused/pending no cuentan (un monitor pausado no debe pintar la página de rojo);
 * si ninguno cuenta, el componente queda "unknown".
 */
export function componentState(statuses) {
  const counted = statuses.filter((s) => ['up', 'down', 'validating', 'maintenance'].includes(s));
  if (counted.length === 0) return 'unknown';
  if (counted.includes('down')) return 'down';
  if (counted.includes('validating')) return 'recovering';
  if (counted.includes('maintenance')) return 'maintenance';
  return 'operational';
}

/** Resumen general de la página. */
export function overallState(states) {
  const known = states.filter((s) => s !== 'unknown');
  if (known.length === 0) return 'unknown';
  const downs = known.filter((s) => s === 'down').length;
  if (downs === known.length) return 'major_outage';
  if (downs > 0) return 'partial_outage';
  if (known.includes('recovering')) return 'recovering';
  if (known.includes('maintenance')) return 'maintenance';
  return 'operational';
}

/** Peor disponibilidad entre los monitores de un componente (null si ninguno tiene dato). */
export function worstAvailability(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length ? Math.min(...nums) : null;
}

/**
 * Arma el JSON público. No incluye URLs, causas técnicas ni nombres internos de monitores:
 * solo componentes, porcentajes y tiempos.
 *
 * @param {object} p
 * @param {object} p.config      config.json
 * @param {Record<string, {status: string, createdDay: string}>} p.monitors  por id
 * @param {Record<string, Record<string, number|null>>} p.daily  monitorId → día → disponibilidad %
 * @param {Record<string, number|null>} p.totals  monitorId → disponibilidad % del periodo
 * @param {Array<{monitorId: string, startedAt: string, resolvedAt: string|null}>} p.incidents
 * @param {Date} p.now
 */
export function buildStatus({ config, monitors, daily, totals, incidents, now }) {
  const today = dayKey(now, config.timezone);
  const days = daysBetween(addDays(today, -(config.historyDays - 1)), today);

  const components = config.components.map((c) => {
    const state = componentState(c.monitors.map((id) => monitors[id]?.status ?? 'unknown'));
    const history = days.map((day) => {
      const vals = c.monitors.map((id) => {
        const m = monitors[id];
        if (!m || day < m.createdDay) return null;
        return daily[id]?.[day] ?? null;
      });
      return { day, availability: worstAvailability(vals) };
    });
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      state,
      availability: worstAvailability(c.monitors.map((id) => totals[id] ?? null)),
      history,
    };
  });

  const byMonitor = new Map();
  for (const c of config.components) for (const id of c.monitors) byMonitor.set(id, [...(byMonitor.get(id) ?? []), c.name]);

  // Un mismo incidente puede afectar a varios componentes; incidentes del mismo inicio y
  // fin en monitores distintos se agrupan para no repetirlos.
  const grouped = new Map();
  for (const i of incidents) {
    const affected = byMonitor.get(i.monitorId);
    if (!affected || !i.startedAt) continue;
    const key = `${i.startedAt}|${i.resolvedAt ?? ''}`;
    const g = grouped.get(key) ?? { startedAt: i.startedAt, resolvedAt: i.resolvedAt, components: new Set() };
    for (const a of affected) g.components.add(a);
    grouped.set(key, g);
  }
  const publicIncidents = [...grouped.values()]
    .map((g) => ({
      startedAt: g.startedAt,
      resolvedAt: g.resolvedAt,
      durationSeconds: g.resolvedAt ? Math.round((Date.parse(g.resolvedAt) - Date.parse(g.startedAt)) / 1000) : null,
      components: config.components.map((c) => c.name).filter((n) => g.components.has(n)),
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return {
    title: config.title,
    brand: config.brand,
    website: config.website,
    timezone: config.timezone,
    generatedAt: now.toISOString(),
    overall: overallState(components.map((c) => c.state)),
    components,
    incidents: publicIncidents,
  };
}

/**
 * Recupera las disponibilidades diarias ya calculadas en el status.json anterior, para no
 * pedir 90 días a la API en cada ejecución. Devuelve monitorId → día → %.
 * El JSON público guarda por componente, así que se guarda aparte un bloque `_daily`.
 */
export function previousDaily(prev) {
  const d = prev && typeof prev === 'object' ? prev._daily : undefined;
  if (!d || typeof d !== 'object') return {};
  const out = {};
  for (const [id, days] of Object.entries(d)) {
    if (!/^\d+$/.test(id) || !days || typeof days !== 'object') continue;
    out[id] = {};
    for (const [day, v] of Object.entries(days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (typeof v === 'number' || v === null)) out[id][day] = v;
    }
  }
  return out;
}
