# Recetas de bienvenida por anuncio — diseño

**Fecha:** 14-sep-2026 · **Repo:** wa-inbox-next (MANDI primero; IND después con el mismo código)
**Estado:** aprobado en conversación con Rodrigo el 13/14-sep.

## 1. Por qué

Medido en MANDI (chats nuevos 29-jul → 12-sep, 1.030 chats, 78 compras):

- Casi todos los chats reciben **el mismo paquete de 3 respuestas rápidas, a mano**:
  saludo (870 chats) → pitch del producto del anuncio (610 con "🐉 DBZ a $35") → fotos (799).
- El paquete sale con una **mediana de 74 minutos** de retraso; un cuarto espera más de 4 h.
- Responder en menos de 15 min hace que el 50 % vuelva a escribir, contra 35 % si se
  tarda más de 4 h. La compra no cambia de forma medible: se decide después del paquete.
- El pitch depende del anuncio. El principal trae el 57 % de los chats.

Rodrigo quiere que ese paquete salga solo y al instante, por anuncio, y cerrar con una
pregunta de botones. No quiere un creador de flujos con condiciones y esperas: quiere
**una receta por anuncio**, elegida en un combo, hecha de las respuestas rápidas que ya usa.

## 2. Alcance

**Sí:**
- Receta = lista ordenada de respuestas rápidas existentes + pregunta final opcional con
  hasta 3 botones (20 letras c/u, límite de WhatsApp).
- Una receta se asigna a uno o varios anuncios (`source_id` del referral) o a la entrada
  especial **orgánico** (contacto nuevo sin referral).
- Se dispara al llegar el mensaje entrante que trae el referral (o el primer mensaje de un
  contacto nuevo, para orgánico). **Una vez por cliente por ventana de 24 h.**
- **Sin receta asignada no sale nada** (decisión de Rodrigo). Sin receta global activa,
  tampoco.
- Detección de **anuncio nuevo**: `source_id` nunca visto → se guarda con titular, texto y
  foto del referral, y **un aviso por Telegram** (una sola vez por anuncio).
- Pantalla en AUTOS: anuncios vistos con su receta (combo), marca NUEVO, y editor de recetas.
- Lo que el cliente toque en un botón entra como texto y **devuelve el chat a PENDIENTES**
  (ya funciona así). Ningún botón dispara nada solo.

**No (por ahora):**
- Condiciones, esperas, ramas, lienzo visual. Los pasos se guardan como lista ordenada para
  que eso pueda crecer encima sin rehacer.
- Plantillas fuera de la ventana de 24 h (la receta siempre responde a un entrante, así que
  siempre está dentro).
- Cambiar la etiqueta desde el CRM. El CRM sigue leyendo `inbox.anuncios`; no la escribe.

## 3. Datos

### 3.1 Configuración (sin tabla nueva): `inbox.automatizaciones.config.recetas`

```jsonc
"recetas": {
  "activo": false,                       // interruptor global, arranca APAGADO
  "lista": [
    { "id": "r_1a2b", "nombre": "DBZ chaquetas", "activa": true,
      "pasos": [ { "tipo": "respuesta", "respuestaId": "a398d2c4-…" },   // saludo
                 { "tipo": "respuesta", "respuestaId": "f43d9fd2-…" } ], // pitch + 5 fotos
      "pregunta": { "texto": "¿Cuál te gustó?", "botones": [ { "title": "1" }, { "title": "2" }, { "title": "3" } ] } }
  ],
  "por_anuncio": { "120252247632190606": "r_1a2b", "organico": null }
}
```

- `merge()` del servidor es de UN nivel: `recetas.lista` es un arreglo y se **reemplaza
  entero** (así lo guarda la pantalla); `recetas.por_anuncio` es objeto y se mezcla por clave.
- `pasos[].tipo` hoy solo admite `respuesta`. Es la puerta para `espera`, `condicion`, etc.
- Una respuesta rápida borrada deja un paso huérfano: se **salta con log**, no rompe la receta.

