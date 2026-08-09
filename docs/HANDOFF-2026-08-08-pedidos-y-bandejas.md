# HANDOFF — 8-ago-2026: el pedido dentro del inbox, y las bandejas que no engañan

Continúa desde `HANDOFF-2026-08-08-fase3-pedido-manual.md` y
`ind-inbox-next/docs/HANDOFF-2026-08-08-fase5-ind.md`, que cerraron las 5 fases.
Todo lo de acá va **encima** de eso y está en producción.

---

## 1. Qué quedó funcionando

Desde la pestaña **Ventas** de cualquiera de los dos inbox, sin salir del app:

```
🧾 PEDIDO MANUAL        → la pantalla real del CRM, pedido firmado por quien lo hace
Ver →  /  📦 nota       → el pedido DENTRO del panel (antes abría pestaña nueva)
📤 Enviar al cliente    → la hoja del pedido como FOTO al WhatsApp del cliente
```

| Repo | Commit final |
|---|---|
| `wa-inbox-next` | `58f3520` |
| `ind-inbox-next` | `224504b` |
| `MANDARINACRM` | `f4cd0432` |

### Decisiones de producto que tomó Rodrigo

- **El botón de enviar vive DENTRO del pedido**, no en cada fila del historial: así
  ve la hoja antes de mandarla. La alternativa (un botón por fila) exigía dibujar
  la hoja en una ventana oculta y enviaba a ciegas.
- **Llega como foto JPG**, no PDF: se ve en el chat sin que el cliente abra nada.
- **Pregunta antes de enviar** (`¿Estás seguro que quieres enviar la foto del
  pedido al cliente?`). El botón está justo debajo de la hoja, al alcance de un
  clic distraído, y eso no se puede deshacer.
- **El botón es verde de WhatsApp**, no del color de la tienda: es el único de esa
  pantalla que manda algo hacia afuera.
- **El ✕ Cerrar es rojo**: en gris se perdía contra la cabecera oscura, y es el
  único camino de salida de esas vistas.

### Un patrón que se repitió y conviene mantener

**El CRM es UNO SOLO y sirve a los dos inbox.** El botón de enviar, la
confirmación y el color se pusieron una vez y valieron para MANDI y para IND.
Lo mismo con `MarcoCRM.jsx` dentro de cada inbox: hay **un solo iframe escalado
por app**, compartido entre PEDIDO MANUAL y VER PEDIDO. El día que se ajuste el
zoom o el ancho, se toca un sitio y no cuatro.

Cuando algo se comparte, el commit de un cambio de una línea cubre las dos
vistas. Cuando se copia, se arregla una y se olvida la otra — que es el bug de
las fotos por el número equivocado, documentado en `lib/responder-ia.js`.

## 2. ⚠️ Las bandejas: lo que cambió y por qué

### El síntoma

Rodrigo: *"cuando coloco como CALIENTE un chat y me vuelven a escribir, ese chat
no está en la bandeja de pendientes"*. Su regla de trabajo es
**«si esa bandeja está vacía, contesté a todas las personas»**, y eso dejaba de
ser cierto.

### La causa, que NO era la temperatura

`changeTemperatura` no toca la bandeja: caliente/tibio/frío son el **otro eje**.
Lo que fallaba era la regla de reapertura, que solo devolvía a Pendientes los
chats en `atendido`:

```js
if (estadoDe(telefono) === 'atendido') updateEstado(telefono, 'PENDIENTE')
```

Soporte, Venta y Archivado se respetaban por considerarlos "estados
deliberados". **Y a Soporte se llegaba SOLO**: el webhook mandaba ahí cualquier
chat donde el cliente enviara una foto — o sea, casi siempre un pedido.

⚠️ **Estaba en los dos inbox pero en archivos distintos**: en MANDI dentro del
webhook, en IND dentro de `registrarContactoEntranteSupabase` de
`lib/inbox-supabase.js`. Buscando solo en el webhook de IND se concluiría que
ahí no existía el problema.

### Lo que quedó

1. **Un entrante devuelve el chat a PENDIENTE siempre**, venga del estado que
   venga. Se comprueba el estado antes de escribir, así que no agrega ni una
   escritura para los chats que ya estaban ahí.
2. **El webhook ya no manda nada a SOPORTE.** La escalada por foto conserva lo
   demás: apaga la IA de ese chat y manda `Permíteme un momento por favor 🧡`.
   Soporte sigue existiendo como bandeja, pero **ahora se marca a mano**.

**La regla de fondo, que conviene no romper:** ningún automatismo puede sacar un
chat de Pendientes sin que una persona lo decida.

## 3. ⚠️ La señal a Meta que casi se pierde en silencio

Quitar el Soporte automático **habría roto una señal de pauta sin que se notara**.
Un chat cuenta como venta en proceso (`InitiateCheckout` a Meta) por cualquiera
de estas vías, y **SOPORTE era una de ellas**:

```
🔥 CALIENTE  ·  📋 SOPORTE  ·  ✉️ 6+ mensajes entrantes
```

La vía de Soporte era la más valiosa: saltaba **de inmediato** cuando el cliente
mandaba una foto, en vez de esperar a seis mensajes.

**Arreglo:** se pide la señal por el **hecho real** —el cliente mandó una foto—
en vez de por la bandeja. Quedó mejor que antes: ya no depende de un estado que
alguien puede cambiar sin querer.

```
🔥 CALIENTE  ·  📋 SOPORTE (manual)  ·  📷 mandó una foto  ·  ✉️ 6+ mensajes
```

**En IND esa vía es NUEVA**: nunca tuvo Soporte automático, así que esas fotos
no le decían nada a Meta. Medido: **752 fotos entrantes en 30 días** en IND
contra 217 en MANDI.

