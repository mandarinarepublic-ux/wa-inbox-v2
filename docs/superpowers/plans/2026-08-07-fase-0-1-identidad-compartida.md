# Identidad compartida (Fases 0 y 1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar lista la identidad compartida entre el CRM y los inbox — dominios propios, cookie de sesión que cruza subdominios, y el permiso por app (`INBOX_MANDARINA` / `INBOX_INDSTORE`) administrable desde el CRM.

**Architecture:** Todo el trabajo ocurre en el repo `MANDARINACRM`. Los inbox no se tocan en este plan: aquí solo se construye lo que ellos van a consumir después. Cada cambio es aditivo y está apagado por defecto (variable de entorno vacía = comportamiento de hoy), así que ninguna tarea puede alterar el CRM en producción hasta que se encienda a propósito.

**Tech Stack:** Next.js (App Router), Node 24, Supabase (schema `crm`), Vercel. Pruebas con el runner de Node (`node --test`), sin dependencias nuevas — el mismo patrón que ya usa `wa-inbox-next`.

## Global Constraints

- **Repo de este plan: `C:\Users\RodrigoWork\Desktop\MANDARINACRM`** (proyecto Vercel `mandarina-pro-sales`). Producción = `main`.
- **BAJO NINGÚN CONCEPTO puede afectarse el envío o la recepción de mensajes de ningún inbox, ni la creación de pedidos.** En este plan los inbox no se tocan; la regla se cumple sola, pero cualquier cambio que la ponga en duda se detiene.
- Trabajar **siempre en `main`**, sin ramas. Commit apenas algo funcione; push antes de cerrar.
- Los valores exactos, copiados del spec `docs/superpowers/specs/2026-08-06-login-crm-y-pedido-en-inbox-design.md`:
  - Dominios: `crm.apps.mandarinaec.com`, `inbox.apps.mandarinaec.com`, `ind-inbox.apps.mandarinaec.com`
  - Cookie: `Domain=.apps.mandarinaec.com`
  - Permisos: `INBOX_MANDARINA`, `INBOX_INDSTORE`
  - Columna nueva: `crm.usuarios.accesos` de tipo `text[]`, `default '{}'`
- Los dominios se agregan con `vercel domains add`, **nunca** con `vercel alias set`.
- `SESSION_SECRET` y `COOKIE_DOMINIO` cargados desde PowerShell llegan con un BOM invisible: toda lectura de esas variables pasa por un `.replace(/[^\x21-\x7E]/g, '')`.
- Español ecuatoriano con tuteo en comentarios, mensajes de commit y textos de pantalla. Nada de voseo.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `package.json` | agregar el script `test` | 1 |
| `tests/sesion.test.js` | pruebas de la cookie (crear) | 1 |
| `lib/sesion.js` | agregar `Domain` configurable a la cookie (modificar) | 1 |
| `docs/sql/2026-08-07-usuarios-accesos.sql` | migración de la columna (crear) | 3 |
| `lib/db/usuarios.js` | leer y escribir `accesos` (modificar) | 3 |
| `app/api/usuarios/route.js` | aceptar `accesos` al crear y editar (modificar) | 3 |
| `app/dashboard/usuarios/page.js` | casillas de acceso a los inbox (modificar) | 4 |
| `app/dashboard/layout.js` | entradas de menú a los inbox (modificar) | 5 |
| `tests/volver.test.js` | pruebas de la lista blanca (crear) | 6 |
| `lib/volver.js` | validar el destino de regreso (crear) | 6 |
| `app/page.js` | usar `volverSeguro` tras el login (modificar) | 6 |

---

## Task 1: Cookie de sesión con dominio configurable

Hoy `cookieSesion()` emite una cookie **host-only**: solo vale para el host exacto que la puso. Para que el inbox la reciba tiene que llevar `Domain=.apps.mandarinaec.com`. El cambio va detrás de una variable de entorno: **si `COOKIE_DOMINIO` está vacía, la cookie sale exactamente igual que hoy**, así se puede desplegar sin que pase nada.

**Files:**
- Modify: `package.json`
- Create: `tests/sesion.test.js`
- Modify: `lib/sesion.js:83-100` (`cookieSesion` y `cookieBorrada`)

