# HANDOFF 9-oct-2026 — 🚚 GUÍAS de Servientrega → CRM, respuestas en grupos y ajustes

Sesión larga con Rodrigo (7 al 9-oct). Lo de los días 7-8 (ventana de pauta de 7 días, reacciones con emoji, reactivación con pauta en IND) está en la memoria y en sus commits (`05301cb`, `4af490e`); acá va lo del 9-oct.

## Hecho (MANDI, producción)

| Commit | Qué |
|---|---|
| `2d4a553` | **Respuestas rápidas en grupos.** Botones `Todas · 📋 Datos · 🛍️ Productos · 📐 Tallas` con conteo en la pestaña Respuestas; grupo elegible al crear/editar; ↑↓ ordenan dentro del grupo visible; botón recordado por navegador. Columna `inbox.respuestas_rapidas.grupo` (migración `respuestas_rapidas_grupo`, compartida con IND). Lógica pura `lib/grupos-respuestas.js`. |
| `5941416` | Celular del cliente en la cabecera del chat de 9 px a 12 px (también IND). |
| `d4dff31` → `3056e06` | **Sección 🚚 GUÍAS** (pestaña junto a FLUJOS). Ver abajo. |

CRM (`MANDARINACRM`): `146bfb81` la rueda vuelve a bajar en PEDIDO MANUAL (el `overscroll-y-contain` del 7-oct se comía la rueda en escritorio; ahora solo en celular) · `42383d4b` la fecha de despacho se ve formateada (el CRM hacía `GUIA_FECHA.split(' ')` pensando en el formato de la hoja y salía el ISO crudo).

## 🚚 GUÍAS: cómo funciona

**☠️ Por qué reenviadas:** Servientrega (593985009414) escribe desde un número de **API** y Meta **no deja que dos cuentas de API se hablen**: los 107 mensajes que mandó (jul-oct, a IND y a MANDI) llegaron como `type: unsupported`, `raw_type: unknown`, error **131051**, sin texto ni media id. No hay endpoint para pedir el contenido después. Prueba extra: el número de MANDI le mandó 13 mensajes al 9804 de IND y llegaron igual de vacíos. **No es arreglable desde el código.**

**Flujo:** Servientrega → celular de **Rodri VIP (593987498489)** → Rodri reenvía cada guía a MANDI (foto + texto de Servientrega como pie) → pestaña GUÍAS → "🚚 Procesar guías".

- **Número de guía, destino y dirección:** del pie (`extraerDelTexto`).
- **Nombre, celular y FECHA del destinatario:** de la foto con **Tesseract** (OCR gratis, sin IA ni tokens, ~2-4 s en Vercel). Necesita `serverComponentsExternalPackages` + `outputFileTracingIncludes` en `next.config.js` (el worker carga su `.wasm` por ruta) y `cachePath: /tmp`.
- **Cédula:** la guía **NO la imprime** (confirmado con Rodrigo). `cedulaValida` (dígito verificador) queda lista y gana sobre todo si algún día aparece.
- **Se registra SOLA solo sin duda** (regla de Rodrigo: "en caso de duda no registres, prefiero hacerlo a mano"): celular exacto de UN cliente + nombre que no lo contradice (`nombreCompatible`) + UN pedido posible (EN_FABRICA, DESPACHO o COMPLETADO ≤45 días, sin guía). Todo lo demás → ⚠️ con `pedido_sugerido` y botón **✅ Confirmar**, o **✋ Asignar** (buscador por nombre, celular o número de pedido).
- **Registrar = lo mismo que "Registrar despacho" del CRM:** fila en `crm.guias_despacho` (con `fecha_despacho` = la fecha IMPRESA en la guía), línea `GUIA_DESPACHO` en la bitácora con los datos del despacho (`textoBitacora`) y el pedido a **COMPLETADO** con su línea `ESTADO_PEDIDO` (la usa `lib/etapaCliente.js` del CRM). No toca pedidos ya cerrados. Usuario `INBOX-GUIAS` (o el de la sesión si es a mano).
- **Idempotente** por número de guía. 8 OCR por clic; las pendientes se re-emparejan con lo ya leído, sin OCR.

**Archivos:** `lib/guias-servientrega.js` (puro, 18 pruebas en `tests/guias-servientrega.test.js` con los textos reales), `lib/guias-registro.js` (red y base), `app/api/guias/route.js`, `components/Guias.jsx`. Tabla `inbox.guias_servientrega` (migraciones `guias_servientrega`, `_fecha_guia`, `_sugerido`; SQL en `docs/sql/2026-10-09-guias-servientrega.sql`): lo leído de cada guía y por qué quedó pendiente. La fuente de verdad de "registrada" sigue siendo `crm.guias_despacho`.

**Datos al cierre (9-oct, 23:15):** 23 guías registradas (14-sep a 6-oct), todas con la fecha impresa corregida, bitácora completa y pedido en COMPLETADO. 10 entraron por nombre ANTES de la regla de la duda: revisadas una a una (misma ciudad y dirección, celular a un dígito) → correctas, no se tocaron.

## Todavía NO
- **Quitar/reasignar** una guía mal puesta desde la sección (hoy se corrige en el CRM).
- **Correr solo** (cron) además del botón: Rodrigo no lo pidió todavía.
- **Celulares del CRM con un dígito distinto** al de la guía (Erika Guerrón 0979766574 vs 0970766574, Byron Serpa …279 vs …270, etc.): o tipeo en el CRM o un dígito chico mal leído. Rodrigo debería revisarlos (también afectan los mensajes).
- Solo MANDI y solo reenvíos de Rodri VIP (`REMITENTES_GUIAS`). IND no tiene la sección.
- Pedirle a Servientrega (asesor comercial) su API corporativa: con eso no haría falta WhatsApp.
