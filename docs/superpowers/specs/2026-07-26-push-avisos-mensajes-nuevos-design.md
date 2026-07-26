# Avisos de mensajes nuevos por Web Push — Diseño

Fecha: 2026-07-26
Repo: `wa-inbox-next` → proyecto Vercel `wa-inbox-v2`

## 1. El problema

El inbox no avisa de mensajes nuevos. Se pierden leads.

Diagnóstico (2026-07-26, sobre `main` = `bcf369e`):

1. **No hay sonido.** Cero código de audio en el repo: ni `new Audio`, ni archivos
   `.mp3/.wav/.ogg`. Nunca existió.
2. **El popup existe pero no es para mensajes nuevos.** `notificar()`
   (`lib/notif.js:89`) se llama en un solo lugar: `components/App.jsx:413`, para
   avisar de un lead 🔥 caliente cuya ventana de 24h se cierra. Un mensaje
   entrante normal no dispara nada.
3. **Lo único que existe es pasivo:** contador en el título de la pestaña, punto
   rojo en el favicon y badge de la app (`lib/notif.js`).
4. **Y ese aviso pasivo tampoco funciona.** El polling se apaga con la pestaña en
   segundo plano (`App.jsx:249`, `if (document.hidden) stop()`), así que `convs`
   nunca cambia mientras no miras y el contador nunca llega a subir. Al volver,
   `alVolver` lo resetea a 0 antes de que cargue. Camino muerto en la práctica.
5. **El permiso se pide mal.** `pedirPermisoNotif()` corre en un `useEffect` al
   montar (`App.jsx:399`), sin gesto del usuario. Chrome silencia esos pedidos con
   su UI "quieter". Es probable que el permiso nunca se haya concedido.

## 2. Decisiones tomadas

| Decisión | Elegido |
|---|---|
| Alcance del aviso | Web push real: llega con el navegador cerrado |
| Líneas | Solo **MANDI**. REPUBLIC y SOCIAL quedan fuera |
| Aparatos | PC (Windows/Chrome) y Android. **Sin iPhone** |
| Destinatarios | Todo el equipo, mismo aviso. Sin reparto por persona |
| Cuándo suena | Solo cuando **no** estás mirando el inbox |
| Anti-ruido | Uno por conversación, con enfriamiento de 5 minutos |
| Suscripción | Protegida por una clave corta compartida |
| Bug del contador | Se arregla en este mismo trabajo |
| Enfoque descartado | Telegram (más confiable y más barato, pero el aviso no lleva al chat) |
| Enfoque descartado | Trigger de Supabase (un backfill dispararía una avalancha de avisos) |
| Enfoque descartado | OneSignal (otro proveedor y otro gasto; se está cancelando Make) |

### Lo que esto NO va a lograr

Declarado explícitamente para que no haya sorpresas:

- **En Windows, si cierras Chrome y tienes desactivado "Seguir ejecutando
  aplicaciones en segundo plano al cerrar Chrome", no llega nada.** Ningún web
  push lo logra. En Android sí llega siempre.
- **El sonido con el navegador cerrado es el del sistema operativo, no uno
  propio.** La opción de sonido personalizado está muerta en la especificación de
  notificaciones. Un tono distintivo solo es posible con la pestaña abierta.

## 3. Alcance

**Dentro:** avisos de mensajes ENTRANTES de la línea MANDI; suscripción y baja de
aparatos; supresión cuando la app está al frente; arreglo del contador de pestaña.

**Fuera:** login del inbox (ver Riesgos), REPUBLIC, SOCIAL, avisos por reparto de
agente, sonido personalizado con el navegador cerrado.

## 4. Arquitectura

Siete piezas:

| Pieza | Responsabilidad |
|---|---|
| Migración SQL | Tabla `inbox.push_subs` + columna `ultimo_push_at` |
| `lib/push.js` | Firmar y enviar pushes; limpiar suscripciones muertas |
| `app/api/push/subscribe/route.js` | Alta (POST) y baja (DELETE) de un aparato |
| `public/sw.js` | Handlers `push` y `notificationclick` |
| `components/PushToggle.jsx` | Botón 🔔 que pide permiso y suscribe |
| `app/api/webhook/route.js` | Enganche: dispara el push tras guardar el entrante |
| `app/api/push/test/route.js` | Push de prueba sin depender de un cliente real |

