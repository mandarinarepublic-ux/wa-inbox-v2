# Bandeja por canal — que la respuesta salga SIEMPRE por el número donde te escribieron

Fecha: 2026-08-19 · Estado: diseño aprobado, sin implementar

## El problema, con evidencia

El 19-ago un cliente (`…698`) escribió a las 11:11 y le
contestamos tres mensajes a las 11:49. **Los tres murieron.** Meta los rechazó con
`131047`:

> *"Message failed to send because more than 24 hours have passed since the customer
> last replied to **this number**."*

El cliente había escrito al **593979104167 (REPUBLIC)**. Los tres mensajes salieron
por el **593983745757 (MANDI)**, número al que no escribe desde el 15 de julio.

La ventana de 24 h de WhatsApp es por **par (cliente ↔ número nuestro)**, no por
cliente. El inbox la trata como si fuera por cliente.

### No es un caso aislado (medido el 19-ago)

- En 14 días, **3 de 4 episodios** de salientes fallidos en MANDI son este bug —
  no ventana cerrada de verdad: en los tres el OTRO número tenía la ventana abierta.
- El **16-ago**: **6 mensajes seguidos muertos** a `…049`, un cliente que
  **nunca** había escrito a MANDI.
- **25 personas** de MANDI han escrito a los dos números. Esa es la población en riesgo.
- El único aviso es un `⚠` rojo de 11 px con el motivo en un `title=` — invisible al
  tacto en celular. Nadie se enteró de ninguno de los tres episodios.

### Las dos causas de código

**1. GENERAL mezcla los dos números en un solo hilo.** `/api/inbox-sync` pide los
mensajes sin filtro (`getMensajes(null)`) y `App.jsx:328` los agrupa **solo por
teléfono**:

```js
const convsData = buildConvs([...(rows||[]), ...hilos, ...(lista||[])])
```

`cargarHilo` sí pide el hilo filtrado por canal, pero después hace
`buildConvs([...c.msgs, ...msgs])` — **fusiona en vez de reemplazar**, así que el
filtro no sirve de nada. El vendedor ve una conversación que no existe: dos hilos
distintos cosidos por fecha, sin marca de por cuál número entró cada mensaje.

**2. El canal se adivina, y se adivina de un campo contaminado.** `phoneIdDe()` lee
`inbox.conversaciones.phone_id`, y hay **una sola ficha por persona**. Peor:
`guardarMensajeSupabase` pisa ese campo con el canal de **cualquier** mensaje,
**incluidos los salientes**:

```js
if (fila.phone_id) patchConv.phone_id = fila.phone_id
```

Efecto bola de nieve: el primer envío por el número equivocado **contamina la ficha**
y arrastra a todos los siguientes. Por eso fueron 3 seguidos, y 6 el 16-ago.

## Decisiones tomadas

| Decisión | Elegido |
|---|---|
| Qué es GENERAL | Un **tablero**: lista y despacha. Sin hilo ni caja de respuesta. |
| Clic en una fila | Te **lleva** a la pestaña de ese número y abre el chat ahí |
| Cliente en dos números | **Dos filas** en GENERAL, una por número |
| Estado pendiente/atendido | **Por (cliente, número)**: cada fila se apaga sola |
| Temperatura, notas, venta, IA | **Del cliente**, una sola (el lead es el mismo) |
| Marca visual del canal | **Etiqueta con el nombre** del canal, en su color |
| Qué lista GENERAL | **Todos los chats**, como hoy (no solo pendientes) |

La idea de fondo: **el canal deja de calcularse y pasa a venir en el dato.**
`phoneIdDe()` se borra.

## Arquitectura de datos

No se puede partir `inbox.conversaciones` en dos filas: el **CRM** (chat del pedido,
pauta, dashboard) y **IND** leen esa tabla. Partirla los rompe.

Se separa lo que es de la conversación de lo que es de la persona:

```
inbox.bandeja          NUEVA · clave: cuenta + telefono + phone_id
  estado                PENDIENTE | ATENDIDO | ARCHIVADO | SOPORTE | VENTA
                        (los 5 que existen hoy en la base, verificado 19-ago)
  no_leidos
  ultimo_mensaje_at
  ultimo_entrante_at    <- base de la ventana de 24 h, POR CANAL
  ultimo_push_at
  alerta_ventana_at
        una fila por cada número por el que te habló

inbox.conversaciones   LA DE HOY, sin tocar · clave: cuenta + telefono
  nombre_contacto · alias · temperatura · notas · id_venta
  modo_ia · ctwa_* · refuerzo1 · refuerzo2
        una sola: el lead es el mismo aunque escriba por dos números
```

`conversaciones.phone_id` **deja de escribirse desde los salientes**. Es lo que mata
el efecto bola de nieve. Se mantiene el campo (lo leen otros) pero solo lo tocan los
entrantes, y ya no decide por dónde sale nada.

## Cambios por capa

