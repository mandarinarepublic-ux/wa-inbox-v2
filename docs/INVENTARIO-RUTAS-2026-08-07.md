# Inventario de rutas del inbox MANDI — 2026-08-07

Insumo obligatorio de la Fase 2 (§3.1 del spec): **la lista sale de medir, no de
recordar.** Cuando el inventario y la memoria no coincidan, gana el inventario.

## Cómo se armó

Tres fuentes cruzadas:

1. **Tráfico real de producción**, últimas 24 h, agrupado por ruta (registros de
   Vercel del proyecto `wa-inbox-v2`). 23 rutas con actividad.
2. **Código del navegador**: qué rutas llama nuestra propia interfaz.
3. **Los otros repos**: `mandi-agent`, `indx-agent`, `MANDARINACRM`,
   `ind-inbox-next` y `lamata-premios`, buscando llamadas entrantes al inbox.

> El intento de sacar 7 días de una sola consulta **se cayó por tiempo de espera**.
> La ventana efectiva fue de 24 h. Es suficiente para las rutas de uso diario,
> pero **no** garantiza ver algo que corra semanal o mensualmente. Por eso el
> modo observación (§3.2 del spec) sigue siendo obligatorio: es lo que atrapa lo
> que 24 h no muestran.

## Resultado: quién llama a qué

### 🔓 PÚBLICAS — nunca pueden pedir sesión (4)

Van **excluidas en el `matcher`**, no en una lista dentro del código. Cada una se
defiende sola.

| Ruta | Llamador | Cómo se defiende | Tráfico 24 h |
|---|---|---|---|
| `/api/webhook` | Meta (WhatsApp) | firma `META_APP_SECRET` | **1035** |
| `/api/cron/seguimientos` | cron de Vercel (cada hora) | `CRON_SECRET` | 25 |
| `/api/social/webhook` | Meta (FB/IG) | firma `META_APP_SECRET` | 1 |
| `/api/pago-dlocal` | **dLocal** | secreto compartido en la URL (`?k=`) | 1 |

**`/api/pago-dlocal` queda RESUELTO** — era la única incógnita que traía el spec.
Es la `notification_url` de dLocal, que avisa cuando cambia el estado de un pago.
Comprobado contra producción: responde **401 sin llave y 401 con llave falsa**, o
sea `DLOCAL_NOTIFY_SECRET` ya está puesto y la puerta ya está cerrada.

### 👤 DEL NAVEGADOR — se protegen con la sesión (27)

`automatizaciones` · `buscar` · `cliente-pedidos` · `contactos` ·
`contactos/estado` · `dashboard` · `directorio` · `hilo` · `inbox-sync` ·
`lista` · `media` · `media/precache` · `media/upload` · `mensaje` · `mensajes` ·
`notas` · `plantillas` · `push/subscribe` · `respuestas` · `saliente` ·
`social/estado` · `social/lista` · `social/media` · `social/saliente` ·
`tienda` · `upload-foto` · `upload-url`

Todas se llaman desde nuestra propia interfaz, así que después del candado
llevarán la cookie de sesión sin que haya que tocar el cliente.

⚠️ **`/api/media` es la excepción a vigilar.** No se llama con `fetch`, se usa
como `<img src="/api/media?id=…">` (`components/Components.jsx:270`). Un `<img>`
del mismo origen **sí manda la cookie**, así que funcionará — pero si algún día
esas imágenes se incrustan desde otro origen (por ejemplo el CRM), dejarán de
cargar. 319 llamadas en 24 h.

### 🚪 SIN LLAMADOR CONOCIDO — hay que decidir (4)

Ninguna tuvo tráfico en 24 h y ninguna aparece llamada desde el navegador ni
desde otro repo.

| Ruta | Qué es | Estado |
|---|---|---|
| `/api/conversacion` | daba el hilo a `mandi-agent` para su memoria | **el agente ya no la llama** (verificado en su repo) |
| `/api/social/ingest` | la usaba Make para meter mensajes de FB/IG | reemplazada por `/api/social/webhook`; tiene `SOCIAL_INGEST_SECRET` |
| `/api/capi/diag` | sonda de diagnóstico de la CAPI | responde 404 sin `DIAG_KEY` |
| `/api/push/test` | prueba de avisos push | sin referencias en ningún lado |

**`/api/conversacion` merece atención.** Nació para que MANDI tuviera memoria, y
memoria es justo lo que ya falló una vez y costó ventas. Hoy `mandi-agent` **no
la llama** —lo verifiqué en su código— pero sigue abierta y devuelve el historial
de conversación de cualquier teléfono a quien la invoque. Si de verdad nadie la
usa, protegerla no rompe nada; borrarla es aún mejor. **Confirmar antes de tocar.**

## Datos que cambian decisiones de la Fase 2

**`/api/inbox-sync` es la ruta más caliente del inbox: 931 llamadas en 24 h.**
Es el sondeo que mantiene la bandeja al día. Importa para la decisión abierta de
dónde vive el permiso (§5.1 del handoff): si el inbox relee `crm.usuarios` en
cada petición, esta sola ruta agrega ~930 consultas diarias. Es despreciable para
el plan Pro de Supabase, y compra revocación inmediata. **La relectura sigue
siendo la recomendación**, ahora con el número medido.

**El reparto real del tráfico:** de ~3300 peticiones en 24 h, **1061 son de Meta
y del cron** (rutas que jamás verán una sesión) y el resto del navegador. La
superficie que el candado tiene que cubrir es grande pero homogénea.

## Lo que este inventario NO prueba

- **Nada que corra con menos frecuencia que diaria.** La ventana fue de 24 h.
- **Que las 27 rutas del navegador se llamen siempre con sesión**: hoy no hay
  sesión que llevar. Lo prueba el modo observación, no esto.
- **Que no exista un llamador fuera de estos repos** — un escenario de Make vivo,
  una herramienta interna, un marcador de alguien. Esto también lo atrapa el modo
  observación, y es exactamente para lo que existe.

## Siguiente paso

Con esta lista ya se puede escribir el plan de la Fase 2: el `matcher` que excluye
las 4 públicas, el middleware en modo observación, `AUTH_MODO` como interruptor
de pánico, y la prueba que falla el build si alguien mete un webhook al camino
protegido.