Dependencia nueva: `web-push`. Requiere runtime Node — el webhook ya corre en Node
(no declara `runtime = 'edge'`), así que no hay cambio.

## 5. Datos

```sql
create table if not exists inbox.push_subs (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  creado      timestamptz not null default now(),
  fallos      int not null default 0
);

alter table inbox.conversaciones
  add column if not exists ultimo_push_at timestamptz;
```

`ultimo_push_at` sigue la convención ya establecida en esa tabla por
`ultimo_seguimiento_at` y `alerta_ventana_at`.

El enfriamiento vive en la base, **no en memoria**: las funciones de Vercel son
efímeras y un `Set` en RAM daría avisos duplicados desde instancias frías.

## 6. Flujo

```
Cliente escribe a MANDI
  → Meta → POST /api/webhook → 200 inmediato          (sin cambios)
  → waitUntil(procesar())
      → guardarMensajeSupabase                        (ya existe)
      → ¿ultimo_push_at hace menos de 5 min? → sí: no molestar
      → enviarPush() en paralelo a cada suscripción
      → respuesta 404/410 → borrar esa suscripción
      → marcar ultimo_push_at = now()
  → sw.js recibe 'push'
      → ¿hay una ventana del inbox ENFOCADA?
          sí → no mostrar notificación
          no → showNotification(nombre, texto, tag=telefono)
      → en ambos casos: postMessage a las ventanas abiertas
  → cliente recibe el mensaje → load() inmediato → sube el contador
  → tocas la notificación → notificationclick → abre/enfoca /inbox?tel=<telefono>
```

## 7. Detalle por pieza

### `lib/push.js`

```
enviarPush({ titulo, cuerpo, url, tag })
```

- Si faltan las claves VAPID → **no-op silencioso** y devuelve. Esto permite
  desplegar el código antes de configurar nada, sin romper el webhook.
- Lee todas las filas de `inbox.push_subs`.
- Envía en paralelo con `Promise.allSettled`.
- `404` / `410` → la suscripción murió (navegador desinstalado, datos limpiados) →
  se borra la fila.
- `413` → payload muy grande → se recorta el cuerpo a 120 caracteres.
- Cualquier otro error → `console.error` y seguir. **Nunca lanza.**

### `app/api/push/subscribe/route.js`

- `POST` — cuerpo: `{ subscription, clave }`. Valida `clave` contra
  `process.env.PUSH_CLAVE`; si no coincide → `401`. Hace upsert por `endpoint`.
- `DELETE` — cuerpo: `{ endpoint }`. Borra la fila. Sin clave: darse de baja
  siempre debe poder hacerse.

### `public/sw.js`

Se agregan dos handlers. **No se agrega handler de `fetch`** — el archivo declara
en su cabecera que nunca intercepta `/api/*`, y esa propiedad se conserva.

- `push`: parsea el JSON, decide si suprimir según `clients.matchAll({type:'window'})`
  y `focused`, muestra la notificación con `tag` = teléfono (así el segundo aviso
  del mismo chat reemplaza al primero en pantalla), y hace `postMessage`.
- `notificationclick`: cierra la notificación, busca una ventana del inbox ya
  abierta y la enfoca navegando al chat; si no hay ninguna, abre una nueva.

### `components/PushToggle.jsx`

Botón 🔔 en la cabecera de MANDI. Estados: sin soporte / desactivado / pidiendo /
activo. Al hacer click:

1. Pide la clave (un `prompt` simple basta).
2. `Notification.requestPermission()` — **dentro del click**, que es lo que arregla
   el problema 5 del diagnóstico.
3. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
4. `POST /api/push/subscribe`.

Se elimina la llamada `pedirPermisoNotif()` de `App.jsx:399`, que pide permiso sin
gesto y hoy no sirve de nada.

