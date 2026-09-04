---
name: inbox-mandarina
description: Se usa al tocar, diagnosticar o auditar los inbox de WhatsApp (wa-inbox-next/wa-inbox-v2 para MANDI, ind-inbox-next/ind-inbox-v2 para IND) — mensajes, bandejas, canales, adjuntos, pauta/referral, webhook de Meta, plantillas y ventana de 24h. También cuando un cliente "no aparece", cuando un mensaje se ve vacío o raro, cuando algo llegó por WhatsApp y no está en la base, o antes de cambiar cómo se leen o se guardan los mensajes.
---

# Los inbox de WhatsApp (IND y MANDI)

> ⚠️ **Este archivo está ESPEJADO en tres lugares** y hay que actualizar los tres:
> `~/.claude/skills/inbox-mandarina/`, `wa-inbox-next/.claude/skills/inbox-mandarina/`
> e `ind-inbox-next/.claude/skills/inbox-mandarina/`. Las copias de los repos viajan
> con el código (celular, otra máquina, el resto del equipo); la de `~` es la que
> funciona cuando la sesión arranca fuera del repo. Mismo trato que un parche: x2, +1.

## Lo primero: son UNA app en DOS repos

`wa-inbox-next` (MANDI) e `ind-inbox-next` (IND) son el mismo producto con dos
caras. Comparten la base (`mandarina-DATA`, schema `inbox`, separados por la
columna `cuenta`) y **divergen en el código**: los archivos no son idénticos, así
que un parche se aplica DOS VECES y a mano.

- **Parches → x2.** Verifica el ancla en cada repo; puede estar en otra línea **o con otro nombre**.
- **Migraciones → x1.** La base es una sola. Registrar en `supabase_migrations.schema_migrations`, nunca en `public`.
- **Paletas distintas:** MANDI usa verde WhatsApp (`#25d366`); IND usa crema/negro (el objeto `C` en `components/Components.jsx`).

☠️ **Ejemplo real de que los nombres divergen:** el filtro de "¿hay algo que
pintar?" se llama **`esPintable` en MANDI** y **`pintable` en IND**. Es la misma
función y es la que más veces ha escondido clientes. Nunca copies un parche entre
repos sin abrir el archivo destino.

> 📍 **En qué punto están HOY: el `docs/HANDOFF-*.md` más reciente del repo.** Esta
> skill explica las trampas permanentes; el handoff dice qué se desplegó, qué
> quedó pendiente y con qué cifras. Léelos juntos.

---

## ☠️ Las trampas que YA volvieron

Cada una de estas costó mensajes de clientes reales. No son hipótesis.

### 1. El filtro que esconde clientes — volvió CUATRO veces

`esPintable` en MANDI / `pintable` en IND (`lib/inbox-supabase.js`) descarta lo que
"no tiene nada que pintar".
Cuatro veces se comió conversaciones enteras: fotos sin caption → notas de voz →
`order`/`unsupported`/`system` → `reaction`/`edit`/`revoke`/`contacts`. Medido:
**126 clientes sin una sola respuesta en un mes.**

**La regla, no la lista.** El `default` de `contenidoTipoEspecial`
(`lib/wa-mensaje.js`) manda cualquier tipo desconocido a `💬 Mensaje (tipo)`:
visible Y diagnosticable. Hay una prueba con un tipo INVENTADO que se cae si
alguien repone una lista blanca.

> **"Sin texto" nunca significa "no pasó nada".** Si vas a escribir una lista de
> tipos permitidos, para: la pregunta correcta es cuál es el default seguro.

### 2. PostgREST corta en 1000 filas — y no avisa

**Ignora un `.limit()` mayor en silencio.** Mordió dos veces el mismo archivo;
la segunda dejó **1.391 conversaciones invisibles** (la cabecera decía 113 y la
bandeja mostraba 34).

Usa `paginarLimite` (`lib/inbox-supabase.js`). Al paginar, **ordena por algo
TOTAL**: `fecha` empata y se pierden filas.

⚠️ Al encontrar uno, **revisa TODOS los lectores del archivo** — la primera vez
solo se arregló uno y el otro siguió roto meses.

### 3. Lecturas de Supabase congeladas en Next

Sin `cache: 'no-store'`, el cliente devuelve siempre la primera respuesta GET.
Costó **7 diagnósticos equivocados**.

> Si una lectura no cuadra con la base **pero los updates sí llegan**, sospecha
> del transporte antes que de la lógica.

### 4. La regla de canal

**El canal sale de la CONVERSACIÓN ABIERTA, jamás de la pestaña.** Y el filtro por
número es de los **MENSAJES**, nunca de la **AGENDA**.

**Solo un ENTRANTE dice por dónde habla el cliente** (`lib/bandeja.js`); un
saliente dice por dónde hablamos nosotros, que no sirve para decidir por dónde
responder.

⚠️ El primer intento de esto se revirtió: degradó el inbox a 3 lecturas de 1.642
filas por ciclo y mandaba a otra pestaña en cada clic.

### 5. Meta manda el mismo mensaje DOS veces (sep-2026)

Mismo wamid: primero un placeholder `unsupported`, **~0,4 s después** el mensaje
real con su texto y su referral de pauta. Con `ignoreDuplicates: true` **ganaba el
que llegaba primero**, que es el peor: 135 mensajes quedaron como "no podemos
mostrar" y 128 perdieron el anuncio del que venía el cliente.

