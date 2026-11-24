# HANDOFF 23-nov-2026 — Fotos del chat al pedido, aviso de la hoja, plantilla de carrito

El estado anterior está en `HANDOFF-2026-11-21-ux-firma-dashboard.md`; todo lo de ese
documento sigue vigente. Este cubre MANDI (`wa-inbox-v2`). IND (`ind-inbox-v2`) recibió
**exactamente lo mismo** (mismos commits, con su paleta) y tiene un handoff gemelo. También se
tocó el CRM: ver la última sección.

☠️ Regla de Rodrigo, sigue en pie: *"nada de estos ajustes debe arriesgar la conexión con META
ni perder los mensajes o enviar mensajes de manera incorrecta"*. Nada de lo de hoy toca el
webhook ni el formato de lo que se le manda a Meta.

## EN PRODUCCIÓN

### 1. 📌 Usar una foto del cliente en el pedido (`0c80a6b` · IND `431c96d` · CRM `15d7ae8b`)
Pedido de Rodrigo: *"las personas que responden el inbox tienen pereza de cargar la foto del
pago"*. **Probado por Rodrigo en prod: "funciona a la perfección"** (MANDI; IND sin probar).

- Cada foto que manda el cliente lleva **📌 Usar** → **💳 PAGO** / **👕 PRODUCTO**
  (`components/Components.jsx`, `botonUsarFoto`). Visible para **todos** los del inbox (decisión
  de Rodrigo; no hay permiso propio de pedido manual).
- **PAGO** → comprobante de un pago por TRANSFERENCIA en el paso 3. El monto lo escribe el
  vendedor (sin monto el pedido no avanza, a propósito).
- **PRODUCTO** → foto de **Pecho** (el frente) de un producto personalizado en el paso 2; lo
  demás vacío.
- **No se resube nada:** viaja la URL pública de `inbox-media` y el CRM la guarda tal cual
  (`api/pedidos` deja pasar cualquier https).
- **Formulario cerrado** → se abre con la foto en la URL (`fotoPago` / `fotoFrente`).
  **Abierto** → postMessage `{tipo:'foto-pedido'}` al origen exacto del CRM y la SUMA sin borrar
  lo escrito (decisión de Rodrigo: "punto 1").
- Regla de qué foto sirve: `esFotoParaPedido` (`lib/pedido-manual.js`) = https +
  `piingkecjgoisnxccvaa.supabase.co` + `/storage/v1/object/public/inbox-media/`. Las que solo
  tienen `mediaId` o URL de Meta **no llevan botón** (el CRM no puede abrir el proxy del inbox).
  ⚠️ La MISMA regla está en el CRM (`lib/fotoDesdeInbox.js`): si se cambia una, cambiar la otra.
- Camino: burbuja → `ultimasRef.usarFotoEnPedido` → `fotoPedido` (App) → efecto en RightPanel
  (tope 8 s, mismo teléfono, igual que «🧾 Crear pedido») → `PedidoManual` (`foto`).
- Conocido: si se toca una segunda foto en el primer segundo después de abrir el formulario,
  el CRM todavía no escucha y esa foto se pierde; se vuelve a tocar.

### 2. Un solo aviso al mandar la hoja del pedido (`9f1fc99` · IND `1727b69`)
- Antes titilaban DOS burbujas («Enviando…» de la fila + «📤 ENVIANDO FOTO DEL PEDIDO»): parecía
  que salían dos fotos. **No salían dos**: verificado en el código (candados en CRM, VerPedido y
  EnviarHojaOculta) y en la base (10 días sin hojas repetidas).
- Ahora un solo aviso (`hojaEnviando` / `avisarHoja` en App) para el 📤 del historial y para
  VER PEDIDO: 📤 enviando → ✅ enviada (se queda hasta que la foto se ve en el hilo, para que no
  haya hueco que parezca que no salió) → ❌ con motivo (12 s).

### 3. La hoja ya no se queda «pensando» en el celular (`3d2d8f1` · IND `fa852eb`)
- **Tope de 90 s** (`TOPE_ENVIO_HOJA_MS`) una vez que la hoja llegó del CRM. Pasado el tope NO se
  reintenta (saldría doble): estado `duda` en ámbar, «no se confirmó… mira el chat». Si después
  sale, se corrige solo a ✅. VerPedido y la tarjeta del historial también distinguen `duda` de
  «NO se envió».
- **Las dos subidas a la vez** (Storage para pintar + Meta para enviar): `subirYEnviarFoto` pasa
  la url como PROMESA y `sendImageFile` la espera recién al armar el envío. Vale para TODAS las
  fotos del inbox.
- **Tope de la hoja 4 MB** (`MAX_HOJA_BYTES`): Vercel corta el cuerpo en ~4,5 MB antes del código.
- ⚠️ **Sin probar en el celular real.** Rodrigo va a mandar una hoja con datos móviles.
- No hecho (opcional, en el CRM): capturar la hoja a 1,5× en vez de 2× en el celular.

### 4. Plantilla `carrito_pendiente_mandi` (WABA MANDI, MARKETING, `es`) — PENDIENTE de Meta
- Creada el 23-nov por `/api/plantillas` (id `2359548751446159`). 3 variables: nombre, producto,
  link del carrito. Pie «Mandarina Republic». Se manda a mano desde «📋 Enviar plantilla».
- La vieja `abandono_carrito_mandarina` sigue aprobada pero está en idioma `en` y dice «hoodie» fijo.
- Sin hacer: que salga sola cuando el CRM detecta un carrito abandonado.

## Ventas atendidas desde la terminal (23-nov)
- Se respondieron ~17 chats con la skill `ventas-mandi` (`scratchpad/responder.mjs`, cada lote con
  «dale» de Rodrigo). Club Misterio: **$30 niño / $35 adulto**. Chaquetas DBZ: fleece de algodón.
- Quedaron esperando a Rodrigo: English …7883 (regalo para el jueves, ¿llega?), Eduardo (México,
  costo DHL a Salamanca), 😊😊😊 …0184 (formas de pago), Sebastián +1 (chaleco Hotline Miami,
  texto listo sin «dale»), Israel …3670 (verificar pago Deuna y cargar pedido Cíclope L $35).

## PENDIENTE
- Probar en el celular la hoja del pedido con datos móviles (punto 3).
- Probar 📌 Usar en IND.
- Aprobación de `carrito_pendiente_mandi` en Meta; decidir si se automatiza.
- Todo lo pendiente del handoff del 21-nov (IND `META_APP_SECRET`, revisiones en el celular).

## CRM (MANDARINACRM) tocado hoy
- `15d7ae8b` — fotos del chat en el pedido nuevo: `lib/fotoDesdeInbox.js` (con pruebas),
  `nuevo-pedido/page.js` (lee `fotoPago`/`fotoFrente`, escucha el postMessage, espera a que se
  conteste «¿recuperar el pedido?» para no perder la foto), `BuscadorProductos` (abre el
  personalizado con la foto en Pecho) y `SeccionPago` (la miniatura se actualiza si la foto llega
  con el pago ya montado).
