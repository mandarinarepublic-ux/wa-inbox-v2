# HANDOFF — 14/15-ago-2026 · Avisos, LINK PAGO y los clientes invisibles

Cubre **los dos inbox**: `wa-inbox-next` (MANDI) e `ind-inbox-next` (IND).
Todo lo de aquí está **desplegado y verificado en producción**.

## Estado al cerrar

| | MANDI | IND |
|---|---|---|
| Último commit desplegado | `ff2a941` | `6d91bb0` |
| Pruebas | **348** (empezó en 291) | **256** (empezó en 216) |
| `main` vs `origin/main` | sincronizado | sincronizado |
| Dominio | `inbox.apps.mandarinaec.com` | `ind-inbox.apps.mandarinaec.com` |

Controles negativos pasando en los dos: `/inbox` → 307 al login · `/api/linkpago`
→ 401 · `/api/cron/pendientes` → 401 (sin llave y con cabecera falsificada).

---

## ⚠️ LO PRIMERO QUE TIENE QUE HACER RODRIGO

1. **Suscribir su celular al push de IND.** Sigue con UNA sola suscripción y es de
   escritorio. Cada inbox tiene sus PROPIAS claves VAPID: suscribirse a MANDI **no**
   suscribe a IND. Abrir `https://ind-inbox.apps.mandarinaec.com/inbox` en el Android,
   *Agregar a pantalla de inicio* (queda un **segundo icono**, aparte del de MANDI),
   abrir DESDE ESE ICONO y tocar 🔕.
   **Criterio de éxito, no "se ve verde":** una fila nueva en `inbox.push_subs` con
   `user_agent` de Android **y `cuenta='IND'`**.
2. **Chrome → Batería → Sin restricciones** en el Android, para los dos.
3. **Escribirle a los clientes invisibles** que aparecieron (ver abajo).

---

## Los cinco apagones que se destaparon

Ninguno lanzaba error. Todos se veían bien. Los cinco se encontraron con la misma
pregunta: **¿lo que veo en pantalla coincide con lo que dice la base?**

### 1. El celular nunca estuvo suscrito al push — 17 días
Tres suscripciones existían y las tres eran Chrome en Windows. **Cero desde un
celular, nunca.** Dos causas gemelas:
- `PushToggle.jsx` mostraba TODOS sus errores en `title=`, que es un tooltip de
  hover: **al tacto no existe**. El botón fallaba y no decía nada.
- El enfriamiento de 5 min era **de flanco**: solo disparaba al ENTRAR un mensaje,
  así que quien escribía una vez y esperaba generaba UN aviso en toda su vida.

**Arreglo:** avisar SIEMPRE y moderar solo el sonido (`debeSonar` → `renotify`),
como WhatsApp. Todo camino del botón termina en un mensaje visible en pantalla.
✅ Verificado en vivo: dos mensajes seguidos llegan los dos y suena una vez;
contestar hace que el siguiente vuelva a sonar.

### 2. El candado mató los envíos automáticos — 7 días
Al encender `AUTH_MODO=bloquear` (7-ago), la llamada que el webhook se hace a sí
mismo a `/api/saliente` quedó sin credencial → **401**. Murieron LINKPAGO, los
saludos automáticos, el mensaje de espera y (en IND) el cron de seguimientos.

☠️ **Invisible porque el `.catch` solo atrapa errores de RED. Un 401 no lo es**:
`fetch` lo devuelve como respuesta normal con `ok:false`.

**Arreglo:** `lib/auth-maquina.js` (IND) / `enviarSaliente` (MANDI) mandan
`Authorization: Bearer $INBOX_API_TOKEN` **y miran `res.ok`**. Variables nuevas y
DISTINTAS por proyecto (si una se filtra, no abre la otra).

### 3. El token de Telegram de IND estaba vacío
Existía con el nombre correcto desde hacía 14 días. **Mismo NOMBRE en otro proyecto
≠ mismo VALOR**, y `vercel env pull` los oculta, así que no se puede comparar
leyendo. Lo único que distingue "vacía" de "inválida" es el mensaje del runtime.

### 4. Un filtro escondía 126 clientes — hasta un mes
La barra lateral muestra el ÚLTIMO mensaje de cada chat. Si ese mensaje no tiene
texto ni media, **desaparece la conversación entera, con persona incluida**.
Medido: **126 clientes que NUNCA recibieron una respuesta** (114 IND, 12 MANDI).
Más 32 chats que se esfumaban porque su último mensaje era una reacción con emoji.

Es el bug **más reincidente** del proyecto: volvió CUATRO veces (fotos sin caption →
notas de voz → `order`/`unsupported`/`system` → `reaction`/`edit`/`revoke`).

**Arreglo de fondo — la regla, no la lista:** `contenidoTipoEspecial` etiqueta
cualquier tipo sin contenido, y **lo desconocido cae a `💬 Mensaje (${tipo})`**.
Se aplica al ingerir Y al leer, para recuperar filas viejas.
**La prueba que rompe el ciclo:** un mensaje de tipo `tipo_que_no_existe_todavia`
debe producir contenido y pasar el filtro. Se cae si alguien repone una lista blanca.

