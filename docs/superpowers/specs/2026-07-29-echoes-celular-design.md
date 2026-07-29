# Diseño — Ver en el inbox lo que se contesta desde el celular (`smb_message_echoes`)

Proyecto Vercel **`wa-inbox-v2`** · repo `mandarinarepublic-ux/wa-inbox-v2` · producción = `main`.
Fecha: 2026-07-29. Continúa `docs/HANDOFF-2026-07-29-canales.md` (pendiente 6.7).

---

## 1. El problema

REPUBLIC (+593 97 910 4167) está en **coexistencia**: el número vive a la vez en
Cloud API y en la app de WhatsApp Business del celular. Cuando el dueño contesta
desde el celular, ese mensaje **no existe para el inbox**: la bandeja no se
entera, el chat sigue pendiente y otro vendedor lo vuelve a contestar.

Medido el 29-jul en la bandeja de REPUBLIC: clientes con **9, 6 y 5 mensajes
entrantes y una sola respuesta registrada**. El resto de las respuestas salieron
del celular y son invisibles.

## 2. Alcance

**Entra:**

- Guardar en `inbox.mensajes` lo que se manda desde el celular por REPUBLIC.
- Todos los tipos: texto, imagen, video, audio, documento, sticker.
- Archivar el binario de los medios en Supabase Storage (URL estable).

**No entra (decisión explícita del dueño: "solo que se vea, NADA MÁS"):**

- Cambiar el estado de conversaciones que **ya existen**. Un echo no marca
  ATENDIDO, no reabre a PENDIENTE, no toca temperatura ni venta.
- MANDI (5757). El código funciona para cualquier `phone_id` que Meta mande, pero
  hoy solo la WABA de REPUBLIC tiene el campo suscrito. MANDI es una segunda vuelta.
- Recuperar el histórico. Ver §8.

## 3. Evidencia: el payload real

Capturado en `inbox.webhook_eventos` el 29-jul 10:50–10:53 (3 echoes reales).
El diseño se hace contra esto, no contra la documentación.

```json
{
  "field": "smb_message_echoes",
  "value": {
    "messaging_product": "whatsapp",
    "metadata": {
      "phone_number_id": "118582961194601",
      "display_phone_number": "593979104167"
    },
    "contacts": [ { "wa_id": "593987047531", "user_id": "EC.1716732149501584" } ],
    "message_echoes": [ {
      "id": "wamid.HBgMNTkzOTg3MDQ3NTMx…",
      "from": "593979104167",      // NOSOTROS (display, no phone_id)
      "to": "593987047531",        // el cliente
      "type": "text",
      "text": { "body": "Test" },
      "timestamp": "1785340249",
      "to_user_id": "EC.1716732149501584"
    } ]
  }
}
```

Cuatro cosas que fija esta evidencia:

1. `type` + `<type>:{…}` es **idéntico** a `value.messages` → el parser existente sirve.
2. El teléfono del cliente es **`to`**. Usar `from` crearía una conversación con
   nosotros mismos.
3. El canal sale de **`metadata.phone_number_id`**, no de `from` (que viene en
   formato display y no coincide con ningún `phoneId` de `lib/canales.js`).
4. `contacts[]` **no trae `profile.name`**. No hay nombre que guardar; tampoco se
   pisa nada, porque `getConvId` solo hace upsert de `{cuenta, telefono}`.

## 4. Arquitectura

### 4.1 `lib/echoes.js` (nuevo)

Función **pura**, sin red ni base, probable con los payloads reales:

```js
extraerEchoes(value) → [{ id, telefono, tipo, mensaje, mediaId, timestamp, phoneId, raw }, …]
```

Reglas:

- `telefono = echo.to`
- `phoneId = value.metadata.phone_number_id`
- `timestamp` = `Number(echo.timestamp) * 1000` → ISO
- Descarta el echo si falta `to` o `id`. Un echo malformado no tumba el lote.
- No decide nada sobre estados: solo traduce el payload a filas.

### 4.2 `lib/wa-mensaje.js` (nuevo, por movimiento)

`extraer()` y `normalizarReferral()` se **mueven** desde
`app/api/webhook/route.js` a este módulo, y las importan el webhook y
`lib/echoes.js`.

Es un movimiento puro, sin cambio de lógica, cubierto por los 45 tests actuales.
Se hace así porque la alternativa —copiar el parser— es exactamente lo que
produjo el bug de las fotos (`206e9b0`): dos caminos que hay que acordarse de
mantener iguales.

De paso, `app/api/webhook/route.js` (417 líneas) deja de crecer.

### 4.3 Rama nueva en el webhook

Al principio del loop de `changes`, **antes** de la rama de `value.messages`:

```js
if (change?.field === 'smb_message_echoes') {
  for (const fila of extraerEchoes(value)) {
    if (marcarNuevo(fila.id)) echoes.push(fila)
  }
  continue   // no cae nunca en la rama de value.messages
}
```

y al final del POST: `if (echoes.length) waitUntil(procesarEchoes(echoes))`.

### 4.4 `procesarEchoes(echoes)`

Carril propio. Hace **solo** esto:

1. Dedup contra Supabase con `existeWamidSupabase` (2ª capa, igual que `procesar`).
2. Si la conversación **no existe**, crearla con `estado='ATENDIDO'` y
   `modo_ia='HUMANO'` (§5.2).
3. `guardarMensajeSupabase({ …, direccion: 'SALIENTE' })`.
4. Si hay `mediaId`, `archivarMedia({ mediaId, wamid })`.

No llama a saludos, IA, LINKPAGO, push ni cambios de estado — y no por acordarse
de excluirlos, sino porque **nunca entra a `procesar()`**, que es donde viven.

