# Diseño — Login del CRM en los inbox + crear pedido con la pantalla del CRM

Repos: `MANDARINACRM` (proyecto Vercel `mandarina-pro-sales`), `wa-inbox-next`
(proyecto `wa-inbox-v2`), `ind-inbox-next` (proyecto `ind-inbox-v2`) y
`mandi-agent`. Producción = `main` en todos. Fecha: 2026-08-06.

**Alcance:** el diseño cubre los DOS inbox. La implementación empieza por MANDI;
IND repite la misma receta después (§11).

---

## 1. Qué se quiere

Tres cosas que resultaron ser una sola:

1. **Que los inbox tengan login**, con los mismos usuarios y el mismo proceso del
   CRM. Nada de un segundo padrón de personas.
2. **Que se decida persona por persona quién entra a cada inbox**, desde el CRM.
3. **Que crear un pedido deje de depender de la IA**: que haya un formulario para
   ingresarlo a mano, al costado de la conversación, para poder copiar y pegar.
   El camino con IA **no se elimina**, pasa a ser el segundo botón (§8, §9).

El punto 3 es el que amarra a los otros dos: el formulario no se construye, **se
reutiliza la pantalla de pedido del CRM tal cual**. Y esa pantalla solo funciona
si quien la abre tiene sesión del CRM.

> Regla que ordena todo el diseño: **no se reimplementa nada del CRM.** Si mañana
> se agrega un campo en `nuevo-pedido`, los inbox lo heredan sin tocarlos.

## 2. El agujero que esto cierra

No es teórico. El 6-ago-2026, desde una terminal y **sin ninguna credencial**, se
hizo un `POST` a `https://wa-inbox-v2.vercel.app/api/saliente` y el mensaje llegó
al celular de destino (`wamid.HBgMNTkzOTg3NDk4NDg5…`, estado `delivered`).

Es decir, hoy cualquiera que conozca la URL puede:

- **leer todas las conversaciones** con todas las clientas (teléfono, dirección,
  cédula cuando la mandaron por chat),
- **escribirles haciéndose pasar por Mandarina o por Republic**.

Y el mismo hueco existe en `mandi-agent/api/crear-pedido.js`: acepta `POST` de
cualquier origen (`Access-Control-Allow-Origin: *`), sin credencial, y **crea
pedidos reales en el CRM** con el token de máquina que guarda del lado del
servidor. Cualquiera puede llenar el CRM de pedidos falsos que entran firmados
como legítimos.

Es el mismo tipo de agujero que se cerró en el CRM el 25-jul (`cf09141`), con el
agravante de que aquí además se puede **escribir**.

## 3. Restricción dura: no se puede romper el mensajeo

> **BAJO NINGÚN CONCEPTO puede afectarse el envío o la recepción de mensajes de
> ningún inbox, ni la creación de pedidos.**

Esto no es una aspiración: son seis reglas que condicionan cómo se construye.

### 3.1 El inventario se mide, no se recuerda

Antes de escribir una línea de middleware, sacar de los registros de Vercel
**quién llamó a cada una de las 35 rutas en los últimos 7 días** y con qué
credenciales. La lista que salga manda. Cuando el inventario y la memoria no
coincidan, gana el inventario.

### 3.2 Modo observación antes de bloquear

El middleware se despliega primero **sin bloquear**. Solo registra "esta petición
la habría rechazado". Corre así 24-48 h con tráfico real, incluido un fin de
semana, y se activa solo cuando el registro esté en cero rechazos legítimos.

### 3.3 Interruptor de pánico sin desplegar

Variable de entorno `AUTH_MODO` con tres valores: `observar` · `bloquear` ·
`apagado`. Si algo se rompe de madrugada, se cambia la variable en Vercel y
vuelve todo en 30 segundos, sin commit ni build.

### 3.4 Los webhooks quedan fuera por diseño

El `matcher` del middleware **excluye las rutas de webhook a nivel de
configuración**, así ni siquiera corre el código de sesión para ellas. Más una
prueba automatizada que falla el build si alguien las mete en el camino
protegido. No puede depender de que nadie se olvide.

Rutas que hoy se sabe que las llama alguien de afuera:

| Ruta | Quién la llama | Cómo se defiende sola |
|---|---|---|
| `/api/webhook` | Meta (WhatsApp) | firma `META_APP_SECRET` |
| `/api/social/webhook` | Meta (FB/IG) | firma `META_APP_SECRET` |
| `/api/cron/seguimientos` | cron de Vercel | `CRON_SECRET` |
| `/api/pago-dlocal` | dLocal | a confirmar en el inventario |