**Interfaces:**
- Consumes: nada.
- Produces: `dominioCookie(): string` — devuelve el dominio limpio o `''`. `cookieSesion(token: string): string` y `cookieBorrada(): string` mantienen su firma; ahora incluyen `Domain=…` cuando la variable está puesta.

- [ ] **Step 1: Agregar el script de pruebas**

En `package.json`, dentro de `"scripts"`, agregar la línea (misma forma que en `wa-inbox-next`):

```json
"test": "node --test tests/*.test.js"
```

- [ ] **Step 2: Escribir la prueba que falla**

Crear `tests/sesion.test.js`:

```js
// Pruebas de la cookie de sesión. Corren con `npm test` (runner de Node, sin
// dependencias). Lo que se prueba es la FORMA de la cabecera Set-Cookie, que es
// lo que decide si el inbox recibe la sesión o no.
const test = require('node:test')
const assert = require('node:assert')

// lib/sesion.js es ESM; se importa dinámicamente y se recarga por prueba para
// que cada una vea su propio valor de COOKIE_DOMINIO.
async function cargarSesion() {
  const mod = await import(`../lib/sesion.js?v=${Math.random()}`)
  return mod
}

test('sin COOKIE_DOMINIO la cookie sale host-only, como hoy', async () => {
  delete process.env.COOKIE_DOMINIO
  const { cookieSesion } = await cargarSesion()
  const c = cookieSesion('tok')
  assert.ok(!c.includes('Domain='), `no debía traer Domain: ${c}`)
  assert.ok(c.includes('mp_sesion=tok'))
  assert.ok(c.includes('HttpOnly'))
})

test('con COOKIE_DOMINIO la cookie vale para todos los subdominios', async () => {
  process.env.COOKIE_DOMINIO = '.apps.mandarinaec.com'
  const { cookieSesion } = await cargarSesion()
  assert.ok(cookieSesion('tok').includes('Domain=.apps.mandarinaec.com'))
})

test('la cookie que BORRA lleva el mismo Domain', async () => {
  // Sin esto el navegador borra la cookie host-only y deja viva la del dominio
  // compartido: cerrar sesión no cerraría nada.
  process.env.COOKIE_DOMINIO = '.apps.mandarinaec.com'
  const { cookieBorrada } = await cargarSesion()
  const c = cookieBorrada()
  assert.ok(c.includes('Domain=.apps.mandarinaec.com'))
  assert.ok(c.includes('Max-Age=0'))
})

test('el BOM invisible de PowerShell no rompe el dominio', async () => {
  process.env.COOKIE_DOMINIO = '\uFEFF.apps.mandarinaec.com'
  const { cookieSesion } = await cargarSesion()
  assert.ok(cookieSesion('tok').includes('Domain=.apps.mandarinaec.com'))
})
```

- [ ] **Step 3: Correr la prueba y ver que falla**

```bash
cd C:\Users\RodrigoWork\Desktop\MANDARINACRM
npm test
```

Esperado: FALLA en las tres últimas — la cabecera no incluye `Domain=`.

- [ ] **Step 4: Implementar el cambio mínimo**

En `lib/sesion.js`, reemplazar `cookieSesion` y `cookieBorrada` por:

```js
/**
 * Dominio de la cookie. Vacío = host-only (lo de siempre).
 *
 * Se pone `.apps.mandarinaec.com` para que la MISMA sesión valga en el CRM y en
 * los inbox: son subdominios del mismo sitio. Un nivel más abajo que
 * `.mandarinaec.com` a propósito — ese es el dominio de la tienda Shopify, y la
 * cookie viajaría también a Shopify sin ninguna necesidad.
 */
export function dominioCookie() {
  return String(process.env.COOKIE_DOMINIO || '').replace(/[^\x21-\x7E]/g, '')
}

function partesBase() {
  const partes = ['Path=/', 'HttpOnly', 'SameSite=Lax']
  const dom = dominioCookie()
  if (dom) partes.push(`Domain=${dom}`)
  if (process.env.NODE_ENV === 'production') partes.push('Secure')
  return partes
}

/** Cabecera Set-Cookie de la sesión. HttpOnly = el JS de la página no la lee. */
export function cookieSesion(token) {
  return [
    `${COOKIE_SESION}=${token}`,
    `Max-Age=${DIAS_VALIDEZ * 24 * 60 * 60}`,
    ...partesBase(),
  ].join('; ')
}

/** Cabecera Set-Cookie que BORRA la sesión. */
export function cookieBorrada() {
  return [`${COOKIE_SESION}=`, 'Max-Age=0', ...partesBase()].join('; ')
}
```

