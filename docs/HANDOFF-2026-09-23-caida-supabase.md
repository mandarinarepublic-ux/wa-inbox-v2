# HANDOFF 23-sep-2026 — Caída de Supabase y lo que se arregló esa noche (IND + MANDI)

> **Mismo archivo en los dos repos** (`wa-inbox-next` y `ind-inbox-next`): la base es una sola y la
> mitad de los arreglos fueron en ella. La gestión de chats (etapas 0-2) va aparte, en
> `HANDOFF-2026-09-23-gestion-chats-port.md` (MANDI) y `HANDOFF-2026-09-22-gestion-chats.md` (IND).

## Qué pasó — NO fue un ataque

**23-sep, 20:17–20:56 (hora Ecuador): Supabase dejó de responder.** Se reinició a las 20:55.

- En 24 h de logs, todo `/rest` fue `service_role` desde nuestras apps en Vercel. Desde afuera solo
  hubo fotos públicas de `storage`, el rastreador de Meta y 9 llamadas `anon` de MÍNTARA. Cero 401/403.
- **La base era NANO** (0,5 GB). Rodrigo la subió a **Micro** a las 21:59 (reinicio 21:59:01–21:59:53).
- **La causa de fondo:** `lista_bandeja` (y `completar_bandeja`) calculaban el último mensaje de cada chat
  con `DISTINCT ON` sobre TODOS los mensajes del canal: 73.000 filas de IND por cada página de 1000, en
  cada vuelta del polling. Toda la tarde estuvo al filo del límite de 8 s (16:30 EC: p50 7,8 s, 36
  cortes en 15 min). Cuando varios de 8 s coincidían, se ocupaban todas las conexiones y todo lo demás
  hacía cola (el login del CRM, que tarda 150 ms, llegó a 6 minutos).
- **El empujón:** IND despachó respuestas rápidas con fotos (más de 50 fotos en 4 min). Cada foto y
  cada acuse (✓/✓✓/leído) invalidaban la versión de `/api/inbox-sync` → todas las pantallas recargaban
  todo. Prueba de que fue el empujón y no la causa: de 21:00 a 21:11 hubo la MISMA carga (428 frente a
  419 llamadas por minuto) y aguantó.
- "Se encoló" = la fila de envío del navegador (`encolar`, por cliente) esperando a una base que no
  contestaba.

## Hecho

### Base (una sola, aplica a los dos)

| Migración / cambio | Qué |
|---|---|
| `inbox_rpc_solo_service_role` | `completar_bandeja` y `rellenar_bsuid` (SECURITY DEFINER) ya no las ejecuta `anon`/`authenticated`. Verificado: con la llave pública → 401 `permission denied`. |
| `inbox_ultimo_mensaje_canal_tabla` | Tabla `inbox.ultimo_mensaje_canal`: PUNTERO al último mensaje de cada (cuenta, telefono, phone_id). La mantiene el disparador `ultimo_mensaje_canal_trg` en `mensajes` (insert, delete, update de fecha/clave). El disparador NUNCA tumba el guardado: si falla deja un WARNING y el mensaje entra igual. |
| `inbox_reconciliar_ultimo_mensaje_canal_liviano` | `inbox.reconciliar_ultimo_mensaje_canal()`: revisión por skip scan del índice (0,5 s, sin ordenar nada). |
| `inbox_ultimos_mensajes_canal_desde_puntero` | `ultimos_mensajes_canal` lee el puntero + `mensajes` por PK. Mismas columnas y MISMAS FILAS (comparado con EXCEPT canal por canal: 3.554 + 2.312 + 2.216 + 243, cero diferencias). `lista_bandeja` y `completar_bandeja` se aceleran solas. |
| `inbox_cron_reconciliar_ultimo_mensaje_canal` + `_avisa` | `pg_cron` (extensión nueva) corre `inbox.cron_reconciliar_ultimo_mensaje_canal()` cada 5 min. Si tuvo que arreglar algo deja un WARNING `[ultimo_mensaje_canal] reconciliar arregló N claves`. |
| `inbox_bandeja_acuse_en` | Columna `bandeja.acuse_en` + índice `(cuenta, acuse_en desc nulls last)`. |
| `inbox_mensajes_cuenta_fecha_idx` | Índice `mensajes (cuenta, fecha desc)`, creado CONCURRENTLY a mano y registrado en `supabase_migrations.schema_migrations`. |