Las otras 31 se clasifican con el inventario de §3.1, **no de memoria**.

### 3.5 Nada viejo se borra hasta que lo nuevo esté probado

El camino con IA no se toca cuando llegue el formulario incrustado. Conviven, se
crea un pedido real por el camino nuevo, se verifica en el CRM, y recién en un
despliegue posterior se decide qué se quita (§9).

### 3.6 Cada fase se verifica con un mensaje real

La prueba de fin de fase no es "compila": es **recibir un mensaje de un celular y
contestarlo desde el inbox**, y confirmar el estado `delivered` en
`inbox.webhook_eventos`. Si eso no pasa, la fase no está terminada y se revierte.

## 4. Una sola identidad

| Pieza | Dónde vive | Quién la usa |
|---|---|---|
| Padrón de usuarios | `crm.usuarios` en Supabase | CRM + los 2 inbox |
| Página de login | **solo la del CRM** | todos |
| Sesión | cookie `mp_sesion` firmada con HMAC | todos |
| Permisos por app | columna `accesos` | el CRM decide, los inbox obedecen |

`lib/sesion.js` del CRM se copia **tal cual** a los dos inbox: son ~100 líneas,
sin dependencias, con Web Crypto porque corre en el runtime Edge. Con el mismo
`SESSION_SECRET` en los tres proyectos, la cookie que emite el CRM la verifican
los inbox sin preguntarle nada a nadie.

**Los inbox nunca ven una contraseña.** No hay lógica de login duplicada ni
bcrypt en tres lugares: el CRM autentica, los demás verifican una firma.

> **Por qué el login tiene que ser el del CRM y no uno propio del inbox:**
> `app/dashboard/nuevo-pedido/page.js:163` saca la identidad de
> `localStorage.getItem('mp_user')` y si no está, te expulsa al login. El
> `localStorage` es por origen: solo se escribe si entraste por el origen del
> CRM. Un login propio en el inbox dejaría la sesión válida pero el formulario
> incrustado se caería. Esto no es preferencia, es la razón técnica.

## 5. Dominios

```
crm.apps.mandarinaec.com        → mandarina-pro-sales
inbox.apps.mandarinaec.com      → wa-inbox-v2
ind-inbox.apps.mandarinaec.com  → ind-inbox-v2
```

La cookie pasa a `Domain=.apps.mandarinaec.com` (un cambio en `cookieSesion()` de
`lib/sesion.js` del CRM). Al ser el **mismo sitio**, la cookie viaja sola incluso
dentro del iframe con `SameSite=Lax`.

**Por qué un nivel más abajo y no `.mandarinaec.com` a secas:** ese dominio es la
tienda Shopify. Una cookie ahí viajaría también a Shopify en cada visita a la
tienda desde el navegador del equipo — mandarle el token de sesión a un tercero
sin necesidad. Con `.apps.` la tienda nunca la ve, y el apex no se toca.

Las URLs `.vercel.app` **siguen funcionando**: los webhooks de Meta no hay que
reconfigurarlos.

> ⚠️ Los dominios se agregan con `vercel domains add`, **nunca** con
> `vercel alias set`: un alias fijado no sigue a los despliegues nuevos. Fue la
> causa real de que MÍNTARA sirviera versión vieja.

> ⚠️ `SESSION_SECRET` cargado a Vercel desde PowerShell llega con un BOM
> invisible y la firma falla **solo en producción**. `secretoSesion()` ya limpia
> con `replace(/[^\x21-\x7E]/g, '')`; la copia del inbox tiene que conservar esa
> línea.

## 6. Permiso por app

Columna nueva en `crm.usuarios`, hermana de `areas` y `tiendas` (las tres son
`text[]`):

```sql
alter table crm.usuarios add column accesos text[] default '{}';
```

Valores: `INBOX_MANDARINA`, `INBOX_INDSTORE`.

- **Pantalla de Usuarios del CRM:** dos casillas más, junto a las de tiendas.
- **Menú del CRM:** dos entradas, `INBOX MANDARINA` e `INBOX INDSTORE`, que
  abren el inbox correspondiente en pestaña nueva. Visibles solo para quien
  tenga el permiso.
- **Migración:** se registra en `supabase_migrations.schema_migrations` (nombre
  prefijado `crm_`), que es la tabla única compartida. `apply_migration` la
  registra sola.

Arranca en `'{}'` a propósito: **nadie tiene acceso hasta que se lo den**. El
primer paso tras la migración es habilitarse a uno mismo y al equipo que atiende.