- [ ] **Step 5: Correr las pruebas y ver que pasan**

```bash
npm test
```

Esperado: 4 pruebas en verde.

- [ ] **Step 6: Comprobar que el CRM sigue compilando**

```bash
npm run build
```

Esperado: build exitoso.

- [ ] **Step 7: Commit**

```bash
git add package.json tests/sesion.test.js lib/sesion.js
git commit -m "feat(sesion): permitir compartir la cookie entre subdominios via COOKIE_DOMINIO"
git push origin main
```

> Sin `COOKIE_DOMINIO` en Vercel, este despliegue **no cambia nada** en producción. Se enciende en la Tarea 2.

---

## Task 2: Dominios en Vercel y encendido de la cookie

Tarea de configuración, no de código. Es la única que toca DNS.

**Files:** ninguno (configuración de Vercel y del DNS de `mandarinaec.com`).

**Interfaces:**
- Consumes: `COOKIE_DOMINIO` de la Tarea 1.
- Produces: los tres dominios respondiendo, y la cookie emitida con `Domain=.apps.mandarinaec.com`.

- [ ] **Step 1: Averiguar dónde se administra el DNS de mandarinaec.com**

```bash
nslookup -type=NS mandarinaec.com
```

Anotar el proveedor que salga (registrador, Cloudflare, Shopify…). Ahí se agregan los registros del paso 2.

- [ ] **Step 2: Crear los tres registros CNAME**

En el panel de DNS, tres registros nuevos apuntando a Vercel:

| Nombre | Tipo | Valor |
|---|---|---|
| `crm.apps` | CNAME | `cname.vercel-dns.com` |
| `inbox.apps` | CNAME | `cname.vercel-dns.com` |
| `ind-inbox.apps` | CNAME | `cname.vercel-dns.com` |

**No se toca el registro del apex (`mandarinaec.com`) ni el de `www`:** esos son de la tienda Shopify y deben quedar exactamente como están.

- [ ] **Step 3: Agregar cada dominio a su proyecto de Vercel**

```bash
cd C:\Users\RodrigoWork\Desktop\MANDARINACRM
vercel domains add crm.apps.mandarinaec.com mandarina-pro-sales

cd C:\Users\RodrigoWork\Desktop\wa-inbox-next
vercel domains add inbox.apps.mandarinaec.com wa-inbox-v2

cd C:\Users\RodrigoWork\Desktop\ind-inbox-next
vercel domains add ind-inbox.apps.mandarinaec.com ind-inbox-v2
```

Nunca `vercel alias set`: un alias fijado no sigue a los despliegues nuevos y el proyecto queda sirviendo una versión vieja.

- [ ] **Step 4: Verificar que los tres responden**

```bash
curl -sI https://crm.apps.mandarinaec.com | head -1
curl -sI https://inbox.apps.mandarinaec.com | head -1
curl -sI https://ind-inbox.apps.mandarinaec.com | head -1
```

Esperado: los tres devuelven una respuesta HTTP (200 o 307), no un error de DNS.

- [ ] **Step 5: Verificar que las URLs viejas SIGUEN funcionando**

```bash
curl -sI https://mandarina-pro-sales.vercel.app | head -1
curl -sI https://wa-inbox-v2.vercel.app/api/plantillas | head -1
```

Esperado: siguen respondiendo. **Esto es lo que garantiza que los webhooks de Meta no se enteren del cambio.** Si alguna dejó de responder, detenerse aquí.

- [ ] **Step 6: Poner COOKIE_DOMINIO en el proyecto del CRM**

En el panel de Vercel de `mandarina-pro-sales`, entorno **Production**:

```
COOKIE_DOMINIO=.apps.mandarinaec.com
```

Ponerla desde el panel web y no desde PowerShell, para no arrastrar el BOM. (Si igual se cuela, `dominioCookie()` lo limpia.)

- [ ] **Step 7: Redesplegar y comprobar la cookie**

Redesplegar producción desde el panel de Vercel. Después, entrar a `https://crm.apps.mandarinaec.com`, hacer login, y en las herramientas del navegador (Application → Cookies) confirmar que `mp_sesion` muestra `Domain = .apps.mandarinaec.com`.

