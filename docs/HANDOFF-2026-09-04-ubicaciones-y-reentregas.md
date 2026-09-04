# IND + MANDI — las ubicaciones abren el mapa, y el placeholder que se robaba el mensaje (4-sep-2026)

Este documento vale para **los dos inbox**. Está igual en `ind-inbox-next` y en
`wa-inbox-next`.

**Arrancó con un pedido de una línea** —«los clientes me mandan la ubicación y me
llegan coordenadas»— y de paso destapó que **135 mensajes de clientes que venían
de pauta se estaban guardando como "no podemos mostrar"**, con su origen perdido.

Todo lo de acá está desplegado y verificado. Lo pendiente está al final, con el porqué.

| | IND (`ind-inbox-v2`) | MANDI (`wa-inbox-v2`) |
|---|---|---|
| Commits | `a76dde9`, `c92b791` | `7faf4a3`, `b85afb8` |
| Pruebas | 447 verdes | 508 verdes |
| Lint | limpio (1 aviso viejo, `RightPanel.jsx`) | limpio (1 aviso viejo) |
| Despliegue | `● Ready` | `● Ready` |

---

## 1. Las ubicaciones ahora abren Google Maps

Cuando un cliente comparte su ubicación, Meta la manda como `type: location` y
`extraer()` la guardaba de texto: `📍 lat,lon nombre`. En el chat quedaban
coordenadas pelonas, inservibles para despachar.

Ahora se pinta una tarjeta clicable que abre Maps, y la barra lateral muestra
`📍 Ind Store` en vez de `📍 -0.18640510737896,-78.4934…`.

### La decisión que lo hizo barato: reconocer AL LEER, no al guardar

El dato ya estaba bien guardado desde julio. Lo único que faltaba era leerlo. Por
eso **no hubo migración, ni backfill, ni columna nueva** — y el arreglo vale igual
para todo el histórico.

`parseUbicacion(texto, raw)` en `lib/wa-mensaje.js` → `toMensaje` lo expone como
`ubicacion` → `UbicacionCard` en `components/Components.jsx`.

⚠️ **No se tocó `COLS_MSG`.** El hilo del chat ya consulta con `COLS_MSG_RAW`, así
que `raw.location` ya llegaba a la burbuja sin engordar la ruta caliente del polling.

### ☠️ El ancla son las COORDENADAS, nunca el emoji

El saludo automático de la tienda —«📍 Estamos en Quito: Av. 6 de Diciembre…»—
también empieza con 📍, y **hay 173 de esos en la base**. Un `texto.startsWith('📍')`
los pintaría todos como un mapa a coordenadas inventadas.

Hay una prueba en `tests/wa-mensaje.test.js` que se rompe si alguien afloja el patrón.

### De paso se recuperó la dirección completa

`extraer()` guardaba solo el `name` y **botaba el `address`**. Estaba en
`raw.location` todo el tiempo. Ahora las tarjetas muestran
«Av. 6 de Diciembre N37-209 y, Quito 170505, Ecuador».

### Lo que las pruebas inventadas NO cazaron

Las pruebas unitarias con casos escritos a mano pasaron todas. **Lo que destapó el
caso raro fue pasar los strings REALES de producción por la función**: aparecieron
71 filas de julio con el texto `📍 ,` — que no son ubicaciones, son fotos, audios
y pedidos de un bug de ingestión ya muerto (nada desde el 11-jul). Caen a texto
normal y quedó una prueba que lo fija.

**Volumen:** el 88% de las ubicaciones entra por IND (38 entrantes contra 7 de
MANDI en dos meses).

---

## 2. ☠️ Meta manda el MISMO mensaje dos veces, y nos quedábamos con el peor

Este es el hallazgo grande, y salió de una pregunta de Rodrigo: *«hay mensajes en
los que me piden información de un producto y no dice el origen de la pauta»*.

Meta manda el **mismo wamid dos veces**:

| Hora | Tipo | Referral | Contenido |
|---|---|---|---|
| `00:46:18.008` | `unsupported` | ❌ | "This message is unavailable." |
| `00:46:18.728` | `text` | ✅ anuncio X-Men | **"¡Hola! Quiero más información"** |

Primero un placeholder, **~0,4 s después** el mensaje de verdad con su texto y su
referral de pauta. Y el insert iba con:

```js
upsert(fila, { onConflict: 'wa_message_id', ignoreDuplicates: true })
```

`ignoreDuplicates` significa **gana el que llega primero**. La guardia de
idempotencia —correcta contra duplicados— se quedaba con el peor.

### El daño

**135 mensajes** convertidos en «⚠️ algo que no podemos mostrar» y **128 sin el
anuncio del que venía el cliente**, en 60 días.

| | Mensajes rotos | Perdieron el referral |
|---|---|---|
| IND | 125 | 118 |
| MANDI | 10 | 10 |

Los 10 de MANDI eran **todos** leads de pauta. Uno decía literal *«Me interesa
Chaqueta Dragon Ball Z - NARANJA»*; ocho más, *«¡Hola! Quiero más información»*.

### ⚠️ No alcanzaba con quitar `ignoreDuplicates`

