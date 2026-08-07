# HANDOFF — Fase 2: el candado de los inbox

Fecha: 2026-08-07. Escrito al cerrar las Fases 0 y 1.

- Spec: `docs/superpowers/specs/2026-08-06-login-crm-y-pedido-en-inbox-design.md`
- Plan ejecutado: `docs/superpowers/plans/2026-08-07-fase-0-1-identidad-compartida.md`
- Repo del trabajo hecho: `MANDARINACRM`. Repo de la Fase 2: **`wa-inbox-next`** (proyecto Vercel `wa-inbox-v2`).

---

## 1. La restricción que manda sobre todo

> **BAJO NINGÚN CONCEPTO puede afectarse el envío o la recepción de mensajes de
> ningún inbox, ni la creación de pedidos.**

No es un deseo: es la regla que define cómo se construye la Fase 2 (§6 del spec).
Hoy ya se cumplió una vez, y se cumplió porque se midió, no porque se supuso.

## 2. Qué quedó funcionando (Fases 0 y 1)

Todo esto está **vivo en producción** y verificado:

| Pieza | Estado |
|---|---|
| `crm.apps.mandarinaec.com` | sirviendo, con certificado |
| `inbox.apps.mandarinaec.com` | sirviendo (apunta a `wa-inbox-v2`) |
| `ind-inbox.apps.mandarinaec.com` | sirviendo (apunta a `ind-inbox-v2`) |
| Cookie `mp_sesion` | `Domain=.apps.mandarinaec.com` desde los hosts de ese dominio |
| `crm.usuarios.accesos` | `text[] NOT NULL default '{}'`, migración `20260807052954` |
| Permisos | `INBOX_MANDARINA`, `INBOX_INDSTORE`, marcables en Usuarios |
| Menú del CRM | dos entradas, visibles solo con el permiso |
| `lib/volver.js` | lista blanca de destinos tras el login |

DNS en **GoDaddy** (`ns23`/`ns24.domaincontrol.com`), tres CNAME a
`cname.vercel-dns.com`. El apex y el `www` son de la tienda Shopify y **no se tocan**.

Commits en `MANDARINACRM`: `56d98b62` (antes) → `bfa5fc59` (después).

### Lo que estas fases NO hacen

**Los inbox siguen sin candado.** El permiso `INBOX_MANDARINA` decide hoy si
**ves el botón**, no si **puedes entrar**. Cualquiera con la URL sigue leyendo
todas las conversaciones y escribiendo como Mandarina. Eso es la Fase 2.

## 3. ⚠️ La trampa que ya nos mordió una vez, y que la Fase 2 va a heredar

El 7-ago, al encender `COOKIE_DOMINIO`, **el CRM quedó inaccesible desde su URL
vieja** (`mandarina-pro-sales.vercel.app`) durante unos minutos. La causa:

> El navegador **descarta** toda cookie cuyo `Domain` no cubra el host que la
> envía. El host viejo emitía una cookie para `.apps.mandarinaec.com`, que no le
> pertenece. El login respondía 200, la cookie se tiraba, y el middleware
> devolvía a la persona al login. **Sin ningún mensaje de error.** Bucle infinito.

Arreglado en `lib/sesion.js`: `dominioCookie(host)` solo pone `Domain` cuando el
host está bajo `apps.mandarinaec.com`.

**Por qué esto le importa a la Fase 2, y mucho:**

La cookie tiene `Domain=.apps.mandarinaec.com`, o sea que **el navegador solo la
manda a hosts de ese dominio**. En cuanto el inbox exija sesión:

- `inbox.apps.mandarinaec.com` → recibe la cookie ✅
- `wa-inbox-v2.vercel.app` → **NUNCA la recibe** → bucle de login, igual que el del CRM

Y ojo con el detalle que lo hace peligroso: **la URL vieja del inbox no se puede
apagar**, porque ahí llegan los webhooks de Meta.

La salida es separar los dos casos:

- Las **páginas** del host viejo → `308` al host nuevo.
- Las **rutas de webhook y cron** → se quedan donde están, intactas y sin sesión
  (ya están fuera del `matcher`, ver §4).

