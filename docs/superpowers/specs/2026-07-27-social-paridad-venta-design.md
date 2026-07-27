# SOCIAL con las herramientas de venta de WhatsApp — diseño

**Fecha:** 2026-07-27
**Estado:** aprobado, listo para plan de implementación

## Qué problema resuelve

La pestaña SOCIAL ya recibe y contesta Facebook e Instagram, pero solo texto. El
vendedor no puede mandar una foto, ni una respuesta rápida con imágenes, ni un
producto del catálogo, ni un link de pago. En Instagram eso es casi todo el
negocio: el cliente comenta "precio?" debajo de una foto y espera ver el producto.

WhatsApp ya tiene todo eso resuelto. Este trabajo lo pone a disposición de SOCIAL
sin duplicar el código.

## Principio que manda sobre este diseño

**Un solo panel para todo lo que desarrollemos.** Lo que se construya para el inbox
se escribe una vez y sirve en los tres canales. Nada de una copia para WhatsApp y
otra para social: ese es el problema que hoy existe entre MANDI e IND, donde cada
arreglo hay que hacerlo dos veces.

## El hallazgo que define la solución

`RightPanel.jsx` (777 líneas) — las pestañas Respuestas / Ventas / Tienda — **ya es
el panel único**. Su interfaz no sabe nada de WhatsApp: recibe la conversación y
unas funciones de envío.

```
<RightPanel
  activeConv={…} contactInfo={…} windowOpen={…}
  onQuickReply={…} onSendText={…} onSendImage={…} onSendProducto={…}
  onUpdateContact={…} />
```

No hay nada que extraer. SOCIAL simplemente no lo está montando.

## Alcance de este bloque

Dentro:
- Respuestas rápidas **con sus fotos** en FB e IG
- Mandar fotos desde el disco del vendedor
- Pestaña **Tienda**: mandar un producto del catálogo con su foto
- **LINKPAGO** (link de pago dLocal)

Fuera, para bloques siguientes: avisos push, IA de MANDI, historial de pedidos del
CRM, notas y alias. Todos entran después por este mismo panel.

## Un comentario y un mensaje NO son la misma conversación

Un comentario es **público**; un DM es **privado**. Pedir una dirección de entrega
o un teléfono en un comentario expone al cliente a la vista de todos. No es un
detalle de interfaz: es una regla del negocio, y el inbox tiene que hacerla
imposible de romper por descuido.

Hoy se rompe. Las conversaciones se agrupan por `canal + sender_id`, así que el
comentario "😍" de *cualvos* (23:20) aparece dentro del mismo hilo que sus DM de las
23:01. El vendedor no distingue dónde está escribiendo.

**Corrección:** la conversación se agrupa por `canal + tipo + sender_id`. La misma
persona puede tener dos hilos separados, y así deben verse:

```
📸 IG · 💬 Comentarios · cualvos      ← público
📸 IG · ✉️ Mensajes · cualvos          ← privado
```

Cada hilo tiene sus propias herramientas:

| | 💬 Comentario (público) | ✉️ DM (privado) |
|---|---|---|
| Texto | sí | sí |
| Fotos | **no** — Instagram no admite fotos en un comentario | sí |
| Tienda (producto con foto) | **no** | sí |
| LINKPAGO | **no** — es un link de pago, no va en público | sí |
| Pedir datos de entrega | **nunca** | sí |

El hilo de comentarios se ve distinto a propósito —franja y etiqueta de "público"—
para que nadie escriba una dirección ahí por inercia.

### El puente entre los dos

El camino natural del negocio es: **comentario → privado → venta**.

Desde un comentario hay dos acciones, y solo dos:

1. **Responder en público** — texto, se cuelga del comentario, no caduca.
2. **Responder en privado** — abre el DM con esa persona.

Cuando la respuesta privada sale, la conversación continúa en el hilo de **Mensajes**,
que es donde están las fotos, la Tienda, el link de pago y los datos de entrega. El
inbox lo dice explícitamente: "sigue en Mensajes".

Esto además **disuelve la pregunta abierta** del diseño anterior: nunca se intenta
mandar texto y fotos a un comentario, porque las fotos no van ahí. Van al DM.

## Arquitectura

### 1. SocialInbox monta RightPanel

Se elimina de `SocialInbox.jsx` su barra propia de respuestas rápidas (el estado
`quickReplies` y su render) y se monta `RightPanel`. A partir de ahí, las tres
pestañas aparecen en SOCIAL sin escribir interfaz nueva.

`RightPanel` espera una conversación con la forma de WhatsApp (`telefono`, `nombre`).
La de SOCIAL tiene `canal` + `sender_id`. Se añade un adaptador que traduce una a
otra en `SocialInbox`, sin tocar `RightPanel`:

```
{ telefono: `${canal}:${sender_id}`, nombre, … }
```

El prefijo del canal evita que un `sender_id` de IG choque con uno de FB, y deja el
identificador legible.

**Cuidado con la pestaña Ventas.** `RightPanel` guarda notas y el id de venta
usando ese identificador como si fuera un teléfono, y eso escribe en la tabla de
contactos de WhatsApp. Con un identificador falso tipo `IG:660529760420669` se
llenaría de contactos basura que después ensucian el directorio y los envíos.

