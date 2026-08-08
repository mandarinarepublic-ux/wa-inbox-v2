# HANDOFF — Fase 3 CERRADA: el pedido sale a nombre de quien lo hizo

Fecha: 8-ago-2026. Verificada con un pedido real en producción.

- Spec: `docs/superpowers/specs/2026-08-06-login-crm-y-pedido-en-inbox-design.md`
- Plan: `docs/superpowers/plans/2026-08-07-fase-3-pedido-manual.md`
- Handoff anterior: `docs/HANDOFF-2026-08-07-fase2-cerrada.md`

---

## 1. Qué quedó funcionando

El panel derecho del inbox abre, dentro de un iframe, **la pantalla real de pedidos
del CRM** (`nuevo-pedido`), precargada con el teléfono y el nombre del chat. Al
crear el pedido, el CRM avisa por `postMessage` y el inbox deja la nota `📦` y
marca la venta.

**No se reimplementó ningún formulario.** Si mañana cambias un campo, una
validación o un paso del asistente en el CRM, el inbox lo ve igual sin tocar
nada: es literalmente la misma página.

### La verificación que cierra la fase

Pedido real `MAN-AND-5563`, creado desde el panel el 8-ago 04:42 UTC:

| | |
|---|---|
| `vendedor_id` | **`Andrés Admin`** — no `MANDI-WA` |
| Nota `📦` en el chat | apareció **1 segundo después** |
| `id_venta` | `MAN-AND-5563`, conversación en ATENDIDO |
| Mensajería, 3 h | 37 entrantes · 33 salientes · **0 fallidos** |

Ese era el punto de toda la fase: hasta ese día, cada pedido creado desde el
inbox quedaba firmado por un fantasma.

### Commits

- CRM `84c05d9f` → `0f56727b`
- Inbox `82ec199` → `cf1f0c8`

## 2. Cómo está armado, en cuatro piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| `lib/origenes.js` | CRM | **una sola** lista de orígenes nuestros. La consumen `volver.js`, la CSP y el `postMessage` |
| `embed=1` | CRM, `layout.js` + las dos pantallas de pedido | esconde menú y cabecera, y quita los topes de ancho |
| `lib/aviso-padre.js` | CRM | avisa al inbox validando el destino contra la lista blanca. **Nunca `'*'`** |
| `lib/pedido-manual.js` + `PedidoManual.jsx` | inbox | arma la URL, lee el aviso con seguridad, y dibuja el iframe |

**La CSP `frame-ancestors`** limita quién puede enmarcar el CRM a nuestros dos
inbox. Antes de esta fase **no había ninguna cabecera**: podía enmarcarlo
cualquiera.

## 3. Los siete fallos que se encontraron y arreglaron

Vale la pena leerlos: son el tipo de cosa que reaparece.

| Fallo | Qué habría pasado |
|---|---|
| El aviso dentro del `try` que crea el pedido | un fallo al avisar se mostraba como fallo al crear → **el vendedor reintentaba y duplicaba el pedido** |
| Monto como float crudo | `$59.699999999999996` en una nota **que no se puede editar** |
| `volver` sin la query en el middleware | con la sesión vencida, el pedido se creaba y **el inbox nunca se enteraba**, en silencio |
| Nota con `undefined` | registro permanente roto, en los dos caminos |
| Dos escuchadores del `postMessage` | nota y marca de venta **duplicadas** |
| El formulario se perdía sin preguntar | por 6 caminos distintos: cambiar de chat, de filtro, de canal (👋), la ✕ del cajón, el toque fuera, y **cambiar de pestaña** |
| El asa se quedaba pegada | el iframe es de otro origen y se traga el `mouseup`: el panel seguía al mouse **para siempre** |

## 4. Trampas medidas que conviene no volver a pisar

1. **`node --test` no entiende el alias `@/`.** Lo define `jsconfig.json` y solo
   lo usa el bundler de Next. Los `lib/` con prueba unitaria se importan entre sí
   con **ruta relativa**. Se detectó en el escaneo previo, antes de escribir código.
2. **El formulario del CRM cambia de diseño bajo 768px** (estilos `md:`), y el
   CRM no ve el ancho del panel: ve `ancho del panel ÷ ESCALA`. Por eso el ancho
   se **deriva** de la escala en `lib/pedido-manual.js` en vez de escribirse a
   mano, con pruebas que vigilan la relación para siete escalas.
3. **Arrastrar junto a un iframe de otro origen** pierde el `mouseup`. Hay cuatro
   defensas en capas; la más general es soltar el arrastre si en pleno movimiento
   ya no hay botón presionado.
4. **El aviso de Chrome para guardar direcciones NO se puede quitar desde la
   página.** Verificado en el código de Chromium: el atributo `autocomplete` solo
   alimenta una estadística, no filtra; y no hace falta que exista un `<form>`,
   Chrome arma uno imaginario. Se apaga en `chrome://settings/addresses`.