Eso crea **el bug al revés**: un placeholder que llegue tarde pisando el mensaje
bueno. Y ese camino existe de verdad — en IND el mensaje real llegó primero en
**20 de 139 casos**.

**La regla no es «gana el último», es «gana el que tiene contenido».**

### Cómo quedó

`lib/reentrega.js`, función pura y con pruebas. Cuando el wamid ya existía,
`reparacionesDeReentrega` decide qué se puede pisar:

1. Contenido real sobre un placeholder → se repone entero (`WHERE tipo = 'unsupported'`)
2. Referral sobre un referral vacío → se rellena (`WHERE referral IS NULL`), nunca pisa uno lleno

☠️ **La guardia va en el WHERE, no en un `if` de JavaScript.** Los dos webhooks
llegan con 0,4 s de diferencia y pueden solaparse: que decida Postgres.

☠️ **El parche NUNCA toca `telefono`, `conversacion_id`, `fecha` ni `direccion`.**
Una reentrega tardía que los arrastrara movería el mensaje de chat o de bandeja, y
hacer desaparecer a un cliente es el bug más reincidente de este inbox. Hay una
prueba que se rompe si alguien mete uno de esos campos.

Vive como función pura por la misma razón que `patchesDeMensaje`: la lógica que
decide qué se pisa no puede quedar enterrada entre dos `await` donde nadie la
puede ejercitar.

### ⚠️ Estaba DORMIDO al arreglarlo, y casi me engaña

El doble envío se disparó de fines de julio a mediados de agosto y **la semana del
31-ago iba en CERO**. No lo arreglamos nosotros: **cambió Meta**.

«No aparecen casos» también puede significar «dejó de registrarse». El control fue
mirar que el webhook siguiera vivo y que los `unsupported` **siguieran llegando**
(21 en IND esa semana): lo que paró fue el emparejado, no el flujo. Si Meta lo
retoma, ahora ya no muerde.

### El método que lo cazó — reusable

**Cruzar `inbox.webhook_eventos` (el payload crudo de Meta) contra `inbox.mensajes`.**

La consulta que lo destapó pregunta `msg ? 'referral'` en el crudo y
`m.referral is null` en lo guardado. En 10 días MANDI tenía **275 referrals de
Meta y 274 guardados**: ese 1 era la punta del hilo.

Sirve igual para cualquier campo que Meta mande y nosotros perdamos.

---

## 3. Los 135 recuperados

Rodrigo primero dijo «ya no importa arreglar el pasado» y después pidió
rescatarlos. Salieron enteros de `inbox.webhook_eventos`, que no tiene límite de
retención.

Resultado: **135 filas con su texto real y su tipo `texto`, 128 con su anuncio**,
y el `raw` también repuesto. Cero quedaron con el aviso. Son 135 clientes distintos.

### Lo que hizo que no saliera mal

☠️ **El referral hay que guardarlo NORMALIZADO, no el crudo de Meta.**
`normalizarReferral` arma 10 claves fijas, siempre string. Antes de escribir una
sola fila, la transformación en SQL se contrastó contra **300 filas sanas: 300
idénticas**. Sin eso se habrían escrito 128 referrals con la forma equivocada y la
tarjeta de pauta no los habría pintado.

Auditar la herramienta antes que el sistema.

El UPDATE llevó guardia `tipo='unsupported'` → idempotente. Control negativo al
repetirlo: **0 filas**.

### ⚠️ Trampa de rendimiento, por si hay que repetirlo

Expandir 60-90 días de `webhook_eventos` con `jsonb_array_elements` **se pasa de
tiempo**. Lo que sí corre:

1. Aislar primero los wamids dañados en una tabla de trabajo
2. `cross join lateral` con `e.wamids @> array[r.wa_message_id]`

Así el planificador **sí usa el índice GIN** `webhook_eventos_wamids_idx`. Con el
array armado en un CTE (`&& (select array_agg(...))`) **no lo usa** y se cuelga.

### Una falsa alarma que di

Avisé que mis tablas de trabajo quedaban expuestas por PostgREST porque no tenían
RLS. **No era cierto**: los privilegios por defecto del schema `inbox` conceden solo
a `service_role`, nunca a `anon`. Se verifica con `set local role anon; select …` y
mirando `pg_default_acl`. Di la alarma antes de comprobar.

---

## Pendientes

- **`inbox._rescate_plan`** guarda el estado anterior de las 135 filas, por si hay
  que revertir. Tiene RLS. Se borra con `drop table inbox._rescate_plan;` cuando
  haya confianza.
- **Ubicaciones sin nombre.** 27 de 38 pines entrantes de IND llegan con puras
  coordenadas porque el cliente suelta el pin de «ubicación actual». Mostrar la
  calle real necesita geocoding de Google (API key + ~$5 por cada 1000 consultas).
  Se descartó por ahora; se agrega encima de lo que hay sin rehacer nada.
- **Las 71 filas de julio con texto `📍 ,`** (fotos, audios y pedidos de un bug de
  ingestión muerto el 11-jul) siguen ahí. Es cosmético: la foto se sigue viendo.
- **El aviso de lint de `RightPanel.jsx`** sigue igual, de antes de esta sesión.