Por eso, en este bloque **la pestaña Ventas se monta deshabilitada para SOCIAL**:
se ven Respuestas y Tienda, que son las que venden. Las notas y el id de venta
entran en el bloque de CRM, cuando se decida dónde se guardan para social — que es
una decisión de datos, no de interfaz, y merece su propio diseño.

`windowOpen` (que en WhatsApp indica si la ventana de 24 h sigue abierta) se calcula
para SOCIAL a partir de la fecha del último mensaje entrante del cliente.

### 2. Adaptador de envío por canal

Lo único que difiere entre canales es **cómo sale una foto**:

| | WhatsApp | Facebook / Instagram |
|---|---|---|
| Imagen | subir a Meta → `media_id` → reutilizar (caché) | pasar la **URL**; Meta la busca |
| Por qué | la API de WhatsApp lo exige | el Send API acepta `attachment.payload.url` |

Las fotos de las respuestas rápidas ya viven en Supabase Storage y las del catálogo
en Shopify: las dos son URLs públicas. Así que en SOCIAL **no hace falta la caché de
`media_id` ni el precache**.

Cada inbox le pasa a `RightPanel` sus propias funciones de envío. El panel no se
entera del canal y no queda ningún `if (canal === 'IG')` regado por la interfaz.

### 3. Servidor: `/api/social/saliente` acepta imágenes

Se añade un campo opcional de imagen. Cuando viene, el cuerpo hacia Meta pasa de
texto a adjunto:

```
message: { attachment: { type: 'image', payload: { url, is_reusable: true } } }
```

El registro en `inbox.social_mensajes` guarda la URL en `media_url` (columna que ya
existe), de modo que la foto enviada se ve en el hilo igual que las recibidas.

Meta no admite texto y adjunto en el mismo mensaje: una respuesta rápida con texto y
3 fotos son 4 envíos, igual que en WhatsApp.

### 4. LINKPAGO

`lib/dlocal.js` ya genera el link y es solo texto. Se conecta en
`/api/social/saliente` con el mismo `parseLinkpago` que usa WhatsApp.

## Manejo de errores

- **Una foto falla:** las demás siguen. El vendedor ve cuál no salió, no un fallo
  genérico de toda la respuesta rápida.
- **Meta rechaza el envío:** ya se registra el `code`, el `subcode` y el contexto
  (canal, DM o comentario, privado o público). Se mantiene.
- **Ventana de 24 h cerrada:** el error de Meta se traduce a un mensaje entendible
  en pantalla, en vez del texto crudo de la API.
- **El intercambio del token de página falla:** se sigue con el token guardado. Como
  mucho vuelve el error anterior; nunca se pierde el mensaje.

## Riesgo y cómo se contiene

`App.jsx` (1619 líneas) corre la operación diaria. Por eso:

- **No se toca `handleQuickReply` ni la maquinaria de `media_id`.** WhatsApp queda
  igual.
- Los cambios en `RightPanel` son **aditivos**: si una función no viene, se comporta
  como hoy.
- **Verificación obligatoria antes de cerrar:** mandar una respuesta rápida con
  fotos por WhatsApp en producción (MANDI) y confirmar que sale como siempre.

## Lo que hay que comprobar en vivo

Separar comentarios de DM elimina la pregunta que tenía el diseño anterior (no se
mandan fotos a un comentario). Queda una sola incógnita, más chica:

**¿La respuesta privada a un comentario abre el DM de inmediato, o hay que esperar a
que el cliente conteste?** Define si el vendedor puede seguir vendiendo en el acto o
si el hilo de Mensajes queda esperando.

Hay un caso de prueba **vigente**: el comentario "😍" de *cualvos*
(`comment_id 18022877492885289`, 27-jul 23:20) está dentro de los 7 días. Se
responde en privado y se mira si el hilo de Mensajes acepta un envío enseguida.

Los 15 comentarios viejos no sirven: están fuera de plazo. A esos solo les queda la
respuesta pública.

## Cómo se prueba

1. **WhatsApp intacto** (lo primero y lo último): respuesta rápida con fotos por
   MANDI, igual que hoy.
2. **Hilos separados:** *cualvos* aparece dos veces —Comentarios y Mensajes— y su
   "😍" NO se ve dentro del hilo de mensajes.
3. **El comentario no deja mandar fotos:** en ese hilo no hay Tienda, ni foto, ni
   LINKPAGO. Solo texto, público o privado.
4. **FB · DM:** respuesta rápida con texto + fotos → llegan todas, en orden.
5. **IG · DM:** lo mismo.
6. **Tienda:** mandar un producto del catálogo por FB y por IG; llega foto y precio.
7. **LINKPAGO:** `LINKPAGO45` genera el link y se envía por DM.
8. **El puente:** responder en privado a un comentario y comprobar que la
   conversación sigue en el hilo de Mensajes.
9. **En la base:** cada envío queda en `inbox.social_mensajes` con su `media_url`,
   y se ve en el hilo al refrescar.
