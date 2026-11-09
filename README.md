# Estado de Carmiña Villegas

<!--start: description-->
Monitoreo y página de estado de la tienda online de Carmiña Villegas y su middle-end, con
[Upptime](https://upptime.js.org): GitHub Actions revisa cada servicio cada 5 minutos, cada caída
abre un issue (GitHub avisa por email a quien esté asignado) y la página se publica en GitHub
Pages. Todo gratis.
<!--end: description-->

## [📈 Estado en vivo](https://antisacsor.github.io/cvillegas-status/): <!--live status--> **🟩 Todos los servicios en línea**

<!--start: status pages-->
<!--end: status pages-->

<!--start: docs-->
## Cómo funciona

- **Configuración:** solo `.upptimerc.yml`. Los workflows de `.github/workflows` son de la
  plantilla de Upptime; no se editan a mano.
- **Chequeos:** `Uptime CI` corre cada 5 min (GitHub puede atrasarlo). Cada servicio falla si no
  responde o si la respuesta no trae el texto esperado (`"status":"ok"`, `"datos":"ok"`,
  `"captcha":"ok"`, `carrito`).
- **Alertas:** cada caída abre un issue asignado a `pepe0062` y se cierra solo al recuperarse.
  Para recibir el email: GitHub → Settings → Notifications → "Issues" y "Actions" con email activo,
  y *Watch* en este repo.
- **Página:** `Static Site CI` la publica en la rama `gh-pages`. Lee los datos en vivo desde la
  API de GitHub.
- **Sin token personal:** todo usa el `GITHUB_TOKEN` del workflow. Por eso `Setup CI` y
  `Update Template CI` están desactivados (necesitan permiso para reescribir workflows). Para
  actualizar la plantilla de Upptime, hacerlo a mano copiando `.github/` desde
  [upptime/upptime](https://github.com/upptime/upptime).

Monitoreo del middle-end (qué mide `/health/deep`, runbooks): `docs/OBSERVABILITY.md` del repo
`villegas_middleend`.
<!--end: docs-->