5. **La barra blanca con la URL** en la app instalada era una instalación como
   *acceso directo*. Se arregla reinstalando la app. (El service worker no maneja
   `fetch`, que es uno de los requisitos que Chrome mira.)

## 5. ⚠️ Pendientes, en orden de importancia

### 5.1 El acoplamiento que puede causar un pedido a nombre equivocado

**Lo más peligroso de toda la lista.** Que la URL congelada del iframe sea segura
depende **enteramente** del efecto de `RightPanel.jsx` que hace
`setManualAbierto(false)` al cambiar `activeConv?.telefono`. Si alguien lo borra
pensando "el iframe ya sobrevive, esto sobra", **el segundo pedido saldría con el
teléfono del primero**. El comentario de `PedidoManual.jsx` no lo menciona.
Es una línea de comentario y vale la pena ponerla.

### 5.2 El guard se puede apagar cruzando los 767px

Abrir el manual en escritorio, achicar la ventana por debajo de 767 (el panel
queda montado y oculto), abrir el cajón y confirmar la ✕: el mapa del guard
queda limpio pero el panel de escritorio sigue con el formulario vivo. Al
ensanchar reaparece lleno y **desprotegido**. Angosto pero real. Arreglo de una
línea: que `App` pase una señal que se incremente al limpiar el mapa.

### 5.3 Menores con su decisión ya tomada

- La prueba anti-comodín de la CSP tiene dos huecos (concatenación de strings, y
  la palabra `frame-ancestors` apareciendo antes en un comentario). Ninguno
  aplica hoy. Arreglo: anclar la búsqueda a la línea `value:`.
- El docstring de `montoRedondeado` dice que un dato ausente es mejor que un `$0`,
  pero `Number(null)` es `0` y es finito. Hoy inalcanzable.
- El celular y el nombre quedan también en la URL del login (historial y
  registros de Vercel).
- `if (!d.pedidoId)` rechazaría un `pedidoId` numérico `0`.
- Las navegaciones duras (`<a href>`, `reload()`) descartan el formulario; harían
  falta `beforeunload` adicionales.
- Sin indicio visual en la pestaña Ventas de que hay un formulario abierto.
- La columna `crm.pedidos.vendedor_id` guarda el **nombre**, no el identificador.
  Funciona, pero si alguien se cambia el nombre, los pedidos viejos apuntan a un
  nombre que ya no existe.

## 6. Lo que sigue

### Fase 4 — cerrar `mandi-agent`

`mandi-agent/api/crear-pedido.js` **acepta un POST de cualquiera y crea pedidos
reales en el CRM**, con el vendedor quemado como `MANDI-WA`. Ahora que el camino
manual firma con la persona real, ese contraste es peor que antes: no se sabría
si `MANDI-WA` significa "lo hizo la IA" o "no sabemos quién fue".

⚠️ **El botón "🤖 Crear con IA" del inbox llama a ese endpoint.** Cerrarlo sin
tocar el inbox rompe el botón.

### Fase 5 — repetir 2 y 3 en IND

**⚠️ NO se puede repetir el atajo que se tomó en MANDI.** En MANDI se corrió la
ventana de observación solo ~40 minutos porque Rodrigo confirmó que **él es el
único que lo atiende**. Medido el 8-ago, IND **no está en esa situación**:

| Ruta | IND, 24 h | MANDI, 24 h |
|---|---|---|
| `/api/inbox-sync` | **1278** | 931 |
| `/api/saliente` | **530** | — |
| `/api/hilo` · `/api/media` | 151 · 120 | — |
| `/manifest.webmanifest` | 13 (alguien lo tiene instalado) | — |

Ahí hay gente trabajando. Antes de encender nada en IND:

1. **Averiguar quién atiende ese inbox** y repartirle `INBOX_INDSTORE`, o el día
   del bloqueo se queda fuera a mitad de una conversación.
2. **Correr la ventana de observación completa**, 24-48 h. No hay atajo.
3. Copiar también `AvisoSesion` — sin él, IND repite el problema de los 3
   mensajes perdidos que pasó en MANDI al encender el candado.

`lib/acceso.js` ya contempla el permiso por variable (`INBOX_PERMISO`) y
`SESSION_SECRET` ya está cargado en `ind-inbox-v2`.

## 7. Ajustes de Chrome para quien atienda

- **El aviso de guardar direcciones:** `chrome://settings/addresses` → apagar
  "Guardar y completar direcciones". Es por perfil y aplica a todos los sitios;
  no hay excepción por sitio.
- **La barra blanca con la URL** en la app instalada: desinstalarla y volver a
  instalarla desde el ícono de la barra de direcciones.