| Capa | Qué cambia |
|---|---|
| **Base** | Crear `inbox.bandeja` + sembrarla (ver abajo) |
| **Vista** | `pendientes_por_canal` pasa a leer `bandeja.estado` en vez de `conversaciones.estado` |
| **Lista GENERAL** | `getListaSupabase` usa `ultimos_mensajes_canal` **también** cuando `canal` es null. Hoy con null cae a `ultimos_mensajes`, que colapsa a una fila por persona. La vista correcta ya existe y ya está en producción para los contadores. |
| **Fila de la lista** | Lleva su `phone_id` y pinta la etiqueta del canal (`CANALES[].etiqueta` + `colorDeCanal`) |
| **Clic en GENERAL** | `cambiarLinea(canalDePhoneId(fila.phone_id))` + `openConv(...)`. El patrón **ya existe**: es `abrirChatDesdeContactos`. Lo único que cambia es que el destino sale del `phone_id` **de la fila**, no de la ficha. |
| **GENERAL** | Sin hilo ni caja de respuesta. Es lo que hace imposible contestar por el número equivocado. |
| **Envío** | `phoneIdDe()` **se borra**. El canal es la pestaña, siempre. |
| **Estado** | `marcarAtendido`, el reabrir a PENDIENTE del webhook y el conteo escriben en `bandeja`, con `phone_id` |
| **Cache de hilos** | `hilosRef` se indexa por `telefono + phone_id`, no por teléfono |

Nótese que la línea que más importa es la del envío: **se borra código, no se agrega.**
`phoneIdDe` es el helper del que salieron estos bugs las últimas cinco veces.

## Migración y siembra

La base es **compartida con IND**: la migración corre **una sola vez**, el código se
parcha en **dos repos**.

1. `create table inbox.bandeja (...)` con la clave `(cuenta, telefono, phone_id)`.
2. **Sembrar** desde lo que ya existe — una fila por cada combinación con mensajes,
   heredando el estado actual de `conversaciones`:

```sql
insert into inbox.bandeja (cuenta, telefono, phone_id, estado, ultimo_mensaje_at, ultimo_entrante_at)
select m.cuenta, m.telefono, m.phone_id,
       coalesce(c.estado, 'PENDIENTE'),
       max(m.fecha),
       max(m.fecha) filter (where m.direccion = 'ENTRANTE')
from inbox.mensajes m
left join inbox.conversaciones c on c.cuenta = m.cuenta and c.telefono = m.telefono
where m.phone_id is not null
group by m.cuenta, m.telefono, m.phone_id, c.estado;
```

Sin esta siembra, al desplegar o aparece todo pendiente de golpe o desaparece la
bandeja entera. **Verificar el conteo antes y después**: hoy son 1.638 combinaciones
en MANDI (1.606 personas, 32 duplicadas).

3. **Convivencia mientras IND no está parchado:** el código nuevo escribe en
   `bandeja` **y sigue escribiendo** `conversaciones.estado` como hoy. IND lee lo
   viejo y no se entera. Cuando IND también esté, se quita la escritura doble.

## Orden de despliegue

1. Migración + siembra (base compartida)
2. MANDI (`wa-inbox-next`) — con escritura doble
3. Verificar en producción con el caso real (el cliente …698: dos filas, cada una a su pestaña)
4. IND (`ind-inbox-next`) — mismo parche
5. Quitar la escritura doble

## Pruebas

**No hay ni una prueba multi-número en ninguno de los dos repos.** Es lo que dejó
pasar esta familia de bugs cinco veces. Este cambio trae las primeras:

1. Un cliente con mensajes en dos `phone_id` produce **dos filas** en GENERAL.
2. Marcar atendida la fila de un canal **no** apaga la del otro.
3. Un entrante por un canal devuelve a PENDIENTE **solo** la fila de ese canal.
4. Abrir una fila de GENERAL deja la pestaña y el canal activo en **el de la fila**.
5. El hilo de un canal **no contiene** mensajes del otro (la que caza la mezcla).
6. Un saliente **no** cambia el canal de nada (la que caza la bola de nieve).

Ojo: `node --test` no entiende los alias `@/` (ver el handoff de pedidos).

## Riesgos y trampas conocidas

- **PostgREST corta en 1000 filas** e ignora un `.limit()` mayor sin avisar. Ya mordió
  este archivo dos veces. `bandeja` va a tener ~1.638 filas en MANDI: **cualquier
  lectura nueva se pagina**, con orden total (`fecha` empata → pierde filas).
- **Lecturas cacheadas de Supabase en Next**: toda lectura nueva con `cache: no-store`.
- **Vercel**: un push a main no siempre dispara build. Confirmar con `vercel ls --prod`
  y `git status -sb`, no con el `● Ready` del panel.
- **La regla de Rodrigo se mantiene**: ningún automatismo saca un chat de Pendientes.
  Un entrante lo devuelve a PENDIENTE siempre — ahora en la fila de SU canal.

## Fuera de alcance (siguiente)

Lo que este diseño **no** hace, y sigue haciendo falta:

1. **Guardia de ventana antes de enviar**: con `bandeja.ultimo_entrante_at` ya se
   puede saber si la ventana de ESE canal está cerrada y frenar el envío ofreciendo
   plantilla. Este diseño deja el dato listo; la guardia es otro cambio.
2. **Aviso de entregas fallidas**: el chequeo diario de `estado_entrega='failed'` que
   se pidió en julio y nunca se hizo. Sin eso, el próximo fallo se pierde igual de
   callado.
