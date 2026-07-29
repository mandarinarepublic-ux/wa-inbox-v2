# HANDOFF — MANDI / REPUBLIC · 27-29 jul 2026

Proyecto Vercel **`wa-inbox-v2`** · repo `mandarinarepublic-ux/wa-inbox-v2` (PÚBLICO) ·
producción = `main`. Último commit desplegado: **`02b0c5d`**.

> Hay un handoff gemelo en `ind-inbox-next/docs/`. Los mismos cuatro bugs de fondo
> salieron en los dos inbox: si tocas uno, revisa el otro.

---

## 1. Qué cambió, en una línea

REPUBLIC dejó de leer WhatsApp Web con una extensión de Chrome y pasó a ser
**un segundo número del mismo inbox**, por Cloud API igual que MANDI. Un solo
panel, dos botones de número. Y en el camino salieron cuatro bugs que llevaban
tiempo mintiendo en pantalla.

## 2. Los números

| Botón | phone_id | Número | WABA |
|---|---|---|---|
| **MANDI** | `1024077200794372` | +593 98 374 5757 | la de siempre |
| **REPUBLIC** | `118582961194601` | +593 97 910 4167 | `110133805380815` |

Definidos en **`lib/canales.js`**, que es la ÚNICA fuente. `/api/saliente` valida
el `Canal` recibido contra esa lista: el navegador no puede inventarse un
`phone_id` y convertirlo en una llamada a Meta con nuestro token.

**`components/RepublicInbox.jsx` fue BORRADO** (1.173 líneas). Leía WhatsApp Web
por extensión de Chrome + un lanzador en `localhost:3098`: dependía de que la
computadora estuviera prendida, con Chrome abierto y la sesión viva. Ya no existe
nada de eso.

## 3. Commits (los relevantes, de abajo hacia arriba)

| Commit | Qué |
|---|---|
| `d550111` | ⚠️ TEMPORAL — ruta para probar envío por un phone_id arbitrario |
| `9ce2573` | **REPUBLIC pasa a Cloud API como segundo número.** Filtro por `phone_id` en todas las lecturas, el webhook guarda `value.metadata.phone_number_id`, `/api/saliente` acepta y valida `Canal` |
| `73b0830` | ⚠️ TEMPORAL — suscribir la app a una WABA |
| `206e9b0` | Las **fotos y plantillas** salían por MANDI aunque el chat fuera REPUBLIC |
| `3bd3f5a` | Un entrante vuelve a poner la conversación en **PENDIENTE** (MANDI nunca tuvo ese código; IND sí desde julio) |
| `198adb0` | Caché del edge a 2 s (antes un entrante tardaba 35-45 s en verse) |
| `99766a3` | Los **envíos automáticos** salen por el número al que escribió el cliente |
| `3d7e86f` | El saludo trataba como "nuevo" **en cada mensaje** + el interruptor no guardaba |
| `02b0c5d` | **ARCHIVAR** no pegaba en clientes que escribieron a los dos números |

---

## 4. Los cuatro bugs, y por qué importan más que su arreglo

Los cuatro son **la misma falla**: *la pantalla decía una cosa y el sistema hacía
otra*. Si vas a agregar algo acá, esto es lo que hay que no repetir.

### 4.1 El ✓ en un envío que falló *(se arregló en IND, `787afcc`)*
El inbox marcaba el chat ATENDIDO y pintaba el visto **antes** de saber si Meta
había aceptado. Un chat sin responder salía de PENDIENTES y nadie lo volvía a
mirar. Regla: el estado se guarda **solo si el envío salió**.

### 4.2 El canal no viajaba en los envíos del servidor
Había **cuatro caminos** hacia `/api/saliente` y solo uno inyectaba el canal.
Primero se coló por el navegador (fotos y plantillas, `206e9b0`), después por el
servidor (`99766a3`): el webhook y el cron no tienen "canal activo" de pestaña,
así que caían al número principal. Un cliente que escribía a REPUBLIC recibía el
saludo **desde MANDI**, otro número.

> ⚠️ `components/App.jsx` **todavía tiene su propio `sendImageUrl`** con `fetch`
> directo, en vez de usar el de `lib/api-client.js`. Es exactamente el camino por
> donde se coló el bug. Mientras exista, cada envío nuevo es otra oportunidad de
> olvidar el `Canal`. **Sacarlo elimina la trampa de raíz.**

### 4.3 La agenda filtrada por canal *(la más cara)*
El webhook y el inbox cargaban los contactos **filtrados por el número
principal**. Un contacto del otro número no aparecía nunca en esa lista, y de ahí
salían tres mentiras seguidas:

- `esNuevoDe()` daba **siempre true** → lo saludaba como nuevo **en cada mensaje**
- `estadoDe()` nunca lo veía 'atendido' → no lo reabría a PENDIENTE
- `modoIAde()` y `ultimoEntranteAtDe()` lo trataban como si no tuviera historia

Y en la pantalla: la lista de chats se filtra por el canal del **mensaje**, pero
el estado vive en la **conversación**, que se filtraba por el suyo. Un cliente con
mensajes en los dos números aparecía en una lista con la ficha del otro lado: la
pantalla no encontraba su estado, asumía "pendiente", y **ARCHIVAR era imposible**
desde esa bandeja (se guardaba bien y volvía a pintarse pendiente).

**La regla, escrita:** el filtro por número aplica a los **MENSAJES**, nunca a la
**AGENDA**. Hay UNA ficha por cliente (`cuenta` + `telefono`), no una por número.

