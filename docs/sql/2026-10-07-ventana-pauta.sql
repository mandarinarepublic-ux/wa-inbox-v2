-- Ventana de PAUTA (free entry point) por conversación — 7-oct-2026.
--
-- Cuando un cliente llega de un anuncio y le respondemos dentro de 24 h, Meta abre
-- una ventana en la que se le puede escribir TEXTO LIBRE y gratis hasta 7 días
-- (probado el 7-oct-2026: texto libre entregado a las 52 h, `free_entry_point`).
-- La documentación de Meta todavía dice 72 h y "fuera de 24 h solo plantillas":
-- manda el dato, no la doc.
--
-- El vencimiento lo dice Meta en cada estado `sent` de esa conversación:
--   statuses[].conversation.origin.type = 'referral_conversion'
--   statuses[].conversation.expiration_timestamp = epoch en segundos
-- Se guarda POR PAR (cliente, número nuestro) en `inbox.bandeja`, igual que la
-- ventana de 24 h, y viaja a la pantalla por `lista_bandeja`.
--
-- Va en un trigger sobre `webhook_eventos` (el crudo de las DOS cuentas) y no en
-- el código del webhook: una sola pieza para MANDI e IND en vez de un parche x2.
-- El trigger NUNCA tumba el insert del crudo: cualquier error se traga con WARNING.
-- La base es compartida: esto se aplica UNA vez (registrada en
-- supabase_migrations.schema_migrations como `ventana_pauta`).

alter table inbox.bandeja add column if not exists pauta_vence_en timestamptz;

create or replace function inbox.registrar_ventana_pauta() returns trigger
language plpgsql security definer set search_path = inbox, public as $$
begin
  begin
    update inbox.bandeja b set pauta_vence_en = x.vence
    from (
      select ch->'value'->'metadata'->>'phone_number_id' as pid,
             st->>'recipient_id' as tel,
             max(to_timestamp((st->'conversation'->>'expiration_timestamp')::bigint)) as vence
      from jsonb_array_elements(new.payload->'entry') ent
      cross join lateral jsonb_array_elements(ent->'changes') ch
      cross join lateral jsonb_array_elements(ch->'value'->'statuses') st
      where st->'conversation'->'origin'->>'type' = 'referral_conversion'
        and (st->'conversation'->>'expiration_timestamp') ~ '^[0-9]+$'
      group by 1, 2
    ) x
    where b.cuenta = new.cuenta and b.telefono = x.tel and b.phone_id = x.pid
      and (b.pauta_vence_en is null or b.pauta_vence_en < x.vence);
  exception when others then
    raise warning 'registrar_ventana_pauta: %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists webhook_eventos_ventana_pauta on inbox.webhook_eventos;
create trigger webhook_eventos_ventana_pauta
  after insert on inbox.webhook_eventos
  for each row
  when (new.payload @? '$.entry[*].changes[*].value.statuses[*].conversation.expiration_timestamp')
  execute function inbox.registrar_ventana_pauta();

-- Relleno: lo que ya llegó en los últimos 8 días (la ventana dura 7 como mucho).
update inbox.bandeja b set pauta_vence_en = x.vence
from (
  select e.cuenta,
         ch->'value'->'metadata'->>'phone_number_id' as pid,
         st->>'recipient_id' as tel,
         max(to_timestamp((st->'conversation'->>'expiration_timestamp')::bigint)) as vence
  from inbox.webhook_eventos e
  cross join lateral jsonb_array_elements(e.payload->'entry') ent
  cross join lateral jsonb_array_elements(ent->'changes') ch
  cross join lateral jsonb_array_elements(ch->'value'->'statuses') st
  where e.recibido_en > now() - interval '8 days'
    and st->'conversation'->'origin'->>'type' = 'referral_conversion'
    and (st->'conversation'->>'expiration_timestamp') ~ '^[0-9]+$'
  group by 1, 2, 3
) x
where b.cuenta = x.cuenta and b.telefono = x.tel and b.phone_id = x.pid
  and (b.pauta_vence_en is null or b.pauta_vence_en < x.vence);

-- La vista que lee la pantalla: misma lista de columnas + la nueva AL FINAL.
create or replace view inbox.lista_bandeja as
 SELECT u.cuenta,
    u.telefono,
    u.nombre,
    u.direccion,
    u.tipo,
    u.texto,
    u.media_url,
    u.media_id,
    u.botones,
    u.fecha,
    u.wa_message_id,
    u.estado_entrega,
    u.contexto_id,
    u.referral,
    u.phone_id,
    COALESCE(b.estado, 'PENDIENTE'::text) AS estado_bandeja,
    COALESCE(b.no_leidos, 0) AS no_leidos_bandeja,
    b.ultimo_entrante_at AS ultimo_entrante_canal,
    a.etiqueta AS origen_anuncio,
    b.pauta_vence_en
   FROM inbox.ultimos_mensajes_canal u
     LEFT JOIN inbox.bandeja b ON b.cuenta = u.cuenta AND b.telefono = u.telefono AND b.phone_id = u.phone_id
     LEFT JOIN inbox.conversaciones c ON c.cuenta = u.cuenta AND c.telefono = u.telefono
     LEFT JOIN inbox.anuncios a ON a.cuenta = u.cuenta AND a.source_id = c.ctwa_source_id;