⚠️ **Quitar `ignoreDuplicates` crea el bug al revés** (un placeholder tardío
pisando el bueno) — ese camino existe: en IND el real llegó primero en 20 de 139.
**La regla no es "gana el último", es "gana el que tiene contenido"**
(`lib/reentrega.js`).

☠️ Y un parche de reentrega **nunca** toca `telefono`, `conversacion_id`, `fecha`
ni `direccion`: arrastrarlos mueve el mensaje de chat o de bandeja.

---

## Reglas que ya se pagaron

- **Ningún automatismo saca un chat de Pendientes.** *"Si esa bandeja está vacía,
  contesté a todos."* Un entrante lo devuelve a PENDIENTE **siempre**.
- **Un `200` de la Graph API no es prueba de entrega.** El estado real vive en
  `inbox.webhook_eventos`. Meta da 200 al aceptar y el `failed` llega después.
- **`fetch` no lanza con 4xx/5xx.** Mirar `res.ok` siempre. Un 401 no es un error
  de red: un `.catch` que solo miraba errores de red dejó LINKPAGO **7 días muerto**.
- **El orden de los adjuntos es el que ve el cliente.** Los documentos entran
  ÚLTIMOS, después de las fotos.
- **Las plantillas son de la WABA, no de la marca.** Mover un número reinicia la
  ventana de 24h y hay que migrar `phone_id` en Supabase.

---

## ⚠️ La ruta caliente: mirar sin tocar

`/api/inbox-sync` es cerca de la mitad del gasto de Vercel, e `/api/webhook` es la
ruta #1 de invocaciones de IND.

- **`COLS_MSG` (`lib/inbox-supabase.js`) NO lleva `raw`** a propósito: son ~539 kB
  extra por ventana de 3.000 mensajes. `COLS_MSG_RAW` es solo para consultas POR
  CONVERSACIÓN (el hilo y la búsqueda), que son baratas.
- ☠️ **`COLS_MSG` sin `phone_id` rompe el canal.**
- **No hay cursor para un sync incremental**: `fecha` es de Meta y en IND llega
  hasta 2h38 tarde; un delta perdería ~780 mensajes/año en silencio.
- Antes de "optimizar" acá, lee la auditoría: el ahorro tope medido era ~$15/mes
  contra el canal de ventas. Lo que sí conviene es **bajar la frecuencia de deploys**.

---

## Cómo auditar sin suponer

**El método que más ha rendido: cruzar el crudo de Meta contra lo guardado.**

`inbox.webhook_eventos` guarda el payload entero, sin límite de retención. Todo lo
que Meta mandó está ahí, aunque nosotros lo hayamos perdido.

```sql
-- Patrón: ¿qué mandó Meta que no quedó guardado?
with crudos as (
  select msg->>'id' as wamid, msg->'referral' as ref
  from inbox.webhook_eventos e
       cross join lateral jsonb_array_elements(e.payload->'entry')            ent
       cross join lateral jsonb_array_elements(ent->'changes')                ch
       cross join lateral jsonb_array_elements(ch->'value'->'messages')       msg
  where e.cuenta='MANDI' and e.recibido_en > now() - interval '10 days'
    and msg ? 'referral'
)
select count(*) filter (where m.referral is null) as se_perdieron
from crudos c left join inbox.mensajes m on m.wa_message_id = c.wamid;
```

Así apareció el bug de las reentregas: **275 referrals mandados, 274 guardados**.
Ese 1 era la punta.

⚠️ **Trampa de rendimiento:** expandir 60-90 días de `webhook_eventos` con
`jsonb_array_elements` **se pasa de tiempo**. Para volúmenes grandes: aísla primero
los wamids en una tabla de trabajo y usa `cross join lateral` con
`e.wamids @> array[wamid]` — así el planificador usa el índice GIN
`webhook_eventos_wamids_idx`. Con el array armado en un CTE (`&& (select
array_agg(...))`) **no lo usa**.

**Otros dos controles que ya sirvieron:**

- **Reentregas vs doble disparo:** contar wamids repetidos en `webhook_eventos` da
  las reentregas; la **separación en el tiempo** distingue un doble disparo de un timeout.
- **Un contador monótono** (el secuencial de una factura, un id incremental) prueba
  que entre dos lecturas no pasó nada por ningún medio.

---

## Antes de afirmar que algo funciona

- **Un despliegue verde y reciente NO prueba que tu código esté arriba.** Correr
  `git status -sb`; un push a main **no siempre dispara build** (se destraba con un
  commit vacío, no con "redeploy"). Confirmar que el ID del despliegue sea el que
  arrancó después de tu push.
- **Ausencia de casos ≠ arreglado.** Comprueba que el flujo siga vivo: cuando el
  emparejado de Meta cayó a cero, el control fue ver que los `unsupported`
  **siguieran llegando**. Lo que paró fue otra cosa.
- **Probá con datos REALES de producción, no solo con casos inventados.** Las
  pruebas escritas a mano pasaron el 100% dos veces esta semana y fueron los
  strings reales los que destaparon los casos raros.
- **Guarda el dato en la MISMA forma que la app.** El `referral` se guarda
  normalizado (`normalizarReferral`, 10 claves fijas, siempre string), no crudo. Al
  reparar datos, valida la transformación contra filas sanas ANTES de escribir.
- **Todo UPDATE de rescate lleva guardia en el WHERE** → idempotente. Y córrelo dos
  veces: la segunda debe tocar 0 filas.

---

## Idioma

Todo en **español ecuatoriano con tuteo** — commits, comentarios y textos de la
app. Nada de voseo argentino: se dice `tú`, `puedes`, `dime`, `ve`.