## 7. El candado de los inbox

Copiado del middleware del CRM (`MANDARINACRM/middleware.js`), con tres puertas:

1. **Persona con sesión** → cookie válida + usuario `activo` + `accesos` incluye
   el inbox que corresponde.
2. **Máquina con token** → `Authorization: Bearer $INBOX_API_TOKEN`, comparado en
   tiempo constante, para lo que llame de servidor a servidor.
3. **Rutas públicas** que se defienden solas → §3.4.

Diferencias con el del CRM:

- El `matcher` cubre `/api/:path*`, `/inbox` y `/dashboard` (las páginas que
  sirve hoy la app), **excluyendo los webhooks por configuración**.
- Además de la firma, se lee el usuario de `crm.usuarios` para comprobar `activo`
  y `accesos`. La sesión solo carga `{ id, rol }`, igual que en el CRM: el
  permiso que manda es el de la base, releído en cada petición.
- Sin sesión, una página redirige a
  `https://crm.apps.mandarinaec.com/?volver=<url absoluta del inbox>`.
- Con sesión pero **sin el permiso**, se muestra "no tienes acceso a este inbox"
  — no una pantalla en blanco ni un 404, que parecen una caída.

### 7.1 El `volver` absoluto necesita lista blanca

Hoy el login del CRM solo acepta rutas internas (`middleware.js:73`). Para volver
al inbox tiene que aceptar una URL absoluta, y eso **obliga a validar contra una
lista blanca** de nuestros subdominios. Sin eso es un redirect abierto:
cualquiera podría usar tu página de login para mandar gente a otro sitio.

## 8. Crear pedido

El botón CREAR de la pestaña Ventas se parte en dos:

- **PEDIDO MANUAL** (principal)
- **CREAR PEDIDO CON IA** (el de hoy, se conserva)

### 8.1 PEDIDO MANUAL

El panel derecho se convierte en un iframe de:

```
https://crm.apps.mandarinaec.com/dashboard/nuevo-pedido?embed=1
  &celular=<telefono del chat>&nombre=<alias o nombre>
```

- `embed=1` le dice al CRM que **oculte su menú y su cabecera** y apile en una
  columna. Es un cambio chico y aislado en la pantalla existente, no una pantalla
  nueva.
- La precarga es solo celular y nombre; el buscador de cliente existente del CRM
  hace el resto (si la cédula ya está, trae dirección, ciudad y correo).
- **La tienda la resuelve el CRM** con `puedeVerTienda` / `tiendasDisponibles`
  según el usuario (`nuevo-pedido/page.js:178`). El inbox no opina.
- Al crear, el CRM hace `postMessage({ pedidoId, montoTotal, url })` al padre. El
  inbox guarda la nota `📦 Pedido … · $…` y marca `idVenta`, **exactamente igual
  que hoy** (`RightPanel.jsx:517-526`).
- El inbox valida el `origin` de cada `postMessage` recibido; el CRM valida el
  suyo al enviarlo.
- Al abrir, el panel se ensancha; al cerrar, recupera el ancho guardado.
- Si la sesión venció, **el login del CRM aparece dentro del mismo panel** en vez
  de expulsarte del inbox. Enmarcar un login es lo que buscan los ataques de
  clickjacking, así que la lista blanca de `frame-ancestors` (§8.3) deja de ser
  opcional.

### 8.2 Lo que se gana sin escribir código

Factura, pagos, mapa, fecha de entrega prometida, dirección con la plantilla de
la empresa, varios productos en un mismo pedido, y el vendedor real. Todo eso ya
existe en el CRM y la IA nunca supo hacerlo.

### 8.3 Permitir el enmarcado

El CRM hoy no manda `X-Frame-Options` ni CSP (no hay `headers()` en
`next.config.js`), así que se puede enmarcar. Se agrega **explícito**:

```
Content-Security-Policy: frame-ancestors 'self'
  https://inbox.apps.mandarinaec.com
  https://ind-inbox.apps.mandarinaec.com
```

Lista blanca, no `*`: solo nuestros inbox pueden enmarcar al CRM.

## 9. `mandi-agent`: cerrar el hueco y firmar quién vendió

Como el botón con IA se conserva (§3.5), su endpoint entra en el trabajo de
seguridad:

1. **Exigir credencial** en `api/crear-pedido.js`: sesión válida o token de
   máquina. Hoy acepta a cualquiera y crea pedidos reales.