- [ ] **Step 8: Comprobar que el CRM sigue funcionando entero**

Entrar a Historial, abrir un pedido y volver. Sin errores 401.

> Aviso esperado: como la cookie cambia de forma, **la sesión abierta se pierde una vez** y hay que volver a entrar. Pasa una sola vez, a cada persona.

---

## Task 3: Columna `accesos` y capa de datos

**Files:**
- Create: `docs/sql/2026-08-07-usuarios-accesos.sql`
- Modify: `lib/db/usuarios.js` (`toUsuarioPublico`, `validateLogin`, y el guardado)
- Modify: `app/api/usuarios/route.js`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `validateLogin()` devuelve además `accesos: string[]`; `toUsuarioPublico()` devuelve además `ACCESOS: string[]`. La API de usuarios acepta `accesos: string[]` al crear y editar.

> **Decisión:** `accesos` vive **solo en Supabase**. El espejo en Sheets es respaldo y no guarda esta columna: el permiso se relee de Supabase en cada petición, así que no hay nada que reconciliar. Documentarlo en el comentario de la migración.

- [ ] **Step 1: Escribir la migración**

Crear `docs/sql/2026-08-07-usuarios-accesos.sql`:

```sql
-- Permiso por aplicación, decidido persona por persona desde el CRM.
-- Hermana de `areas` y `tiendas`: mismo tipo, misma pantalla.
-- Valores válidos: 'INBOX_MANDARINA', 'INBOX_INDSTORE'.
--
-- Arranca vacío A PROPÓSITO: nadie entra a ningún inbox hasta que se le dé el
-- permiso. El primer paso después de aplicarla es habilitarse uno mismo.
--
-- Solo Supabase: el espejo en Sheets no lleva esta columna (es respaldo, y el
-- permiso se relee de Supabase en cada petición).
alter table crm.usuarios add column if not exists accesos text[] not null default '{}';
```

- [ ] **Step 2: Aplicar la migración**

Aplicarla con la herramienta de Supabase (`apply_migration`, que la registra sola en `supabase_migrations.schema_migrations`), con el nombre `crm_usuarios_accesos`.

Verificar:

```sql
select column_name, data_type from information_schema.columns
where table_schema='crm' and table_name='usuarios' and column_name='accesos';
```

Esperado: una fila, `ARRAY`.

- [ ] **Step 3: Exponer `accesos` en la capa de datos**

En `lib/db/usuarios.js`, dentro de `toUsuarioPublico`, agregar junto a `TIENDAS`:

```js
    ACCESOS: u.ACCESOS ?? u.accesos ?? [],
```

Y en `validateLogin`, donde hoy se arman `areas` y `tiendas` (alrededor de la línea 172), agregar:

```js
  // Permiso por app. Solo existe en Supabase; desde Sheets llega vacío y esa
  // persona simplemente no entra a ningún inbox hasta que se lo den.
  const accesos = Array.isArray(row.accesos) ? row.accesos : [];
```

…y sumar `accesos` al objeto que devuelve la función, junto a `tiendas`.

- [ ] **Step 4: Escribir `accesos` en la capa de datos**

Sigue en `lib/db/usuarios.js`. Son tres puntos, todos calcados de cómo se trata `tiendas`:

1. En la firma de `updateUsuario` (línea 241), agregar `accesos` a la lista:

```js
  { rol, areas, tiendas, accesos, activo, nombre, codigo, email, username, password }
```

2. En la rama `supabase` de `updateUsuario` (junto a la línea 267):

```js
      // `accesos` es text[] nativo, no CSV: llega ya como arreglo desde la
      // pantalla de Usuarios. Como todo lo demás acá, `undefined` = no tocar.
      if (accesos !== undefined) patch.accesos = accesos;
```

**No se agrega nada a la rama `sheets`**: la columna vive solo en Supabase (ver el comentario de la migración). El `if (x !== undefined)` que ya usa todo este bloque es lo que garantiza que editar el correo de alguien no le borre el acceso.

3. Lo mismo en `createUsuario`: aceptar `accesos` y, en la rama de Supabase, escribirlo (por defecto `[]`).

- [ ] **Step 5: Pasar `accesos` desde la API**

En `app/api/usuarios/route.js`, cuatro líneas exactas:

