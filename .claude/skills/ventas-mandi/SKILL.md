---
name: ventas-mandi
description: Se usa cuando Rodrigo pregunta por qué no vende, a quién retomar, cómo le va a la pauta o pide mandar mensajes a un grupo de clientes de MANDI (Mandarina) desde la terminal. Diagnóstico con SQL sobre el inbox + CRM y envío en lote aprobado por /api/saliente con scripts/enviar-lote.mjs.
---

# Ventas MANDI: diagnosticar y retomar clientes desde la terminal

> ⚠️ ESPEJADA en `wa-inbox-next/.claude/skills/ventas-mandi/` y `~/.claude/skills/ventas-mandi/`.
> Actualizar las dos.

Rodrigo conversa con Claude aquí y Claude ejecuta en la app. **No hay IA dentro del inbox ni API
de Anthropic**: el costo es el plan de Claude. (El diseño del asistente embebido quedó archivado:
`docs/superpowers/specs/2026-09-25-asistente-ventas-design.md`.)

## Reglas que no se negocian

1. **Nada sale sin un "dale" explícito de Rodrigo** para ESE lote. Primero se le muestra la lista y
   los textos; aprobar un lote no aprueba el siguiente.
2. **Solo dentro de la ventana de 24 h.** Fuera de ella solo se puede con plantilla aprobada (cuesta
   y es otro camino: `contactos`/plantillas del inbox).
3. **Quien habló último NO recibe un mensaje de retoma**: espera a una persona. Se le entrega a
   Rodrigo como lista aparte ("esperan respuesta").
4. Nunca a 🤫 (`sin_automaticos`), internos (`tipo_contacto='interno'`) ni a quien compró en los
   últimos 3 días.
5. Variar saludo y emoji por destinatario. Sin nombre si el perfil es apodo o emoji.
6. Tuteo ecuatoriano. Firma: "Andrés de Mandarina".

## Datos

Supabase `piingkecjgoisnxccvaa` (MCP `execute_sql`). `inbox.mensajes.direccion` va en
**MAYÚSCULAS**. Ventas = `crm.pedidos` (tienda `MANDARINA`) unido a `crm.clientes.celular`,
cruzado por **últimos 9 dígitos**. Esto subcuenta a quien compra con otro número: decirlo al dar
tasas. Canal principal MANDI `phone_id = 1024077200794372`.

⚠️ La base es Micro y se cayó el 23-sep por consultas del inbox: acotar siempre por
`cuenta='MANDI'` y fecha; nunca `DISTINCT ON` sobre todo `mensajes`.

### Callados tras nuestra pregunta (candidatos a retomar)

```sql
with c as (
  select conversacion_id, nombre_contacto, telefono, phone_id, ultimo_entrante_at
  from inbox.conversaciones
  where cuenta='MANDI' and ultimo_entrante_at > now() - interval '24 hours'
    and not coalesce(sin_automaticos,false) and coalesce(tipo_contacto,'') <> 'interno'),
ult as (
  select distinct on (m.conversacion_id) m.conversacion_id, m.direccion, m.texto, m.fecha
  from inbox.mensajes m where m.conversacion_id in (select conversacion_id from c)
    and m.tipo <> 'reaction'
  order by m.conversacion_id, m.fecha desc)
select c.nombre_contacto, c.telefono, c.phone_id,
       c.ultimo_entrante_at as entrante_at, ult.fecha as saliente_at, ult.texto as nuestra_pregunta,
       to_char((c.ultimo_entrante_at + interval '24 hours') at time zone 'America/Guayaquil','DD HH24:MI') as vence
from c join ult using (conversacion_id)
where ult.direccion = 'SALIENTE' and ult.texto ~ '\?\s*\S{0,3}$'
  and ult.texto not ilike '%me quedé con la duda%'   -- ya recibió la retoma en esta ventana
  and not exists (
    select 1 from crm.pedidos p join crm.clientes cl using (cliente_id)
    where p.tienda_id='MANDARINA' and p.fecha_pedido > now() - interval '3 days'
      and right(regexp_replace(cl.celular,'\D','','g'),9) = right(regexp_replace(c.telefono,'\D','','g'),9))
order by c.ultimo_entrante_at;
```

Cambiar la condición de `ult.texto` para otros grupos (por ejemplo, quitarla = todos los callados).

### Esperan respuesta (para una persona, no para un lote)

La misma consulta con `where ult.direccion = 'ENTRANTE'`.

### Embudo de pauta (el "¿por qué no vendo?")

Chats con `ctwa_clid` (vienen de un anuncio) de los últimos 60 días, excluyendo los 3 últimos
días. Por chat: mensajes entrantes, primera respuesta, compró o no. Medido el 25-sep-2026:
**1.020 chats, 48 compras (4,7 %)**; 70 % se va tras 1–3 mensajes; contestar en <1 min retiene
64 % vs 40 % a los 30 min–12 h; de 250 enganchados sin compra, 87 % termina con mensaje nuestro y
solo 10 % en pregunta; 4 % recibió seguimiento. Comparar contra estos números para ver si mejora.

## Envío en lote

1. Armar `lote.json` en el scratchpad (NO en el repo; lleva teléfonos):
   `[{ "telefono", "phone_id", "nombre", "texto", "entrante_at", "saliente_at" }]`,
   con `entrante_at` y `saliente_at` tal cual salieron de la consulta. Si un vendedor le escribe
   a mano entre la lista y el envío, el script lo salta (25-sep: pasó con 3 clientes).
   ☠️ Al mostrarle textos a Rodrigo para que copie, NO usar citas `>` de markdown: la terminal
   pinta "▎" y se copia con el texto (a un cliente le llegó así). El script lo rechaza.
2. Mostrar la tabla a Rodrigo (nombre, texto, vence) + los excluidos con motivo. Esperar "dale".
3. Ensayo: `node scripts/enviar-lote.mjs <lote.json>`. Relee cada hilo y dice qué mandaría.
4. Envío: `node scripts/enviar-lote.mjs <lote.json> --enviar` (uno cada 20 s). Corre en background
   si son muchos. Correrlo dos veces no repite: salta a quien ya tiene ese texto.
5. Verificar entrega (el 200 de Meta no es entrega) con los wamid de `<lote>.resultado.json`:

```sql
select s->>'id' as wamid, s->>'status' as estado, s->'errors'->0->>'title' as error
from inbox.webhook_eventos e
  cross join lateral jsonb_array_elements(e.payload->'entry') ent
  cross join lateral jsonb_array_elements(ent->'changes') ch
  cross join lateral jsonb_array_elements(ch->'value'->'statuses') s
where e.cuenta='MANDI' and e.recibido_en > now() - interval '2 hours'
  and e.wamids && array['wamid.A','wamid.B']   -- literal: así usa el índice GIN
order by 1;
```

`delivered`/`read` = llegó. `failed` = decir el error tal cual a Rodrigo.

La regla del script vive en `lib/lote-envio.js` (probada en `tests/lote-envio.test.js`): último
mensaje nuestro, el cliente no escribió después (ni reacción), ventana con ≥15 min de margen,
08:00–22:00 Ecuador, no repetir el mismo texto. Sale con `auto:true`: no cuenta como respuesta de
una persona.

**Credencial:** `INBOX_API_TOKEN` en `.env.local` (gitignored), copiado de Vercel
(`wa-inbox-v2`). Nunca imprimirlo. Si el script da 401, la clave está mal o tiene BOM.
