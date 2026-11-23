# HANDOFF 21-nov-2026 — UX del inbox, firma cerrada, dashboard que dice la verdad

Sesión larga del 20 y 21-nov-2026, en la terminal. El estado anterior está en
`HANDOFF-2026-11-17-agente-mandi-v5.md`. Este documento cubre MANDI (`wa-inbox-v2`). IND
(`ind-inbox-v2`) recibió casi todo y tiene su propio handoff con las diferencias. También se
tocó el CRM (`MANDARINACRM`); ver la última sección.

☠️ **Regla de Rodrigo para todo esto:** *"nada de estos ajustes debe arriesgar la conexión con
META ni perder los mensajes o enviar mensajes de manera incorrecta"*. El método que funcionó:
antes de cada subida, quitar del diff los cambios de estilo (con sed: tamaños, colores,
aria-label) y comparar el resto contra HEAD, archivo por archivo. Si queda algo fuera de lo
esperado, se revisa a mano. Después del deploy, mirar el resultado en pantalla.

## Qué está EN PRODUCCIÓN

### 1. Firma del webhook de Meta: CERRADA en MANDI (`b0e97d6`)
- `lib/firma-meta.js` `descartarSinFirma` rechaza (403) cuatro casos: sin firma, firma deforme,
  firma que **no coincide** y **falta de secreto**.
- Pasan dos: `error-al-observar` (un error nuestro) y un veredicto desconocido.
- Medido antes de cerrar (24 h): 1.735 veredictos y 1.750 eventos, todos `coincide`.
- El único NO-coincide fue una prueba manual de las 13:58 del 20-nov que no guardó evento.
- Verificado después con mensajes reales: todos `coincide`, cero `DESCARTADO`.
- ☠️ **Falla CERRADO.** Si alguien cambia o borra `META_APP_SECRET` en Vercel, el inbox se queda
  sin mensajes. Los registros dicen `[firma] DESCARTADO NO-coincide/sin-secreto`.
  Arreglo inmediato: Instant Rollback, o corregir la variable y redesplegar.

### 2. Revisión de UX con Impeccable (23/40) — pasos aprobados por Rodrigo
- **Letra** (`057795d`):
  - Escala de cuatro tamaños: 11 / 12 / 13 / ≥14 sin cambio. Mínimo 11 px.
  - El canal y el 🧑/🤖 bajaron a la fila de chips, para que el nombre se lea entero.
- **Filtros** (`58bad48`, `e91b7dd`):
  - Plegados detrás de «Más filtros» también en la compu.
  - Plegados, se ven solo los ACTIVOS: clase `chip-activo` + CSS `:has()`.
- **Contraste** (`f07c04e`, `6593e28`):
  - Grises de texto a `#7c8ba1` (≥4.5:1).
  - `aria-label` en los botones de solo emoji.
  - Foco con teclado SOLO en botones y enlaces (`2de425d`).
  - ☠️ Rodrigo rechazó el contorno naranja en las cajas de texto: el navegador lo muestra al
    hacer clic y sale rectangular sobre la caja redonda. NO volver a ponerlo en inputs.
- **Toques de Mandarina** (`6593e28`):
  - Naranja `#f97316` solo en foco, selección, cursor y barra de desplazamiento.
  - El verde (enviar / en vivo), el rojo (Pendientes) y el ámbar (enviar con botones) tienen
    significado y no se tocan.
- **Encabezado del chat** (`70fec21`): las 4 etapas pasan a UN selector, `SelectorEtapa`, con un
  `<select>` nativo invisible encima. Usa la misma función `cambiarEtapa` (alterna).
- **Pasos 5 y 6 DESCARTADOS por Rodrigo:** chats en 2 líneas; deshacer y respuesta rápida al
  cuadro de texto. No volver a proponerlos.
- **Paso 7** (`ca629df`):
  - **Atendido → siguiente pendiente** (`lib/siguiente-chat.js`, probado). Con algo escrito en
    la caja NO salta.
  - ☠️ La caja de texto NO se vacía al cambiar de chat: un salto con borrador lo mandaría a otro
    cliente.
  - `changeStatus` toma teléfono y número ANTES de su primer `await`, así que guarda en el chat
    atendido.
  - **J / K** para moverse por la lista (probado en prod).
- **Paso 8:** «🎉 0 pendientes» solo con una sincronización BUENA de < 2 min. El orden «más
  antiguos arriba» ya existía (es el de fábrica) y se respeta la elección de cada equipo.
- Crítica guardada en `.impeccable/critique/` (no está en git).

### 3. Pedidos de Rodrigo durante la sesión
- **Buscador en respuestas rápidas** (`85eb7c4`): sin tildes; busca TODAS las palabras en el
  texto, los botones y el carrusel. Los conteos de los grupos siguen a la búsqueda.
- **Reacciones como en WhatsApp** (`cfafd9c`):
  - La del cliente se pega a NUESTRO mensaje (`reaccionesDelCliente`).
  - Si el mensaje reaccionado no está cargado, la reacción se sigue pintando suelta.
- **«‹ Chats» en el celular** (`322ffaf`):
  - El ☰ se leía como «menú». Ahora dice «‹ Chats» con los pendientes en rojo.
  - La pantalla vacía tiene un botón grande «Ver chats (N pendientes)». Port de AtiendeTodo `a424afb`.