| Línea | Hoy | Queda |
|---|---|---|
| 54 (POST) | `const { password, rol, areas, tiendas } = body` | `const { password, rol, areas, tiendas, accesos } = body` |
| 75 (POST) | `createUsuario({ nombre, codigo, email, username, password, rol, areas, tiendas })` | `createUsuario({ nombre, codigo, email, username, password, rol, areas, tiendas, accesos })` |
| 92 (PATCH) | `const { id, rol, areas, tiendas, password } = body` | `const { id, rol, areas, tiendas, accesos, password } = body` |
| 155 (PATCH) | `rol, areas, tiendas, activo, email, username, password,` | `rol, areas, tiendas, accesos, activo, email, username, password,` |

- [ ] **Step 6: Comprobar de punta a punta**

```sql
update crm.usuarios set accesos = '{INBOX_MANDARINA}' where username = '<tu usuario>';
```

Luego entrar al CRM, cerrar sesión, volver a entrar, y en la consola del navegador:

```js
JSON.parse(localStorage.getItem('mp_user')).accesos
```

Esperado: `["INBOX_MANDARINA"]`.

- [ ] **Step 7: Commit**

```bash
git add docs/sql/2026-08-07-usuarios-accesos.sql lib/db/usuarios.js app/api/usuarios/route.js
git commit -m "feat(usuarios): permiso por app (accesos) para los inbox"
git push origin main
```

---

## Task 4: Casillas en la pantalla de Usuarios

**Files:**
- Modify: `app/dashboard/usuarios/page.js` (`FORM_VACIO` línea 6-9, el `TiendasPicker` línea 195, la carga del formulario línea 107-114, y el envío línea 143-151)

**Interfaces:**
- Consumes: `ACCESOS` de la Tarea 3.
- Produces: nada que otras tareas consuman.

- [ ] **Step 1: Agregar `accesos` al formulario vacío**

En `FORM_VACIO`, junto a `tiendas`:

```js
  accesos: [],
```

- [ ] **Step 2: Agregar el selector**

Junto a `TiendasPicker` (línea 195), copiando su forma:

```js
  // Acceso a los inbox de WhatsApp. Es un permiso aparte del rol: hay gente que
  // vende y no atiende chats, y al revés.
  const AccesosPicker = ({ valor, onChange }) => (
    <div className="flex gap-2">
      {[
        ['INBOX_MANDARINA', '🍊 Inbox Mandarina'],
        ['INBOX_INDSTORE',  '🏪 Inbox Indstore'],
      ].map(([clave, etiqueta]) => (
        <label key={clave} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all
          ${valor.includes(clave) ? 'border-mandarina-500 bg-mandarina-500/10 text-mandarina-400' : 'border-gray-700 text-gray-500'}`}>
          <input type="checkbox" className="hidden" checked={valor.includes(clave)}
            onChange={e => onChange(e.target.checked ? [...valor, clave] : valor.filter(x => x !== clave))} />
          <span className="text-sm">{etiqueta}</span>
        </label>
      ))}
    </div>
  )
```

- [ ] **Step 3: Cargar el valor al editar**

En la función que llena el formulario de edición (línea 107-114), junto a `tiendas`:

```js
      accesos: Array.isArray(u.ACCESOS) ? u.ACCESOS : [],
```

- [ ] **Step 4: Mandarlo al guardar**

En el `body` del `fetch` de guardado (línea 143-151), junto a `tiendas`:

```js
          accesos: editForm.accesos,
```

Hacer lo mismo en el formulario de creación, si es otro bloque.

- [ ] **Step 5: Pintar el selector**

Donde se renderiza `<TiendasPicker …/>`, agregar debajo, con su etiqueta al estilo de las que ya existen:

```jsx
<AccesosPicker valor={editForm.accesos || []} onChange={v => setEditForm({ ...editForm, accesos: v })} />
```

- [ ] **Step 6: Probar a mano**

`npm run dev`, entrar a `/dashboard/usuarios`, marcar `🍊 Inbox Mandarina` a un usuario de prueba, guardar, recargar la página y confirmar que la casilla sigue marcada. Después:

```sql
select username, accesos from crm.usuarios where username = '<el de prueba>';
```

Esperado: `{INBOX_MANDARINA}`.

- [ ] **Step 7: Comprobar que no se borra sin querer**

Editarle **solo el correo** a ese mismo usuario y guardar. Volver a consultar: `accesos` debe seguir intacto. (Es lo que protege el `...(Array.isArray(...))` de la Tarea 3.)

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/usuarios/page.js
git commit -m "feat(usuarios): casillas de acceso a los inbox en la pantalla de usuarios"
git push origin main
```