Afectó a **6 clientes en MANDI** y **40 en IND**.

### 4.4 El interruptor que no guardaba
En la pestaña AUTOS el switch solo cambiaba el estado visual: el cambio no se
aplicaba hasta apretar *"Guardar cambios"*. El dueño apagó el saludo, lo vio
apagado, y siguió prendido en la base **mandando mensajes a clientes reales**
(comprobado: `activo=true` guardado el 20-jul). Ahora los interruptores se
guardan solos con un patch mínimo, y **si el guardado falla el switch vuelve
donde estaba** en vez de mentir.

---

## 5. ⚠️ Estado actual de las automatizaciones

| Regla | Estado | Nota |
|---|---|---|
| `saludo_nuevo` | **APAGADO** | Lo apagué a mano en la base el 28-jul 23:46 para cortar el envío. **Hay que volver a prenderlo** — ver punto 6.3 |
| `saludo_reactivacion` | apagado | |
| `seguimientos` (global) | **PRENDIDO** | |
| └ 🔥 caliente | **PRENDIDO** | manda *"¿Seguimos con tu pedido?"* a las 23 h de silencio |
| └ 🌤️ tibio / ❄️ frío | apagados | |

**Cambio de comportamiento nuevo:** el cron de seguimientos ahora lee **todos los
canales** (antes solo el principal, así que REPUBLIC nunca recibía seguimiento).
Los leads calientes de REPUBLIC van a empezar a recibirlo. Es lo correcto, pero
es nuevo — si no se quiere todavía, se apaga en la pestaña AUTOS.

---

## 6. Pendientes

### 6.1 Borrar las rutas temporales — **el repo es PÚBLICO**
- `app/api/admin/diag-envio/` ← creada en esta sesión, **BORRAR**
- `app/api/admin/inbox-migrate/` ← preexistente, ya no se usa
- Borrar `DIAG_KEY` de las variables de Vercel

`diag-envio` **manda WhatsApp desde tus números** con un POST. Está protegida por
clave, pero cualquiera que lea el repo sabe que existe y qué hace; lo único que la
separa de tus números es una variable de entorno. Con eso se tumba el número por
spam. **Prioridad alta.**

### 6.2 Reetiquetar 3 mensajes (opcional, cosmético)
Tres saludos salieron por MANDI a clientes de REPUBLIC el 28-jul (21:19, 21:31,
21:40 EC — teléfonos `593968835423`, `593994509205`, `593998607020`). Están
guardados con `phone_id` de MANDI. Cambiarlo a `118582961194601` hace que esos
hilos se lean correctos en la bandeja de REPUBLIC. **No se hizo: es decisión del
dueño.**

### 6.3 Decidir el texto del saludo antes de prenderlo
Hoy el saludo es **uno solo por cuenta**, así que el cliente que escriba a
REPUBLIC va a recibir *"¡Hola! 🧡 Bienvenid@ a Mandarina…"* desde el 4167. Si son
marcas distintas hace falta un saludo **por número**. Es trabajo chico y no está
hecho.

### 6.4 Sacar el `sendImageUrl` propio de `App.jsx` → ver 4.2

### 6.5 Pruebas de canal: hoy hay **cero**
Los 45 tests no cubren nada multi-número, y por eso cuatro bugs de la misma
familia llegaron a producción en 24 h. Media docena de pruebas los habría
atajado: *el saliente sale por el mismo número del entrante*, *la agenda no se
filtra por canal*, *el saludo sale una sola vez por contacto*.

### 6.6 Monitoreo — lo que más falta
**Nada avisó de nada.** Todo se descubrió por accidente. Un chequeo diario que
cuente los `estado_entrega='failed'` de las últimas 24 h en `inbox.mensajes` y lo
mande por WhatsApp habría cazado los tres problemas grandes.

### 6.7 `message_echoes`
Suscribir ese campo del webhook para que lo que se responde **desde el celular**
aparezca en el inbox. Hoy un vendedor contesta por WhatsApp del teléfono, la
bandeja no se entera, el chat sigue pendiente y otro lo vuelve a contestar.

---

## 7. Trampas para el que siga

- **La carpeta `wa-inbox-next` ES el proyecto Vercel `wa-inbox-v2`.** Carpeta ≠
  nombre del proyecto. No son dos cosas.
- **Producción es `main`.** Nada de ramas: Preview no sirve acá porque Supabase
  solo está en Production.
- **`vercel env pull` devuelve los secretos VACÍOS** (`META_TOKEN=""`). No se puede
  reproducir nada localmente con credenciales de producción: hay que diagnosticar
  desde una ruta desplegada y con clave.
- **Un 200 de la Graph API no es prueba de entrega.** El estado real está en
  `inbox.webhook_eventos` y en `inbox.mensajes.estado_entrega`.
- **El merge del servidor en `lib/automatizaciones.js` es de UN nivel.** Un patch
  `{seguimientos: {caliente: {activo}}}` **borra** las horas y el texto de esa
  temperatura. Hay que mandar el bloque completo (ya está resuelto en `togSegT`).
- **La conversación es por `cuenta` + `telefono`**, no por número. Archivar a un
  cliente lo archiva **en las dos bandejas**: es un solo cliente con una sola
  ficha. Coherente con "una sola agenda compartida", pero es visible.
- `inbox.conversaciones` **no tiene** columna `updated_at`.