Si esto se olvida, el síntoma será "no puedo entrar al inbox" y la causa estará
tres capas más abajo. Que no vuelva a pasar.

**Nota relacionada:** los avisos push están atados al origen. Al pasar la gente a
`inbox.apps.mandarinaec.com` cada quien tiene que **volver a dar permiso una
vez**. No afecta enviar ni recibir, pero si nadie avisa parece una caída.

## 4. Cómo se construye el candado, sin romper nada

Las seis reglas del spec (§3), en orden de ejecución:

1. **Inventariar midiendo.** Sacar de los registros de Vercel quién llamó a cada
   una de las 35 rutas en 7 días. **La lista que salga manda.** Cuando el
   inventario y la memoria no coincidan, gana el inventario.
2. **Modo observación.** El middleware se despliega sin bloquear: solo anota qué
   habría rechazado. 24-48 h con tráfico real, incluido un fin de semana. Se
   activa cuando el registro esté en cero rechazos legítimos.
3. **`AUTH_MODO`** con `observar` · `bloquear` · `apagado`. Si algo se rompe de
   madrugada, se cambia la variable en Vercel y vuelve todo en 30 segundos, sin
   commit ni build.
4. **Los webhooks fuera por configuración**, no por lista: excluidos en el
   `matcher`, más una prueba que falle el build si alguien los mete al camino
   protegido. Confirmadas como externas: `/api/webhook`, `/api/social/webhook`,
   `/api/cron/seguimientos`. **`/api/pago-dlocal` sigue sin confirmar** — sale
   del inventario del punto 1.
5. **Nada viejo se borra** hasta que lo nuevo lleve semanas funcionando.
6. **Cada fase se verifica con un mensaje real**: recibir desde un celular,
   contestar desde el inbox, y confirmar `delivered` en `inbox.webhook_eventos`.

### Método que funcionó y conviene repetir

Para comprobar que no se rompió el mensajeo, **no inventes una prueba sintética:
mira el tráfico real posterior al despliegue**.

```sql
select count(*) filter (where direccion='ENTRANTE')  as entrantes,
       count(*) filter (where direccion='SALIENTE')  as salientes,
       count(*) filter (where direccion='SALIENTE' and estado_entrega='failed') as fallidos,
       max(fecha) as ultimo
from inbox.mensajes where fecha > now() - interval '3 hours';
```

⚠️ **Pero conoce su punto ciego, que hoy nos costó caro:** ese tráfico lo generan
los agentes, que entran con `Authorization: Bearer`. **Ninguna persona con
navegador aparece ahí.** Sirve para probar que el mensajeo vive; **no** prueba
que la gente pueda entrar. Para eso hay que mirar la cookie, host por host.

## 5. Decisiones que la Fase 2 tiene que tomar

### 5.1 Dónde se decide el permiso — la más importante

La sesión firmada lleva solo `{ id, rol }`. `accesos` viaja aparte. Hay dos
salidas y **no son equivalentes**:

| | Releer `crm.usuarios` en cada petición | Meter `accesos` en el token |
|---|---|---|
| Revocar el acceso | **inmediato** | **hasta 30 días** (`DIAS_VALIDEZ`) |
| Costo | una consulta por petición | ninguno |

**Recomendación: releer de la base.** Es la única que permite quitarle el acceso
a alguien de verdad. Si se elige el token, hay que bajar `DIAS_VALIDEZ` o
inventar una invalidación — y si no se hace, la revocación deja de funcionar y
nadie se entera hasta que haga falta.

*(Síntoma que ya se ve hoy, inofensivo pero ilustrativo: si le quitas el permiso
a alguien, la entrada del menú le sigue apareciendo hasta que cierre sesión,
porque los datos del navegador solo se reescriben al entrar.)*

### 5.2 `accesos` se escribe sin validar

`rol` pasa por `esRolValido`. `accesos` va crudo del cuerpo de la petición a
Postgres, y los dos escritores no son simétricos:

