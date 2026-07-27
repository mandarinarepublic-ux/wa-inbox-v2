# SOCIAL (Facebook + Instagram) — qué falta configurar en Meta

Estado al 27-jul-2026. El **código ya está en producción** (`49aa23f`). Lo que sigue
es configuración del lado de Meta: sin esto no entra ni sale nada.

## Datos concretos del montaje

- App de Meta: **MandarinaSalesApp**, ID `931686799639248`. De ahí sale el
  `META_APP_SECRET` (es la app que va a FIRMAR los eventos de FB/IG).
- **Página de Facebook: `1437580293211264`**
- **Cuenta de Instagram: `17841467642039699`** (@mandarinarepublicec)

## Por qué estaba muerto

1. **Enviar** llevaba roto desde el **24-jun**: el `fb_page_token` guardado en
   `inbox.app_config` era un token de página normal y caducó. Meta responde
   `code: 190 — Session has expired on Wednesday, 24-Jun-26`.
2. **Recibir**: dependía de **Make**, y hay que separar los dos escenarios porque NO
   están igual (revisado en Make el 27-jul):
   - *EscuchaFacebook - Mandarina* (5484769): encendido, pero su **última ejecución
     real fue el 25-jun**. Un mes sin recibir un solo DM. Está muerto de hecho.
   - *EscuchaInstagram - Mandarina* (5484757): **sigue corriendo HOY** (ejecuciones
     el 27-jul), pero **desde el 21-jul no aterriza nada** en la tabla. Ese día se
     editó el escenario (pasó de 3 a 4 operaciones) y ahí se rompió: corre, dice
     SUCCESS, y los comentarios se pierden. Son ~6 clientes tirados a la basura.
   - Bonus: las fechas que escribía Make estaban **5 horas corridas** (guardaba hora
     de Ecuador en una columna UTC). El webhook nuevo guarda la hora real de Meta.

Ahora recibimos directo de Meta con `/api/social/webhook`, igual que WhatsApp.
Make sale del circuito.

## ORDEN (importante)

El paso 3 (cambiar la URL del webhook en Meta) **va al final**. Meta solo permite UNA
URL de callback por objeto por app: en cuanto la cambies, el camino viejo se corta.
Haz primero el secreto y el token, y recién ahí muévela.

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

## Paso 2 — El token: de PÁGINA, derivado de un Usuario del Sistema

Son **dos capas**, y confundirlas es lo que nos costó el mes:

- El **Usuario del Sistema** da la propiedad de "no caduca".
- Pero el Send API (`/me/messages`) exige un token **de PÁGINA**. Con el token del
  usuario del sistema, `me` es el usuario del sistema, no la página.

Entonces: se genera el token del usuario del sistema **y con ese se pide el token de
la página**. El token de página heredado NO caduca. Ese último es el que se guarda.

**No sirve repetir tal cual el arreglo del CAPI de INDSTORE.** Allá alcanzó con
asignar el activo porque el token ya tenía los permisos correctos (`ads_management`).
Acá los permisos son otros, y los permisos de un token de usuario del sistema se
fijan **al generarlo**: asignar la Página como activo NO le agrega permisos a un
token ya emitido. Hay que asignar activos **y además** regenerar.

1. business.facebook.com → Configuración del negocio → Usuarios → **Usuarios del
   sistema**. Sirve el que ya existe (*Conversions API System User*), en el negocio
   donde viven los activos (**Mandarina Lab**, el mismo de los pixels).
2. **Agregar activos** a ese usuario: la **Página de Facebook** (control total) y la
   **cuenta de Instagram**. — esta parte SÍ es igual que en el CAPI.
3. **Generar nuevo token** para ese usuario, eligiendo la app de siempre, marcando:
   - `pages_messaging` — contestar DM de Messenger
   - `pages_manage_metadata` — suscribir la página al webhook
   - `pages_read_engagement` — leer publicaciones y comentarios
   - `pages_show_list`
   - `instagram_basic`
   - `instagram_manage_messages` — DM de Instagram
   - `instagram_manage_comments` — comentarios y respuestas privadas
4. Con ESE token, pedir el de la página (Graph API Explorer o el navegador):

   ```
   GET https://graph.facebook.com/v19.0/me/accounts?access_token=TOKEN_DEL_SYSTEM_USER
   ```

   Devuelve la página con su `id` y su `access_token`. **Ese `access_token` es el que
   se guarda.** (Si ya sabes el id: `GET /{page-id}?fields=access_token&access_token=…`)

5. Guardarlo en Supabase (SQL Editor de `mandarina-DATA`). No hace falta redesplegar:
   el código lo lee de ahí y lo cachea 5 minutos.

```sql
update inbox.app_config
   set valor = 'EL_TOKEN_DE_PAGINA', actualizado_at = now()
 where clave = 'fb_page_token';
```

Para comprobar que quedó bien (debe decir `expires_at: 0` = nunca):

```
GET https://graph.facebook.com/v19.0/debug_token?input_token=EL_TOKEN_DE_PAGINA&access_token=EL_TOKEN_DE_PAGINA
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