- **Bandeja** (`f217cd4`, trampa #16 de la skill): RPC `inbox.aplicar_mensaje`. El aviso de cambio
  de número no saca de Pendientes y las horas no retroceden.

### 4. Dashboard del negocio (crítica 18/40 → arreglado, `357726e`)
- **Las 4 gráficas medían 4 px**, porque usaban `height %` sin contenedor con altura. Ahora crecen
  desde abajo, con total y máximo.
- **Series por día de ECUADOR.** Migración `dashboard_series_dia_ecuador` (base compartida).
  Antes lo de después de las 19:00 caía al día siguiente. Verificado: la suma de los días
  coincide con el total del periodo.
- **Ventas sin canceladas.** El total del negocio incluye YAW, que suma ventas pero no chats.
- **Conversión WhatsApp** = ventas con chat (`origen` por_chat / mensaje_directo /
  digital_a_fisico) ÷ contactos nuevos. Pedido de Rodrigo. Pasó de 33,6 % a 19 %.
- Si fallan los pedidos, el dashboard muestra un aviso en vez de $0.
- Pedidos paginados.
- Subtítulos honestos, gris legible y `aria-pressed`.

### 5. web-design-guidelines (skill de Vercel, instalada 21-nov)
- Dónde quedó: `~/.claude/skills/web-design-guidelines`. Se clonó sin npx y el SHA-256 coincide
  con el publicado.
- Corrida sobre el inbox: ~330 hallazgos.
- **Tanda 1 en prod** (`8a3595f`, `3a300da`):
  - El aviso «No se pudo enviar» queda pegado abajo de lo visible (sticky).
  - Social ya no baja solo cada 8 s.
  - «Enviar» de respuestas rápidas se ve deshabilitado con la ventana cerrada.
  - `overscroll-behavior` (en Android el «tirar para recargar» perdía borradores).
    ☠️ Iba en `body *` y **rompió la rueda del mouse**: sobre una fila o una tarjeta no bajaba,
    había que poner el cursor en un costado. Desde `f4e4ca1` va SOLO en `.msgs-scroll` (el hilo).
    No volver a ponerlo en un selector global.
  - `color-scheme: dark` y fondo desde el HTML (sin destello blanco).
  - Fecha «20 Nov».
  - Si estabas abajo, una foto que termina de cargar te vuelve a bajar.
- **Fotos:** Rodrigo eligió no fijarles alto (opción 3).
- **Tanda 2 en prod, rendimiento** (`5398a4c`, `1c23d78`). Medido por letra en una compu:
  **121 ms → 18 ms** (IND: 11 ms).
  - Filas de chats y burbujas con `memo(…, igualesParaMemo)` (final de `Components.jsx`).
  - Las pestañas ocultas (Social, Contactos, Autos, Flujos, Guías) con `React.memo`.
  - ☠️ Las funciones se comparan solo por presencia: por eso App les pasa envoltorios que
    llaman por `ultimasRef.current` a la versión MÁS RECIENTE. Una fila que no se redibujó
    nunca abre un chat con datos viejos. Una función nueva para filas o burbujas va por ahí.
  - `RightPanel` NO se memorizó a propósito: sus envíos son asíncronos y podrían caer en
    otro chat.
  - El contador ⏱ de 24 h vive en `ContadorVentana`: ya no redibuja el panel cada segundo.
- **Respuestas rápidas, buscador** (`281166e`, pedido de Rodrigo 22-nov): con texto en la caja
  busca SIEMPRE en todos los grupos (se resalta «Todas»), y tocar cualquier grupo borra la
  búsqueda. Probado en prod.
- **Scroll arreglado** (`f4e4ca1`, 22-nov): probado en prod con la rueda real, sobre una fila de
  chats y sobre una tarjeta de respuesta rápida (bajan ~555 px).

## PENDIENTE
- **IND: cargar `META_APP_SECRET`** (Rodrigo lo saca el 21-nov). Después: redesplegar, ver
  `[firma] coincide` y recién ahí cerrar igual que MANDI.
- **Revisar en el CELULAR:**
  - pestañas de arriba a 11 px (alguna puede salir con «…»);
  - selector de etapa;
  - «‹ Chats».
- **Probar con un cliente real:** Atendido → siguiente pendiente; el 🎉.
- **web-design-guidelines, falta la tanda 3** (ofrecida, Rodrigo aún no la aprueba):
  - **Tanda 3, higiene:**
    - nombres y etiquetas;
    - `prefers-reduced-motion` (no existe en el repo);
    - «...» → «…»;
    - errores con el siguiente paso;
    - modales con Esc;
    - listas largas virtualizadas (Contactos, carrusel).
- **Pauta de MANDARINA casi en $0 desde el 17-nov:** revisar si fue a propósito.

## CRM (MANDARINACRM) tocado en la sesión
- `c557f1dd` — 🔎 Guías para consultar (falta probar con una sesión de VENDEDOR).
- `cde52b9e` — `pauta_dia` paginada.
  - La pantalla de artes escondía 38 de 89 anuncios.
  - Arreglada la guardia `lecturas-acotadas`: cortaba la consulta en el primer `;` y no veía nada.
- `b2865b6c` — «Editar productos del pedido» desde el inbox perdía `?embed=1` y abría el CRM completo.