### Enganche en el webhook

Dentro de `procesar()`, después de `guardarMensajeSupabase` y del `registrarContactoEntrante`
(necesitamos que la conversación exista para leer y escribir `ultimo_push_at`).
Va envuelto en `.catch()` como todo lo demás del bucle.

Condiciones para notificar:
- El mensaje es ENTRANTE (todo lo que pasa por `nuevos` lo es).
- `ultimo_push_at` de esa conversación es nulo o tiene más de 5 minutos.

El cuerpo del aviso: nombre del contacto (o teléfono si no hay), y el texto
recortado a 120 caracteres. Si el mensaje es una foto/audio/documento, un
descriptor: "📷 Foto", "🎤 Audio".

### Arreglo del contador de pestaña

**No se toca el polling.** El costo extra sería real y el beneficio nulo. En su
lugar: `App.jsx` escucha `navigator.serviceWorker` con un listener de `message`; al
recibir el aviso del service worker llama a `load()`. El efecto que ya existe en
`App.jsx:321-333` recalcula los no leídos solo, y como `visibilityState` es
`'hidden'` en ese momento, el contador sube. Cero llamadas extra: solo se refresca
cuando de verdad llegó algo.

## 8. Configuración

Cinco variables en Vercel:

| Variable | Para qué |
|---|---|
| `VAPID_PUBLIC_KEY` | Clave pública (servidor) |
| `VAPID_PRIVATE_KEY` | Clave privada (servidor) — secreta |
| `VAPID_SUBJECT` | `mailto:mandarinarepublic@outlook.com` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | La pública otra vez, visible para el navegador |
| `PUSH_CLAVE` | Palabra corta para poder activar avisos |

> ⚠️ **Cargarlas desde el panel web de Vercel, a mano.** Cargarlas por PowerShell
> les pega un BOM invisible que revienta solo en producción (ya pasó con Supabase:
> `TypeError ... ByteString ... 65279`). Este repo no tiene el helper `lib/env.js`
> que se hizo en el CRM para limpiar eso.

Las claves se generan con `npx web-push generate-vapid-keys`.

## 9. Pruebas

- `app/api/push/test/route.js`, protegido con la misma llave del cron que ya usa
  `app/api/cron/seguimientos/route.js:25`. Dispara un push de prueba a todas las
  suscripciones. Sin esto, probar exige que un cliente real escriba.
- Prueba manual del enfriamiento: dos mensajes seguidos del mismo número → un solo
  aviso. Dos números distintos → dos avisos.
- Prueba manual de la supresión: con el inbox al frente no debe sonar; en otra
  ventana sí.
- Verificar que una suscripción muerta se borra sola: activar en un navegador,
  limpiar los datos del sitio, mandar un mensaje, comprobar que la fila desapareció.

## 10. Riesgos

**El inbox no tiene login.** No hay `middleware.js` ni verificación en ninguna ruta:
cualquiera con la URL lee todas las conversaciones con los clientes. El push **no
empeora** esa exposición — los datos ya están abiertos — y `PUSH_CLAVE` evita que un
curioso se suscriba, pero es una curita. El arreglo real es un login, y es un
proyecto aparte que queda registrado acá como deuda.

**Presupuesto de notificaciones de Chrome.** El navegador exige que todo push
recibido muestre algo. Suprimir cuando la ventana está enfocada consume un
presupuesto; si se agota, Chrome muestra un genérico "Este sitio se actualizó en
segundo plano". Se espera que las supresiones sean pocas frente al total. Si
aparece ese mensaje, la salida es mostrar siempre y aceptar el ruido.

**El webhook es crítico.** Todo el código nuevo va dentro de `waitUntil` y con
`.catch()`; un fallo del push no puede afectar la respuesta a Meta ni el guardado
del mensaje. El no-op sin claves VAPID refuerza esto.

## 11. Futuro (no ahora)

- Login del inbox.
- Extender a REPUBLIC y SOCIAL: el disparador ya quedaría escrito y reusable.
- Sonido propio cuando la pestaña está abierta.