### 4.5 `lib/media-archive.js` (ampliar)

Hoy la tabla `EXT` solo mapea imágenes (`jpeg`, `png`, `webp`, `gif`). Se amplía a:

| MIME | ext |
|---|---|
| `audio/ogg` | `ogg` |
| `audio/mpeg` | `mp3` |
| `audio/mp4` | `m4a` |
| `audio/amr` | `amr` |
| `audio/aac` | `aac` |
| `video/mp4` | `mp4` |
| `video/3gpp` | `3gp` |
| `application/pdf` | `pdf` |

Más un respaldo que derive la extensión del subtipo MIME cuando no esté en la
tabla, en vez del `'jpg'` fijo de hoy.

`archivarFoto` pasa a llamarse **`archivarMedia`**, dejando `archivarFoto` como
alias exportado para no tocar a quien la llama.

> Esto arregla algo **ya roto para todos**: hoy un audio entrante de cualquier
> cliente, por cualquier número, se archiva con extensión `.jpg`.

## 5. Estados: qué se toca y qué no

### 5.1 Conversaciones que ya existen

Nada. `guardarMensajeSupabase` con `direccion:'SALIENTE'`:

- **NO** toca `ultimo_entrante_at` → la ventana de 24 h de Meta no se reinicia.
- **SÍ** actualiza `ultimo_mensaje_at` → el chat sube en la lista (deseado).
- **SÍ** actualiza `conversaciones.phone_id` al canal del echo (correcto: es el
  número por el que se está hablando).
- El `estado` (PENDIENTE / ATENDIDO / SOPORTE / ARCHIVADO), la temperatura, el
  `id_venta` y el `modo_ia` quedan **intactos**.

### 5.2 Conversaciones nuevas creadas por un echo

Cuando se escribe desde el celular a alguien que nunca escribió, el echo crea la
conversación. `getConvId` hace un upsert plano de `{cuenta, telefono}`, así que
quedarían los **defaults de la tabla**: `estado='PENDIENTE'` y `modo_ia='IA'`.

Las dos están mal para este caso:

- `PENDIENTE` metería en la bandeja de pendientes un chat que **ya atendiste** tú
  mismo desde el celular.
- `modo_ia='IA'` dejaría prendido **MANDI AGENT** (el bot propio,
  `MANDI_AGENT_URL`; nada que ver con Meta): cuando esa persona conteste, el
  agente le respondería encima de una conversación que iniciaste a mano.

  El guard de "la IA arranca apagada" funciona por **ausencia** — `modoIAde()` en
  el webhook devuelve `false` cuando el contacto no está en la agenda — pero un
  echo **sí crea la fila**, así que el contacto deja de ser nuevo y queda con la
  IA marcada como prendida. Contradice la regla ya establecida del proyecto (ver
  `registrarContactoEntranteSupabase`, que sí lo hace bien para los entrantes).

**Decisión:** la conversación creada por un echo nace con `estado='ATENDIDO'` y
`modo_ia='HUMANO'`. Solo al **crear**; nunca sobre una conversación existente.

## 6. Duplicados

Resuelto sin código nuevo. `guardarMensajeSupabase` hace
`upsert(fila, { onConflict: 'wa_message_id', ignoreDuplicates: true })`, y
`/api/saliente` ya guarda el wamid que devuelve Meta (`data.messages[0].id`).

Si Meta llegara a mandar echo de un mensaje enviado desde el inbox, se descarta
solo. Hay tres capas: el set en memoria (`marcarNuevo`), `existeWamidSupabase` y
el `UNIQUE` de la base.

## 7. Pruebas

`lib/echoes.js` es puro → se prueba sin webhook, sin Meta y sin base. Con los
payloads **reales** capturados:

1. `telefono` es el `to`, nunca el `from`.
2. `phoneId` sale de `metadata.phone_number_id`.
3. Cada tipo: texto, imagen (con y sin caption), audio, documento, sticker.
4. Un echo sin `to` o sin `id` se descarta y los demás del lote se procesan.
5. `value` vacío o sin `message_echoes` devuelve `[]` sin lanzar.

Son las primeras pruebas multi-número del repo — pendiente 6.5 del handoff.

## 8. Límites conocidos

- **No recupera el histórico.** Meta manda el volcado de hasta 6 meses por el
  campo `history`, y solo una vez, al onboardear la coexistencia (28-jul). El
  campo se suscribió el 29-jul, después de esa ventana: `inbox.webhook_eventos`
  no tiene ni un evento `history`. Lo anterior no se puede recuperar por esta vía.
- **Solo REPUBLIC.** MANDI necesita que su WABA suscriba el campo, y confirmar
  que ese número está en coexistencia.
- **No distingue en pantalla** un mensaje mandado desde el celular de uno mandado
  desde el inbox: los dos son `SALIENTE`. El crudo queda en `mensajes.raw`, así
  que se puede distinguir después si hace falta. Fuera de alcance por YAGNI.

## 9. Fuera de alcance, anotado para después

- Las alarmas recién suscritas (`account_update`, `phone_number_quality_update`,
  `template_category_update`, `message_template_quality_update`, `security`) hoy
  caen en `inbox.webhook_eventos` y **mueren ahí**: no hay nada que las lea ni
  que avise. Suscribirlas no es cobertura hasta que exista el aviso
  (pendiente 6.6 del handoff).
- `CRON_SECRET` no existe en Vercel → `/api/cron/seguimientos` devuelve **401**
  todos los días y **nunca** ha enviado un seguimiento, con la regla 🔥 caliente
  marcada como prendida en la pestaña AUTOS.
