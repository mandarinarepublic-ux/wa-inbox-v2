# WA INBOX v2 — Notas para Claude

## Regla base: trabajar SIEMPRE sobre la última versión en Vercel

Cuando se hable de **WA INBOX** o se trabaje en este repo, la referencia
siempre es **la última versión desplegada en producción en Vercel** (la que
está live para el usuario), no ramas viejas ni experimentos locales.

- **Producción = rama `main`.** El deploy de producción en Vercel sigue `main`.
  Lo que está en `main` es lo que está en el aire.
- Antes de analizar comportamiento actual o proponer cambios, confirmar que se
  está mirando `main` (o el commit que Vercel tiene marcado como
  `target: production`), no una rama de trabajo desactualizada.
- Ojo: puede haber deploys de *preview* (`target: null`) más nuevos que el de
  producción. Esos NO son la versión live. La live es siempre el último
  `target: "production"`.

### Cómo verificar la versión live
- Proyecto en Vercel: `wa-inbox-v2` (team `mandarinarepublic-6819's projects`).
- El deployment de producción actual se puede ver con las tools de Vercel
  (`list_deployments` → el más reciente con `target: "production"`), o en el
  dashboard. El campo `meta.githubCommitSha` dice exactamente qué commit está live.
- Regla práctica: `main` local al día con `origin/main` == versión de producción.

### Higiene de git (para no perder trabajo)
1. **Commit** apenas algo funcione, antes de cualquier `pull` / `checkout` / `merge`.
2. **Push** antes de cerrar (el entorno remoto/web es temporal; lo no pusheado se pierde).

_Referencia al momento de escribir esta nota (2026-07-21): producción = `main`
en commit `284dadf` ("fix(fotos): enviar fotos por media id de forma robusta").
Este SHA cambia con cada deploy; la regla es "lo que Vercel tenga en
producción", no este commit puntual._
