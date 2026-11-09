# Estado de Carmiña Villegas

Página de estado pública (estilo Better Stack) alojada gratis en GitHub Pages. Los datos salen
de los monitores del grupo **Carmiña Villegas** en Better Stack Uptime (plan gratuito, que solo
permite 1 página de estado propia y ya la usa Hojea).

## Cómo funciona

- `.github/workflows/status.yml` corre cada 5 min (GitHub lo atrasa a veces hasta ~15 min).
- `scripts/build.mjs` lee la API de Better Stack con un token **de solo lectura** y genera
  `dist/index.html` + `dist/status.json`. No hace commits: publica con GitHub Pages.
- El histórico de 90 días se reutiliza del `status.json` publicado; en cada ejecución solo se
  piden hoy y ayer (~17 llamadas a la API).
- Si la API falla, no se publica nada y la página avisa que los datos están desactualizados
  (más de 20 min).
- El JSON público no incluye URLs, causas técnicas ni nombres internos: solo componentes,
  porcentajes e incidentes (inicio, fin y duración).

## Componentes (`config.json`)

| Componente | Monitores de Better Stack |
|---|---|
| Tienda online | CV · Tienda online |
| Formularios | CV · API formularios, CV · Datos (VTEX), CV · Captcha |
| Lista de deseos | CV · API wishlist, CV · Datos (VTEX) |

El estado del componente es el del peor de sus monitores; los pausados no cuentan.
"CV · Dominio sin www" queda fuera a propósito (es interno).

## Configuración del repo

- Secreto `BETTERSTACK_TOKEN`: token del equipo, tipo **Read only** (Better Stack → Settings →
  API tokens → Incidents API).
- Variables `PUBLIC_URL` (p. ej. `https://status.carminavillegas.com`) y, si hay dominio
  propio, `CUSTOM_DOMAIN` (`status.carminavillegas.com`).
- Settings → Pages → Source: **GitHub Actions**.

## Desarrollo

```bash
node --test 'test/*.test.mjs'
BETTERSTACK_TOKEN=... node scripts/build.mjs && python3 -m http.server -d dist 8765
```