⚠️ **Se miran DOS nombres de tipo: `imagen` e `image`.** El segundo es el de los
mensajes anteriores al 11-jul-2026 (de antes de la migración). Mirando uno solo,
la señal no saltaría para media base y nadie se enteraría.

## 4. La firma de Meta — EN OBSERVACIÓN, no rechaza nada

### La corrección que hay que leer

El comentario de `lib/rutas-publicas.js` decía «`/api/webhook` → firma de Meta con
`META_APP_SECRET`». **Es falso, y lo era en los dos inbox.** Describía una
intención, no el código. El único que verifica firma de verdad es el webhook de
**SOCIAL** (Facebook/Instagram).

Sin verificar firma, cualquiera que conozca la URL puede inventarse mensajes de
clientes y aparecerían en el inbox como reales.

### Lo que se hizo, y sus límites

`lib/firma-meta.js` en **MANDI** (IND todavía no). **SOLO OBSERVA.** No existe ni
una rama que rechace, y hay una prueba que falla si alguien agrega una.
Instrucción textual de Rodrigo:

> *"EXCLUSIVAMENTE modo observación, BAJO NINGÚN CONCEPTO vas a modificar nada
> que implique dejar de recibir o enviar mensajes por 1 segundo"*

⚠️ **Lo delicado no es la criptografía, es el cuerpo.** Antes se hacía
`req.json()`, que lo **consume**. Ahora se lee UNA sola vez como texto y de ahí se
parsea, porque la firma se calcula sobre esos bytes exactos: re-serializar el
JSON cambia espacios y orden de claves y el sello no cuadraría aunque el mensaje
fuera legítimo. Hay una prueba de ese caso. **Un `req.text()` seguido de un
`req.json()` deja el webhook sin procesar mensajes.**

### Resultado medido en MANDI

```
[firma] coincide      ×10   ← mensajes REALES de Meta
[firma] NO-coincide         ← sonda con firma inventada
[firma] sin-cabecera        ← POST sin firma
```

**El `META_APP_SECRET` que MANDI tiene es el correcto**, y el verificador
distingue lo bueno de lo falso. Se busca en los registros con `[firma]`.

## 5. Pendientes

### 5.1 Inmediato: probar el secreto en IND

**Falta que Rodrigo copie el `META_APP_SECRET` de `wa-inbox-v2`** (Vercel →
Settings → Environment Variables → el ojito) y se cargue en `ind-inbox-v2`.
No se puede leer por CLI: Vercel cifra las variables.

Después, portar `lib/firma-meta.js` a IND, **también en modo observación**.
Si el WhatsApp de IND está en otra app de Meta, el registro lo dirá con un
`NO-coincide` limpio y sin que nadie deje de recibir mensajes.

**Activar el rechazo NO está decidido** y sería otro commit, revisado aparte,
después de días de registro limpio.

### 5.2 Créditos de Anthropic

Rodrigo dijo el 8-ago que los carga ese día. La IA lleva medio mes apagada.
- MANDI e IND **ya tienen la memoria arreglada** (leen el hilo directo de Supabase).
- ⚠️ Si IND no contesta, revisar **`IA_AUTORESPUESTA`**: es un interruptor global
  que MANDI no tiene.

### 5.3 El cartel de "IA activa" que promete lo que no cumple

El inbox dice *"🤖 IA respondiendo automáticamente"* aunque no haya créditos.
En 7 días, **98 clientes de MANDI y 203 de IND** escribieron a un chat así y
nadie les contestó. Se puede detectar que el agente no responde y decirlo, en vez
de afirmar que alguien se está encargando.

### 5.4 Prueba que nadie pudo hacer

**Abrir el mismo chat en el celular y en la computadora a la vez y mandar la
hoja.** En el celular el panel de escritorio sigue montado (solo lo esconde el
CSS), así que hay dos escuchando el mismo aviso. El candado (`e.source ===
iframe.contentWindow`) está puesto y razonado, pero solo se confirma con los dos
paneles vivos. Si sale duplicada, es un arreglo corto.

### 5.5 Menores heredados

- El hueco del guard **al cruzar los 767 px** (§5.2 del handoff de la Fase 2),
  presente en los dos repos. Conviene arreglarlo en los dos a la vez.
- `crear-pedido.js` quedó **cerrado y además huérfano** en los dos agentes:
  ya nadie lo llama. Borrarlo sería lo definitivo.
- `lib/config.js` de IND quedó **sin un solo consumidor** (herencia de Make).
- El comentario mentiroso de `lib/rutas-publicas.js` sobre la firma, en los dos
  repos.

## 6. Método que funcionó, para repetir

1. **Construir en MANDI, que lo usa solo Rodrigo; verificar con él; portar a IND**,
   donde atiende alguien más. Salió bien cinco veces seguidas.
2. **Extraer, no copiar.** Cada vez que se compartió el armazón, un cambio de una
   línea cubrió las dos vistas. Cada vez que en este proyecto se copió, se arregló
   una mitad y se olvidó la otra.
3. **Medir antes de tocar.** El peso del JPG, las 752 fotos de IND, los nombres de
   tipo `imagen`/`image`: todos salieron de consultar la base, no de suponer.
4. ⚠️ **Un registro vacío puede ser "no hay" o "no lo encontré".** Las consultas de
   Vercel agotan el tiempo y devuelven vacío sin decirlo con claridad. Ese punto
   ciego costó una conclusión equivocada sobre la IA ese mismo día: se dio por
   viva porque respondía rápido, cuando esas respuestas eran de los saludos
   automáticos. **Contrastar siempre contra el comportamiento en la base.**