---

## Task 5: Entradas de menú a los inbox

Los inbox son otras aplicaciones, así que estas entradas son **enlaces externos** y abren en pestaña nueva. Eso obliga a dos cambios: marcar el ítem como externo, y que la visibilidad dependa de `accesos` y no del rol.

**Files:**
- Modify: `app/dashboard/layout.js` (`NAV_ALL` línea 11-28, `getNavItems` línea 42-50, `ActiveLink` línea 53-95, y la llamada de la línea 138)

**Interfaces:**
- Consumes: `accesos` del objeto `user` (Tarea 3).
- Produces: `getNavItems(user)` — **ojo, cambia la firma**: antes recibía `rol` (un string), ahora recibe el objeto `user` completo.

- [ ] **Step 1: Agregar los dos ítems**

Al final de `NAV_ALL`:

```js
  // Los inbox son OTRAS aplicaciones: se abren en pestaña nueva y no se pintan
  // como "activas" nunca. Quién las ve NO depende del rol sino de `accesos`,
  // que se marca por persona en la pantalla de Usuarios.
  { href:'https://inbox.apps.mandarinaec.com',     label:'Inbox Mandarina', icon:'🍊', externo:true, acceso:'INBOX_MANDARINA' },
  { href:'https://ind-inbox.apps.mandarinaec.com', label:'Inbox Indstore',  icon:'🏪', externo:true, acceso:'INBOX_INDSTORE' },
```

(No llevan `roles`: se filtran por `acceso`.)

- [ ] **Step 2: Filtrar por acceso**

Reemplazar `getNavItems` por:

```js
function getNavItems(user) {
  const rol = user?.rol
  const accesos = Array.isArray(user?.accesos) ? user.accesos : []
  // Un ítem con `acceso` se muestra solo si la persona lo tiene marcado; el
  // resto sigue filtrándose por rol, igual que siempre.
  const all = NAV_ALL.filter(n => (n.acceso ? accesos.includes(n.acceso) : n.roles.includes(rol)))
  const priority = ROL_PRIORITY[rol] || []
  if (!priority.length) return all
  const inicio = all.find(n => n.href === '/dashboard')
  const prioItems = priority.map(slug => all.find(n => n.href.includes(slug))).filter(Boolean)
  const rest = all.filter(n => n.href !== '/dashboard' && !prioItems.includes(n))
  return [inicio, ...prioItems, ...rest].filter(Boolean)
}
```

- [ ] **Step 3: Actualizar la llamada**

Línea 138: `const navItems = getNavItems(user.rol)` pasa a ser:

```js
  const navItems = getNavItems(user)
```

- [ ] **Step 4: Que `ActiveLink` sepa abrir enlaces externos**

Al inicio del cuerpo de `ActiveLink`, antes de lo que ya hace, agregar:

```jsx
  // Enlace a otra aplicación: <a> con target y rel, nunca <Link> (que intentaría
  // navegar dentro del CRM). `noopener` evita que la pestaña nueva pueda tocar
  // esta ventana.
  if (item.externo) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer"
         onClick={() => setMenuOpen(false)}
         className={variant === 'menu'
           ? 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-all'
           : 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-all'}>
        <span>{item.icon}</span>
        <span className="text-sm">{item.label}</span>
        <span className="ml-auto text-xs text-gray-600">↗</span>
      </a>
    )
  }
```

- [ ] **Step 5: Probar los dos estados**

```bash
npm run dev
```

Con `accesos = '{INBOX_MANDARINA}'` en tu usuario (y sesión reiniciada para que `mp_user` se actualice): en el menú aparece **Inbox Mandarina** y **no** aparece Inbox Indstore. Hacer clic y confirmar que abre en pestaña nueva.

Después:

```sql
update crm.usuarios set accesos = '{}' where username = '<tu usuario>';
```

Cerrar sesión, entrar de nuevo: **ninguna** de las dos entradas aparece. Devolverse el permiso al terminar.

- [ ] **Step 6: Comprobar que el resto del menú no cambió**