- `createUsuario` → `Array.isArray(accesos) ? accesos : []` ✅
- `updateUsuario` → `if (accesos !== undefined) patch.accesos = accesos` ❌

Hoy el peor caso es que alguien no vea un botón. **En la Fase 2 esa columna pasa
a autorizar dos aplicaciones**: un `INBOX_MANDRINA` con el dedo torcido se guarda
tal cual, y un `null` revienta contra el `not null` con un 500 crudo de Postgres.
Validar contra la lista de valores permitidos, antes de que la columna mande.

### 5.3 No copies `lib/volver.js` a mano

Tres copias divergentes de un filtro de redirecciones es exactamente cómo nacen
los redirects abiertos. Si los inbox lo necesitan, que sea **una** fuente.

Y hay un detalle que hoy no importa y allá sí: la guardia contra `//` y `/\` mira
el carácter crudo, así que `/%5cevil.com` pasa como ruta interna. En el CRM no es
explotable porque `router.push` no decodifica. **En un `Location:` de servidor o
un `window.location.href` del inbox, sí importaría.**

### 5.4 Volver a Sheets no degrada: borra

La hoja no lleva `accesos` (decidido, y está en el `.sql`). Pero la pantalla de
Usuarios **siempre** manda `accesos` al guardar. Si algún día `DATA_BACKEND`
vuelve a `sheets` — es una palabra en una variable de entorno — la lista se leería
vacía para todos, y **el primer admin que edite a cualquiera por cualquier motivo
le borra los permisos en Supabase**, sin avisar.

Que nadie cambie esa variable en una emergencia creyendo que solo pierde velocidad.

## 6. Lo que el inbox necesita para verificar la sesión

- **`SESSION_SECRET` idéntico** al del CRM. Sin eso la firma no valida y nadie entra.
  ⚠️ Cargado desde PowerShell llega con un BOM invisible y **falla solo en
  producción**. `secretoSesion()` ya lo limpia con `replace(/[^\x21-\x7E]/g, '')`;
  la copia del inbox tiene que conservar esa línea.
- El inbox **solo verifica**, no emite cookies. Necesita `verificarSesion` y el
  secreto; `cookieSesion`/`cookieBorrada` son del CRM.
- Sin sesión, una página del inbox redirige a
  `https://crm.apps.mandarinaec.com/?volver=<url absoluta del inbox>`. Ese
  `volver` ya está soportado y validado contra lista blanca.
- Además de la firma hay que leer `crm.usuarios` para comprobar `activo` y
  `accesos` (§5.1). El inbox ya habla con Supabase y ya lee del schema `crm`.

## 7. Pendientes menores heredados

Ninguno bloquea, todos están en el registro de la sesión:

- Comentarios desactualizados en `app/api/auth/login/route.js:27` y
  `app/page.js:33-35`: describen el contrato que la Fase 2 va a leer. Un
  comentario que miente es peor que ninguno.
- `app/dashboard/layout.js`: ternario con las dos ramas idénticas; en el cajón
  móvil los enlaces de inbox se ven más chicos que el resto.
- `lib/volver.js:34`: no limpia credenciales embebidas del `userinfo`. No es
  bypass —el destino sigue siendo el host permitido— pero
  `https://cualquiercosa@inbox.apps…` se ve entero en la barra de direcciones.
- El chequeo de ruta interna se aflojó: antes exigía `/dashboard`, ahora acepta
  cualquier `/`.

## 8. Después de la Fase 2

- **Fase 3** — PEDIDO MANUAL: la pantalla `nuevo-pedido` del CRM incrustada en el
  panel derecho del inbox (`?embed=1`, `postMessage`, `frame-ancestors`). El
  botón con IA **se conserva** como segundo camino.
- **Fase 4** — `mandi-agent/api/crear-pedido.js`: hoy acepta `POST` de cualquiera
  y **crea pedidos reales en el CRM**. Cerrarlo y hacerle firmar quién vendió, en
  vez del `vendedorId: 'MANDI-WA'` quemado.
- **Fase 5** — repetir 2 y 3 en `ind-inbox-next`.