2. **Recibir el vendedor** en el cuerpo y mandarlo al CRM, en vez del
   `vendedorId: 'MANDI-WA'` quemado (`crear-pedido.js:110`).

> Sin el punto 2, tras el login quedarían pedidos manuales a nombre de la persona
> real y pedidos con IA a nombre de un fantasma. Sería el problema que el login
> venía a resolver, ahora a medias y **más confuso que antes**: no se sabría si
> "MANDI-WA" significa "lo hizo la IA" o "no sabemos quién fue".

## 10. Lo que NO se hace

- No se reimplementa ningún campo, validación, cliente, pago ni factura.
- No se filtran conversaciones por vendedor: quien entra ve todo, como hoy. El
  login sirve para saber **quién hizo cada cosa**, no para esconder chats.
- No se embebe el inbox dentro del CRM. Se evaluó y se descartó: el inbox es de
  tres columnas a pantalla completa, los navegadores **bloquean pedir permiso de
  notificaciones desde un iframe de otro origen** (se perderían los avisos push
  recién construidos), y el formulario quedaría en un iframe dentro de otro
  iframe. La entrada de menú del §6 da el mismo punto de entrada único sin esos
  costos.
- No se fusionan los repos. Si algún día se quiere un solo Next sin iframes, el
  dominio y la sesión compartida son el primer paso de ese camino igual: nada de
  esto se tira.

## 11. Fases

| Fase | Qué | Repos | Por qué ahí |
|---|---|---|---|
| **0** | Dominios + cookie compartida | CRM (+DNS) | Sin esto nada funciona; se verifica antes de seguir |
| **1** | Columna `accesos` + pantalla de usuarios + menú | CRM | Define quién entra, antes de cerrar la puerta |
| **2** | Candado de MANDI (inventario → observar → bloquear) | wa-inbox-next | **Aquí se tapa el hueco.** Vale por sí sola |
| **3** | PEDIDO MANUAL incrustado + `embed=1` + `postMessage` | wa-inbox-next, CRM | Ya con identidad, el pedido sale a nombre de quien es |
| **4** | Cerrar y firmar `mandi-agent` | mandi-agent | Cierra el segundo hueco |
| **5** | Repetir 2 y 3 en IND | ind-inbox-next | Misma receta, otro repo |

Las fases 2 y 3 se sueltan por separado: **la 2 sola ya deja el inbox seguro**,
aunque la 3 no exista todavía.

## 12. Verificación por fase

- **Fase 0:** entrar al CRM por el dominio nuevo, y que la cookie se vea con
  `Domain=.apps.mandarinaec.com`. Las URLs viejas siguen respondiendo.
- **Fase 1:** quitarse el permiso a uno mismo y comprobar que la entrada de menú
  desaparece; devolvérselo.
- **Fase 2:** con `AUTH_MODO=observar`, 24-48 h de registro sin rechazos
  legítimos. Luego `bloquear` y **§3.6: mensaje real que entra y sale**. Probar
  también que una petición sin cookie recibe 401.
- **Fase 3:** crear un pedido real desde el panel y verlo en el CRM con el
  vendedor correcto, con su nota `📦` y su marca 💰 en el inbox.
- **Fase 4:** un `POST` sin credencial a `mandi-agent/api/crear-pedido` debe
  responder 401.
- **Fase 5:** lo mismo de 2 y 3, en IND.

## 13. Riesgos y consecuencias conocidas

1. **El ancho.** `nuevo-pedido` es un asistente de 4 pasos pensado para pantalla
   completa. Aun con `embed=1` y el panel ensanchado, en una laptop de 13" va
   justo. Es el punto más flojo del plan; aceptado a sabiendas.
2. **Los avisos push se re-suscriben.** Las suscripciones están atadas al origen:
   al pasar a `inbox.apps.mandarinaec.com` cada persona tiene que dar permiso una
   vez más. No afecta enviar ni recibir, **pero si nadie avisa parece una
   caída**. Hay que avisarle al equipo antes.
3. **Cerrar la API puede tocar un llamador no inventariado.** Mitigado por §3.1,
   §3.2 y §3.3, que existen exactamente para esto.
4. **Los repos de los inbox son públicos.** Ningún secreto entra al código; todo
   por variables de entorno.

## 14. Fuera de alcance

- Filtrar chats por vendedor (sería otro proyecto, y cambia la forma de trabajar).
- Fusionar los repos en una sola app.
- Quitar el botón con IA (se conserva; se decidirá más adelante, §3.5).
- Las plantillas de re-enganche de REPUBLIC — trabajo aparte, en pausa.