### Código

| Repo | Commit | Qué |
|---|---|---|
| IND | `20c84c7` | Los acuses tocan `bandeja.acuse_en`, NO `actualizado_en`. La versión del inbox los cuenta agrupados en ventanas de 30 s (`acuseAgrupado`, `lib/version-inbox.js`): una ráfaga invalida a lo más 2 veces por minuto y el último ✓✓ siempre se ve (≤30 s tarde). |
| MANDI | `009c8b7` | Lo mismo. |
| IND | `1284f6d` | Un clic de más ya no manda la respuesta rápida dos veces: candado por ref en `handleQuickReply` (compartido por el panel y el cajón del celular) + "¿Mandarla OTRA VEZ?" si ya salió a ese cliente hace <10 min (mira también el hilo). Si la anterior salió a medias, reenvía sin preguntar. Regla pura en `lib/respuesta-repetida.js`. Medido: 17 dobles envíos en 30 días. |
| MANDI | `4c4cf0d` | Lo mismo (en MANDI eran 2 en 30 días). |
| MANDI | `3a92def` | Un envío que FALLA ya no saca el chat de Pendientes: respuesta rápida, adjuntos del computador, texto de la caja (antes marcaba EN PARALELO al envío) y texto del panel. Igual que IND. |

### Flujos de MANDI (datos, por SQL, validados con `validarFlujo` + `elegirFlujo` + `choquesDeDisparador`)

| Flujo | Qué |
|---|---|
| `FLUJO- SKELETOR` (027ab5f2) | No se disparaba: Meta da OTRO `source_id` a cada anuncio nuevo y el del 23-sep (`120253637371550606`, "¡SALUDOS, INSECTO! 💀") no estaba en el disparador. 10 clientes se atendieron a mano. Agregado + publicadas las pausas 3/2/4 s que estaban en borrador desde el 15-sep. |
| `FLUJO- BEN10` (f6100035) | NUEVO, copia de SKELETOR (pedido de Rodrigo): saludo → 3 s → respuesta BEN10 (3 fotos + audio) → 2 s → "¿En qué talla…?" → 4 s → Fin. Anuncios `120253165485130606` (activo) + `120249837721540606`. |
| `FLUJO- TORTUGAS NINJA` (f990fbee) | NUEVO, misma estructura con la respuesta TMNT (promo 1×$35 / 2×$50). 5 anuncios TMNT (`120253637239600606` es el nuevo). |

## Antes → después (medido)

| | Antes | Después |
|---|---|---|
| Una página de `lista_bandeja` (IND) | 5.283 ms | 60 ms |
| `completar_bandeja` | 4.853 ms | 11 ms |
| Ventana de mensajes (`cuenta=… order by fecha desc`) | 284 ms + 65 MB ordenados en disco | 3 ms |
| `lista_bandeja` en producción (15 min) | p90 5-9 s, 10-40 cortes | p50 69 ms, máx 166 ms, 0 cortes |
| Cortes por tiempo en toda la base (22:05–23:12) | — | **0** |

Verificado a las 23:12: 533 acuses desde el deploy y `bandeja.acuse_en` ya tiene 27 filas; la revisión
del puntero corrió 14 veces, 0 fallos, 0 avisos de reparación.

## ☠️ Trampas nuevas