Con un usuario de rol `VENDEDOR`, confirmar que ve exactamente los mismos ítems que antes, en el mismo orden.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/layout.js
git commit -m "feat(menu): entradas a los inbox segun el permiso de cada persona"
git push origin main
```

---

## Task 6: Volver al inbox después del login

Para que el inbox pueda mandar a alguien a autenticarse y recuperarlo, el login tiene que aceptar una URL absoluta de destino. Eso **obliga** a una lista blanca: sin ella es un redirect abierto y cualquiera podría usar tu página de login para llevar gente a otro sitio.

**Files:**
- Create: `tests/volver.test.js`
- Create: `lib/volver.js`
- Modify: `app/page.js` (donde hoy se lee el parámetro `volver` tras el login)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `volverSeguro(destino: string | null): string` — devuelve una URL/ruta segura a la que redirigir, o `'/dashboard'` si el destino no es de confianza. Nunca lanza.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/volver.test.js`:

```js
// El parámetro `volver` viene de la URL, o sea del mundo exterior. Estas pruebas
// son la lista de trucos conocidos para colarse; si alguna se cae, tenemos un
// redirect abierto en la página de login.
const test = require('node:test')
const assert = require('node:assert')

async function cargar() {
  const mod = await import('../lib/volver.js')
  return mod.volverSeguro
}

test('sin destino va al tablero', async () => {
  const volverSeguro = await cargar()
  assert.strictEqual(volverSeguro(null), '/dashboard')
  assert.strictEqual(volverSeguro(''), '/dashboard')
})

test('una ruta interna se respeta', async () => {
  const volverSeguro = await cargar()
  assert.strictEqual(volverSeguro('/dashboard/historial'), '/dashboard/historial')
})

test('los inbox de la lista blanca se aceptan', async () => {
  const volverSeguro = await cargar()
  assert.strictEqual(
    volverSeguro('https://inbox.apps.mandarinaec.com/inbox'),
    'https://inbox.apps.mandarinaec.com/inbox',
  )
  assert.strictEqual(
    volverSeguro('https://ind-inbox.apps.mandarinaec.com/'),
    'https://ind-inbox.apps.mandarinaec.com/',
  )
})

test('un sitio ajeno se rechaza', async () => {
  const volverSeguro = await cargar()
  assert.strictEqual(volverSeguro('https://evil.com/roba'), '/dashboard')
})

test('el truco del sufijo se rechaza', async () => {
  // inbox.apps.mandarinaec.com.evil.com NO es nuestro dominio, aunque lo parezca
  // si uno compara con "empieza por" o "contiene".
  const volverSeguro = await cargar()
  assert.strictEqual(volverSeguro('https://inbox.apps.mandarinaec.com.evil.com/'), '/dashboard')
})

test('el truco de la barra doble se rechaza', async () => {
  // '//evil.com' es una URL relativa al protocolo: el navegador la lee como
  // https://evil.com, pero "empieza con /" la daría por interna.
  const volverSeguro = await cargar()
  assert.strictEqual(volverSeguro('//evil.com'), '/dashboard')
  assert.strictEqual(volverSeguro('/\\evil.com'), '/dashboard')
})

test('una basura cualquiera no revienta', async () => {
  const volverSeguro = await cargar()
  assert.strictEqual(volverSeguro('http://['), '/dashboard')
})
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npm test
```

Esperado: FALLA — `lib/volver.js` no existe.

- [ ] **Step 3: Implementar**

Crear `lib/volver.js`:

