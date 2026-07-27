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
identificador legible en las notas.

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

## Pregunta abierta — se resuelve con una prueba, no con una suposición

Meta permite **una sola respuesta privada por comentario**. Lo que no está
confirmado es si esa respuesta **abre la ventana de 24 h**.

- **Si la abre:** salen el texto y todas las fotos, igual que en WhatsApp.
- **Si no la abre:** el texto va por la respuesta **pública** (que no caduca ni tiene
  tope) y la privada se reserva para la foto. El cliente ve las dos.

**La prueba:** comentar desde otra cuenta en una publicación reciente de Instagram,
y desde SOCIAL mandar texto e inmediatamente una foto. Si la foto sale, la ventana
se abre.

Los 15 comentarios pendientes NO sirven para probar: están fuera de los 7 días.

Hasta tener el dato, la implementación asume el caso bueno y trata el fallo del
segundo envío como el disparador del camino alternativo.

## Cómo se prueba

1. **WhatsApp intacto** (lo primero y lo último): respuesta rápida con fotos por
   MANDI, igual que hoy.
2. **FB · DM:** respuesta rápida con texto + fotos → llegan todas, en orden.
3. **IG · DM:** lo mismo.
4. **Tienda:** mandar un producto del catálogo por FB y por IG; llega foto y precio.
5. **LINKPAGO:** `LINKPAGO45` genera el link y se envía.
6. **IG · comentario:** el caso de la pregunta abierta.
7. **En la base:** cada envío queda en `inbox.social_mensajes` con su `media_url`,
   y se ve en el hilo al refrescar.