### 3.2 Migración única (`inbox`), vale para los dos inbox

```sql
alter table inbox.anuncios
  add column titular     text,
  add column texto       text,
  add column imagen_url  text,
  add column visto_en    timestamptz,   -- 1.ª vez que el INBOX lo vio en un referral
  add column avisado_at  timestamptz;   -- cuándo salió el aviso de "anuncio nuevo"
alter table inbox.conversaciones add column ultima_receta_at timestamptz;
```

`inbox.anuncios` nació el 5-sep con una carga única (`inbox_anuncios_etiqueta`); nadie más la
escribe hoy. Desde ahora el inbox hace **upsert por (cuenta, source_id)** sin pisar `etiqueta`
si ya tiene valor.

## 4. Disparo (webhook, `procesar`)

Por cada entrante `m`:

1. **Anuncio visto.** Si `m.referral.source_id` existe → `registrarAnuncioVisto` (upsert). Si la
   fila es nueva (`visto_en` recién puesto) → `enviarTelegram` y `avisado_at = now()`.
   Nunca lanza. Va con `waitUntil`, fuera del camino del guardado.
2. **Decidir receta** — módulo puro `lib/recetas.js`:
   `decidirReceta({ config, sourceId, esNuevo, contacto, botActivo, ahoraMs })` → `receta | null`.
   - `config.recetas.activo` falso → null.
   - `sourceId` → `por_anuncio[sourceId]`; sin sourceId y `esNuevo` → `por_anuncio.organico`;
     sin sourceId y no nuevo → null.
   - Receta inexistente o `activa=false` → null.
   - `botActivo` (el bot va a contestar ese chat: `decidirIA`) → null.
   - `contacto.ultimaRecetaAt` dentro de las últimas 24 h → null.
3. **Marcar ANTES de enviar.** `marcarReceta(telefono)` escribe `ultima_receta_at = now()` con
   guardia (`where ultima_receta_at is null or < now() - 24h`). Si la guardia no toca fila →
   otro proceso ya la mandó (Meta reentrega el mismo webhook): **no se envía**. Esto es lo
   que evita el paquete duplicado.
4. **Armar piezas** — `piezasDeReceta(receta, respuestas, contacto)` → lista ordenada de
   cuerpos para `/api/saliente`, reusando `adjuntosDeRespuesta`: por cada paso, texto (o
   texto+botones si la respuesta rápida tiene botones), luego sus adjuntos en el orden
   cargado (foto → `ImagenURL`, audio → `AudioURL`, documento → `DocURL`+`DocNombre`).
   Al final la `pregunta` como `interactive_buttons`. Todas con `Canal: m.phoneId` y
   `auto: true` (no reinicia el enfriamiento del push; no toca la bandeja → queda PENDIENTE).
5. **Enviar en orden**, con `enviarSaliente` (credencial de máquina, mira `res.ok`). Una pieza
   rechazada se registra con su código y **se sigue con la siguiente**: mejor un paquete
   incompleto que uno mudo, y el hilo muestra lo que salió.
6. **Saludo automático:** si salió una receta para ese chat, `saludarSiCorresponde` no corre
   (la receta ya saludó). Si no salió receta, el saludo sigue como hoy.

Costo en la ruta caliente: una lectura de `respuestas_rapidas` y una de `anuncios` **solo
cuando hay referral o contacto nuevo**, no por cada mensaje.

## 5. Aviso de anuncio nuevo (Telegram)

```
📣 Anuncio NUEVO en MANDI
«Hoodie One Piece Luffy – Nakamas Red»
id 120253…  ·  1.er chat hoy 14:32
Sin receta: nadie le contesta solo. Configúralo en AUTOS → Bienvenida por anuncio
https://inbox.apps.mandarinaec.com/?tab=autos
```

Reusa `lib/telegram.js` (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, ya configurados para
pendientes y entregas fallidas).