```js
// A dónde mandar a alguien después del login.
//
// El destino viaja en la URL (`?volver=…`) porque el inbox, que es OTRA
// aplicación, necesita recuperar a la persona después de autenticarla acá. Eso
// significa aceptar URLs absolutas — y aceptar URLs absolutas sin filtrar es
// exactamente un redirect abierto: alguien manda a tu equipo un enlace a TU
// página de login que termina depositándolos en otro sitio.
//
// Por eso la lista es cerrada y se compara el HOST COMPLETO, nunca "empieza
// con" ni "contiene": `inbox.apps.mandarinaec.com.evil.com` pasaría esas dos.

const DESTINO_POR_DEFECTO = '/dashboard'

const HOSTS_PERMITIDOS = new Set([
  'inbox.apps.mandarinaec.com',
  'ind-inbox.apps.mandarinaec.com',
  'crm.apps.mandarinaec.com',
])

export function volverSeguro(destino) {
  const d = String(destino || '').trim()
  if (!d) return DESTINO_POR_DEFECTO

  // Ruta interna. Se exige que empiece por '/' y que el segundo carácter NO sea
  // '/' ni '\': '//evil.com' y '/\evil.com' son absolutas disfrazadas.
  if (d.startsWith('/')) {
    return (d[1] === '/' || d[1] === '\\') ? DESTINO_POR_DEFECTO : d
  }

  try {
    const u = new URL(d)
    if (u.protocol !== 'https:') return DESTINO_POR_DEFECTO
    if (!HOSTS_PERMITIDOS.has(u.hostname)) return DESTINO_POR_DEFECTO
    return u.toString()
  } catch {
    return DESTINO_POR_DEFECTO
  }
}
```

- [ ] **Step 4: Correr las pruebas**

```bash
npm test
```

Esperado: las 7 de `volver.test.js` en verde, más las 4 de `sesion.test.js`.

- [ ] **Step 5: Usarlo en la página de login**

En `app/page.js`, las líneas **35-36** dicen hoy:

```js
      const volver = new URLSearchParams(window.location.search).get('volver')
      router.push(volver && volver.startsWith('/dashboard') ? volver : '/dashboard')
```

Se reemplazan por:

```js
      // El destino ya no es solo interno: el inbox es OTRA aplicación y también
      // manda gente acá. `volverSeguro` decide qué se acepta (lib/volver.js).
      const destino = volverSeguro(new URLSearchParams(window.location.search).get('volver'))
      if (destino.startsWith('/')) router.push(destino)
      else window.location.href = destino   // otra app: navegación completa, no router
```

Y arriba, junto a los demás imports:

```js
import { volverSeguro } from '@/lib/volver'
```

> Ojo con el cambio de comportamiento: hoy solo se aceptan rutas que empiezan con `/dashboard`. Con `volverSeguro` se acepta **cualquier ruta interna** (`/…`) más los tres hosts de la lista. Es a propósito, y por eso las pruebas del paso 1 cubren los trucos de `//evil.com` y del sufijo.

- [ ] **Step 6: Probar a mano**

Con `npm run dev`:

1. Entrar a `http://localhost:3000/?volver=/dashboard/historial`, hacer login → cae en Historial.
2. Entrar a `http://localhost:3000/?volver=https://evil.com`, hacer login → cae en `/dashboard`, **no** en evil.com.

- [ ] **Step 7: Compilar y commitear**

```bash
npm run build
git add tests/volver.test.js lib/volver.js app/page.js
git commit -m "feat(login): volver al inbox tras entrar, con lista blanca de destinos"
git push origin main
```

---

## Verificación de la fase completa

Con todo desplegado, y antes de dar por cerradas las Fases 0 y 1:

- [ ] `npm test` en el CRM: 11 pruebas en verde.
- [ ] La cookie `mp_sesion` se emite con `Domain=.apps.mandarinaec.com`.
- [ ] `https://mandarina-pro-sales.vercel.app` y `https://wa-inbox-v2.vercel.app` **siguen respondiendo** (los webhooks de Meta dependen de eso).
- [ ] Quitarse el permiso a uno mismo hace desaparecer la entrada de menú; devolvérselo la trae de vuelta.
- [ ] Crear un pedido de prueba en el CRM y verlo en Historial: **nada del flujo de pedidos cambió**.
- [ ] Mandar un mensaje al inbox desde un celular y contestarlo desde el inbox; confirmar `delivered` en `inbox.webhook_eventos`. En esta fase el inbox no se tocó, así que esto tiene que pasar sin sorpresas — es la línea base contra la que se compara la Fase 2.

## Qué queda para el siguiente plan

- **Fase 2** — el candado del inbox MANDI. Empieza por el inventario de tráfico de las 35 rutas, y **ese inventario no se puede escribir por adelantado**: sale de medir los registros reales de Vercel. Con esa medición en la mano se arma el plan.
- **Fase 3** — PEDIDO MANUAL incrustado (`embed=1`, `postMessage`, `frame-ancestors`).
- **Fase 4** — cerrar y firmar `mandi-agent`.
- **Fase 5** — repetir 2 y 3 en IND.