- **NUNCA un `DISTINCT ON` u `ORDER BY` sobre todo `inbox.mensajes`**, ni para "rellenar" ni para
  diagnosticar: en la máquina chica ahoga la base (lo hice a las 21:54 y di 125 errores en 5 min). Toda
  consulta de diagnóstico con `set statement_timeout='5s'`; para recorrer claves, skip scan por índice.
- **`ultimos_mensajes_canal` ya NO es un cálculo, es un puntero.** Si alguien la recrea con el `DISTINCT
  ON` viejo, vuelve la caída. Si el puntero se desfasa: `select inbox.reconciliar_ultimo_mensaje_canal()`
  (devuelve cuántas claves arregló; la segunda corrida debe dar 0).
- **Un acuse toca `acuse_en`, no `actualizado_en`.** `actualizado_en` sigue siendo "cambió algo que hay
  que ver YA" (mensaje, bandeja, failed).
- **Anuncio nuevo = flujo mudo.** Cada anuncio nuevo de Meta trae otro `source_id`: hay que agregarlo al
  disparador o el cliente recibe solo el saludo genérico. Para detectarlo, ver la consulta de abajo.
- **Sesiones en paralelo en MANDI:** otra sesión tenía `App.jsx` a medias. Se commiteó desde un worktree
  limpio (`git worktree add --detach`) + `git apply` del parche también sobre su copia + `reset --mixed
  origin/main`, sin tocar su trabajo. Nunca `git add -A` ni `git stash` a ciegas.

## Pendiente

- [ ] **Flujos BEN10 / TORTUGAS NINJA / SKELETOR**: ver que disparen con un cliente real (`inbox.flujo_pasos`).
      Al cerrar no había llegado ninguno por esos anuncios.
- [ ] **Pregunta doble** en BEN10 y TMNT: la respuesta del producto ya pregunta y 4 s después va "¿En qué
      talla…?". Si confunde, quitar ese nodo en el lienzo y 🚀 Publicar cambios.
- [ ] Anuncio `120252247673840606` ("¡El multiverso se pone serio!…", 2 clientes en agosto): ¿es BEN10? No se incluyó.
- [ ] MANDI no tiene `marcarFallido` (la burbuja del texto que falló no se marca ⚠ como en IND).
- [ ] Advisors de seguridad que quedan: vistas SECURITY DEFINER (`inbox.ultimos_mensajes`, 4 de `mata`),
      21 funciones con `search_path` mutable, protección de contraseñas filtradas apagada.
- [ ] Mirar al día siguiente, con tráfico de tienda, que `lista_bandeja` siga en milisegundos.

## Consultas útiles

```sql
-- Anuncios que traen clientes y NO tienen flujo publicado (MANDI; cambiar cuenta para IND)
with cubiertos as (
  select jsonb_array_elements_text(n->'datos'->'sourceIds') sid, f.nombre
  from inbox.flujos f, jsonb_array_elements(f.grafo_vivo->'nodos') n
  where f.cuenta='MANDI' and f.publicado and n->>'tipo'='disparador')
select m.referral->>'source_id' anuncio, left(max(m.referral->>'body'),60) texto,
       count(distinct m.telefono) clientes, max(c.nombre) flujo
from inbox.mensajes m left join cubiertos c on c.sid = m.referral->>'source_id'
where m.cuenta='MANDI' and m.direccion='ENTRANTE' and m.referral->>'source_id' is not null
  and m.fecha > now() - interval '48 hours'
group by 1 order by 3 desc;

-- Salud del puntero y de los acuses
select (select count(*) from inbox.ultimo_mensaje_canal) punteros,
       (select max(acuse_en) from inbox.bandeja) ultimo_acuse,
       (select count(*) filter (where status <> 'succeeded') from cron.job_run_details d
          join cron.job j using (jobid) where j.jobname = 'reconciliar_ultimo_mensaje_canal') cron_fallos;
```

Postgres: buscar `[ultimo_mensaje_canal]` en los logs = el disparador falló o la revisión tuvo que arreglar algo.