### 5. `.limit(4000)` que devolvía 1.000 — 1.391 conversaciones invisibles
PostgREST corta en 1.000 filas por petición e **ignora un límite mayor sin avisar**.
`getListaSupabase` no paginaba. Perdían: IND 9804 → 762, MANDI principal → 441,
IND 3326 → 188.

⚠️ **MANDI parecía sano por CASUALIDAD**: sus pendientes eran recientes y caían
dentro de las primeras 1.000. El bug estaba igual de presente.
⚠️ Ya había mordido este archivo en `getContactosSupabase` un mes antes. **Nadie
revisó las funciones vecinas.**

---

## Lo que se construyó además

- **Telegram de pendientes**: avisa de un ESTADO (hay gente esperando) e insiste
  cada 30 min, a diferencia del push que avisa de un EVENTO y se pierde.
  Techo **24 h en MANDI**, **2 h en IND** — medido: con 24 h IND nombraría 81 chats,
  cierto e inútil; con 2 h nombra 24, que es donde contestar rápido gana la venta.
  El arrastre se menciona aparte (`+N de más de 2 h`) para que no sea falsa calma.
- **LINK PAGO** en la pestaña Ventas de los dos: pones el monto, genera el link,
  **la ventana se limpia** y el mensaje completo queda en la nota con botón 📋.
  No envía nada al chat. IND reusa la cuenta dLocal de MANDI pero el cobro aparece
  como **"Pago IND STORE"** y el texto dice IND STORE.
- **Botón 💰 Venta en proceso** en IND (el filtro existía sin forma de llenarlo).
- **Pedidos del catálogo** ahora se pintan con productos, cantidades y total.
- **La factura de Vercel bajó ~140 kB por poll** neto: se sacó `raw` de la consulta
  caliente (−568 kB) y se pagó la paginación (+427 kB).

---

## Pendiente

**De código, sin urgencia:**
- Tarjeta `pendientes` en la pestaña AUTO: horario, espera mínima, repetición y
  techo editables sin tocar código (hoy son constantes).
- `edit` y `location` se etiquetan pero no muestran su contenido (el `location` de
  `contenidoTipoEspecial` es código muerto: `extraer()` ya lo maneja antes).
- Llevar el detalle del pedido al CRM de un click.
- Un test que ate `RUTAS_PUBLICAS` al `matcher` de `middleware.js` (hoy solo los ata
  el ojo humano; `node --test` no resuelve `@/`, habría que parsear el archivo).
- `/api/cron/seguimientos` conserva la autorización permisiva (`x-vercel-cron`
  antes que el secreto). El cron nuevo ya está endurecido; el viejo no. **Ese sí
  manda WhatsApps de verdad.**

**Decisiones tomadas que NO hay que "corregir":**
- `SOPORTE_TEL` de IND apunta al soporte de MANDI **a propósito** (mismo número).
- El 9804 sigue en **coexistencia** (vive en el celular). Registrarlo en la nube le
  quitaría el WhatsApp a quien atiende. Eso causa ~2,5% de `unsupported` en ese
  número (8× el otro) y **no se va a arreglar**: por eso la persona debe verse
  aunque el contenido no llegue.
- El techo de IND es 2 h y el de MANDI 24 h. No es capricho: son volúmenes distintos.

---

## Trampas que van a volver a morder

1. **"Ya hice el deploy en Vercel" NO sube código.** Pasó CUATRO veces el 14-ago.
   Agregar una variable dispara un redespliegue **del código que ya estaba**: sale
   `● Ready`, reciente, y no trae nada nuevo. **Correr `git status -sb` antes de
   creerle a cualquier despliegue.** Si dice `ahead N`, nada de lo que pruebes vale.
2. **Un `.catch()` no atrapa un 401.** `fetch` solo lanza con errores de red.
3. **`vercel env pull` devuelve los secretos vacíos.** No sirve para comparar
   proyectos ni para reproducir nada localmente.
4. **PostgREST corta en 1.000 filas.** Al encontrar un `.limit()` alto sin paginar,
   revisar **todos** los lectores del archivo, no solo el que se rompió.
5. **"Sin texto" nunca significa "no pasó nada".**
6. Cargar variables por PowerShell les pega un **BOM invisible** que revienta solo
   en producción. Por el panel web, o por bash con `printf --`.

---

## Cómo verificar que sigue sano

```sql
-- ¿El celular está suscrito? (la fila que estuvo en CERO 17 días)
select cuenta, creado, left(user_agent,60) from inbox.push_subs
where user_agent ilike '%Android%' order by creado desc;

-- ¿Hay clientes sin UNA sola respuesta?
select c.cuenta, count(*) from inbox.conversaciones c
where upper(trim(c.estado))='PENDIENTE'
  and not exists (select 1 from inbox.mensajes m
                  where m.conversacion_id=c.conversacion_id
                    and upper(m.direccion)='SALIENTE')
group by 1;

-- ¿La cabecera y la bandeja dicen lo mismo?
select * from inbox.pendientes_por_canal;
```

⚠️ En SQL, `direccion` y `estado` están en **MAYÚSCULAS**. Buscar en minúsculas
devuelve vacío y parece que no hay nada.
