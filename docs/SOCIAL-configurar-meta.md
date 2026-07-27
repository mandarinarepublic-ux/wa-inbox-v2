# SOCIAL (Facebook + Instagram) — qué falta configurar en Meta

Estado al 27-jul-2026. El **código ya está en producción** (`49aa23f`). Lo que sigue
es configuración del lado de Meta: sin esto no entra ni sale nada.

## Por qué estaba muerto

1. **Enviar** llevaba roto desde el **24-jun**: el `fb_page_token` guardado en
   `inbox.app_config` era un token de página normal y caducó. Meta responde
   `code: 190 — Session has expired on Wednesday, 24-Jun-26`.
2. **Recibir** dependía de **Make** (escenarios *EscuchaFacebook* / *EscuchaInstagram*
   que empujaban a `/api/social/ingest`). Dejó de llegar el **17-jul**. Quedaron 15
   comentarios de Instagram sin contestar ("Precio", "¿Aún tienen disponible?").

Ahora recibimos directo de Meta con `/api/social/webhook`, igual que WhatsApp.
Make sale del circuito.

## Paso 1 — `META_APP_SECRET` en Vercel (obligatorio)

Sin esto el webhook **rechaza todos los eventos** (403). Es a propósito: la URL es
pública y sin firma cualquiera podría meter conversaciones falsas.

- Meta → App Dashboard (la MISMA app que ya recibe WhatsApp) → Configuración →
  Básica → **Clave secreta de la app** → Mostrar.
- Pegarlo en Vercel (proyecto `wa-inbox-v2`) → Settings → Environment Variables →
  `META_APP_SECRET`.
- ⚠️ **Pegarlo desde el panel web de Vercel, NO desde PowerShell**: cargar variables
  con PowerShell les mete un BOM invisible y solo falla en producción.
- `SOCIAL_VERIFY_TOKEN` es opcional: si no está, usa el `WHATSAPP_VERIFY_TOKEN`
  que ya existe. Ese mismo valor va como *Verify Token* en el paso 3.

Después de guardar la variable hay que **redesplegar** para que la tome.

## Paso 2 — Token que NO caduca (Usuario del Sistema)

El error de siempre es generar un token de página: dura ~60 días y se muere en
silencio. Hay que usar uno de **Usuario del Sistema**.

1. business.facebook.com → Configuración del negocio → Usuarios → **Usuarios del
   sistema**. Puede servir el que ya existe (*Conversions API System User*).
2. **Agregar activos** a ese usuario: la **Página de Facebook** (control total) y la
   **cuenta de Instagram**.
3. **Generar nuevo token**, eligiendo la app de siempre, con estos permisos:
   - `pages_messaging` — contestar DM de Messenger
   - `pages_manage_metadata` — suscribir la página al webhook
   - `pages_read_engagement` — leer publicaciones y comentarios
   - `pages_show_list`
   - `instagram_basic`
   - `instagram_manage_messages` — DM de Instagram
   - `instagram_manage_comments` — comentarios y respuestas privadas
4. Guardarlo en Supabase (SQL Editor de `mandarina-DATA`). No hace falta redesplegar:
   el código lo lee de ahí y lo cachea 5 minutos.

```sql
update inbox.app_config
   set valor = 'EL_TOKEN_NUEVO', actualizado_at = now()
 where clave = 'fb_page_token';
```

## Paso 3 — Suscribir el webhook

Callback URL: `https://wa-inbox-v2.vercel.app/api/social/webhook`
Verify Token: el mismo `WHATSAPP_VERIFY_TOKEN` (o `SOCIAL_VERIFY_TOKEN` si pusiste uno).

- Producto **Messenger** → Configuración → Webhooks → suscribir campos:
  `messages`, `messaging_postbacks`, `messaging_referrals`, `feed`
- Producto **Instagram** → Webhooks → suscribir campos: `messages`, `comments`
- En Messenger → Configuración → **Páginas de acceso**, agregar la página de
  Mandarina (eso la suscribe a la app). Equivale a:
  `POST /{page-id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_referrals,feed`

## Paso 4 — Permisos del lado de Instagram

- La cuenta de IG tiene que ser **profesional** y estar vinculada a la Página.
- En la app de Instagram: Configuración → Privacidad de mensajes → **Permitir acceso
  a los mensajes** (si está apagado, los DM de IG no llegan por más permisos que tengas).

## Ojo con App Review

`pages_messaging`, `instagram_manage_messages` e `instagram_manage_comments` necesitan
**acceso avanzado**. Mientras la app esté en modo desarrollo solo funciona con gente
que tenga rol en la app. Si al probar con un cliente real no llega nada pero contigo
sí, es esto.

## Cómo probar que quedó

1. Mandar un DM a la página de Facebook desde otra cuenta.
2. Comentar en una publicación de Instagram.
3. Ver que aparezcan en la pestaña SOCIAL (refresca solo cada 8 s), o mirar la tabla:

```sql
select fecha, canal, tipo, nombre, direccion, texto
  from inbox.social_mensajes order by fecha desc limit 10;
```

Si no aparece nada, el POST crudo de Meta igual queda guardado en
`inbox.webhook_eventos` — ahí se ve si Meta llamó y qué mandó.

## Qué queda pendiente después de esto

- `/api/social/lista` está **abierto sin autenticación**: cualquiera con la URL ve
  nombres y conversaciones. Hay que cerrarlo como se cerró la API del CRM.
- Borrar `/api/social/ingest` (el buzón de Make) cuando el webhook esté probado.
- Avisos push para SOCIAL (hoy solo los tiene WhatsApp).
- Mandar fotos desde el inbox por FB/IG (hoy solo se reciben).
- La pauta de las filas viejas de IG quedó dañada por Make (`ad_id` = `1,7998E+16`)
  y hay emojis rotos. Las nuevas ya entran bien.