## 6. Pantalla (AUTOS → tarjeta "📣 Bienvenida por anuncio")

- Interruptor global.
- **Anuncios vistos** (`GET /api/anuncios`, detrás del login): etiqueta editable, titular,
  foto pequeña, chats de los últimos 30 días (`count(distinct telefono)` en `mensajes` por
  `source_id`), último visto, marca **NUEVO** si no tiene receta, y un combo con las recetas.
  Primera fila fija: **Orgánico (sin anuncio)**. Ordenados por chats 30 d desc.
- **Recetas**: lista con nombre, interruptor, y editor: pasos elegidos de las respuestas
  rápidas activas (selector + orden con ▲▼ + quitar; vista previa de texto y n.º de
  adjuntos), pregunta final (texto + hasta 3 botones), botón duplicar y eliminar. Eliminar
  una receta desasigna sus anuncios.
- Guardado: interruptores al instante (patch mínimo), el resto con "Guardar cambios"
  (manda `recetas` completo).

## 7. Módulos y pruebas

| módulo | qué hace | prueba |
|---|---|---|
| `lib/recetas.js` (puro) | `decidirReceta`, `piezasDeReceta`, `normalizarReceta`, `esAnuncioNuevo` | `tests/recetas.test.js` |
| `lib/inbox-supabase.js` | `registrarAnuncioVistoSupabase`, `marcarRecetaSupabase` (con guardia), `getAnunciosSupabase` | integración manual |
| `app/api/webhook/route.js` | los pasos del §4 | prueba en vivo |
| `app/api/anuncios/route.js` | GET lista + PATCH etiqueta | `tests/rutas-publicas.test.js` (NO es pública) |
| `components/Automatizaciones.jsx` | la tarjeta | a ojo |
| `lib/automatizaciones.js` | `DEFAULTS.recetas` | `tests/automatizaciones-merge.test.js` |

Casos que las pruebas puras tienen que cubrir: sin receta → nada · receta inactiva → nada ·
global apagado → nada · bot activo → nada · ya salió hace 2 h → nada · hace 30 h → sale ·
orgánico solo si es nuevo · paso huérfano se salta · orden texto→adjuntos→pregunta ·
botones recortados a 3 × 20 · respuesta con botones propios sale como interactivo.

## 8. Riesgos y cómo se cubren

- **Paquete duplicado por reentrega de Meta** → marcar antes de enviar con guardia (§4.3).
- **Chocar con el bot** → `decidirIA` decide; si el bot contesta, no hay receta.
- **Chocar con el saludo** → la receta lo reemplaza cuando sale.
- **Orden de las piezas** → una sola tarea secuencial, `await` por pieza, sin paralelismo.
- **Ruta caliente** → lecturas extra solo con referral o contacto nuevo.
- **Respuesta rápida borrada** → paso huérfano saltado con log; la pantalla lo marca en rojo.
- **Anuncio conocido por el CRM pero no por el inbox** → `visto_en` nulo = "no visto por el
  inbox"; la primera vez que llegue un referral se completa y se avisa igual.

## 9. Puesta en marcha

1. Migración (una vez, vale para los dos).
2. Deploy MANDI con `recetas.activo=false`.
3. Rodrigo crea la receta "DBZ" con sus 2-3 respuestas rápidas y la pregunta de botones, la
   asigna al anuncio principal, prende el global.
4. Prueba real: asignar temporalmente una receta a **Orgánico** y escribir desde un número
   nuevo; ver que llegan las piezas en orden y el chat queda en PENDIENTES; tocar un botón y
   ver que vuelve como texto. Quitar la asignación de Orgánico.
5. Control en la base: `select telefono, ultima_receta_at from inbox.conversaciones where
   cuenta='MANDI' and ultima_receta_at is not null order by 2 desc`.
6. IND: mismo código, misma pantalla, paleta crema/negro; el aviso de Telegram de IND ya tiene
   su propio bot.
