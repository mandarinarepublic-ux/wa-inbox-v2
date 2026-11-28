-- 🎯 PUNTAJE DE COMPRA por chat (28-nov-2026, pedido de Rodrigo).
--
-- Cada chat lleva su probabilidad de comprar (0-99 %), calculada con lo que se
-- midió en 2.061 chats de MANDI (29-jul → 29-oct): cuántos mensajes lleva el
-- cliente en este "episodio" y cuántas de estas señales dio:
--   · habló de TALLA      (91 % de los compradores, 26 % de los curiosos de pauta)
--   · habló de ENVÍO      (85 % vs 13 %)
--   · habló de PAGO       (87 % vs 6 %)
--   · mandó FOTO/DOCUMENTO
-- y si llegó de un ANUNCIO (pauta convierte ~4 %, orgánico ~20 %).
-- El ⭐ 100 % (ya hay pedido) NO sale de acá: lo pone la pantalla con el pedido
-- del CRM (inbox.pedido_por_telefono), que ya trae.
--
-- Piezas:
--   1. inbox.score_tabla      → la probabilidad de cada casillero (pauta × mensajes × señales).
--                               La recalcula inbox.recalcular_score_tabla() cada lunes (pg_cron).
--   2. conversaciones.score_* → el puntaje del chat. Lo mueve un trigger en cada ENTRANTE.
--
-- EPISODIO = desde el primer mensaje del cliente después de 30 días sin escribir.
-- Es la misma definición en el trigger y en el recálculo: si cambia en uno, cambia en los dos.
--
-- Todo es ADITIVO: columnas nullable, una tabla nueva, un trigger que nunca
-- rompe el insert (traga sus errores con un warning, igual que los otros dos de
-- inbox.mensajes). Reversión: ver el final del archivo.

-- ── 1. Columnas del chat ─────────────────────────────────────────────────────
alter table inbox.conversaciones
  add column if not exists score_pct    smallint,     -- 0..99; null = sin calcular
  add column if not exists score_k      smallint,     -- señales dadas (0..4)
  add column if not exists score_n      integer,      -- mensajes del cliente en el episodio
  add column if not exists score_motivo text,         -- 'talla,envio,pago,foto' (las que dio)
  add column if not exists score_pauta  boolean,      -- el episodio empezó con un anuncio
  add column if not exists score_desde  timestamptz,  -- inicio del episodio
  add column if not exists score_at     timestamptz;  -- última vez que se calculó

-- ── 2. La tabla de probabilidades ────────────────────────────────────────────
create table if not exists inbox.score_tabla (
  cuenta       text     not null,
  pauta        boolean  not null,
  nb           text     not null,          -- '1' | '2-3' | '4-7' | '8-15' | '16+'
  k            smallint not null,          -- 0..3 (3 = tres o más señales)
  chats        integer  not null,          -- episodios que pasaron por este casillero
  compras      integer  not null,          -- de esos, cuántos compraron en 30 días
  prob         numeric  not null,          -- suavizada (ver recalcular_score_tabla)
  calculado_at timestamptz not null default now(),
  primary key (cuenta, pauta, nb, k)
);
alter table inbox.score_tabla enable row level security;  -- solo el service role

-- Bitácora de cada recálculo: qué cohorte se usó y cuánto acertó la tabla anterior.
create table if not exists inbox.score_corridas (
  id            bigserial primary key,
  cuenta        text not null,
  corrida_at    timestamptz not null default now(),
  cohorte_desde timestamptz,
  cohorte_hasta timestamptz,
  episodios     integer,
  compras       integer,
  detalle       jsonb
);
alter table inbox.score_corridas enable row level security;

-- ── 3. Piezas puras (las usan el trigger Y el recálculo) ─────────────────────
create or replace function inbox.score_nb(n integer) returns text
language sql immutable as $$
  select case when n <= 1 then '1' when n <= 3 then '2-3' when n <= 7 then '4-7'
              when n <= 15 then '8-15' else '16+' end
$$;

-- ¿Este mensaje del cliente cuenta? Reacciones, avisos de sistema y los
-- placeholders 'unsupported' de las reentregas de Meta, no.
create or replace function inbox.score_contable(p_tipo text) returns boolean
language sql immutable as $$
  select coalesce(p_tipo, '') not in ('reaction', 'system', 'unsupported')
$$;

-- Señales de un texto como bits: 1 = talla, 2 = envío, 4 = pago.
create or replace function inbox.score_bits(p_texto text) returns integer
language sql immutable as $$
  select (case when t ~ '(talla|\m(s|m|l|xl|xxl|xs)\M|medida)' then 1 else 0 end)
       + (case when t ~ '(env[ií]o|entrega|domicilio|servientrega|retir|local|provincia|ciudad)' then 2 else 0 end)
       + (case when t ~ '(transfer|dep[oó]sit|pagar|pago|tarjeta|deuna|banco|comprobante|n[uú]mero de cuenta|a qu[eé] cuenta|abono)' then 4 else 0 end)
  from (select lower(coalesce(p_texto, '')) t) x
$$;

create or replace function inbox.score_hay_referral(r jsonb) returns boolean
language sql immutable as $$
  select r is not null and r::text not in ('null', '{}')
$$;

-- ── 4. Puntaje de UN chat ────────────────────────────────────────────────────
create or replace function inbox.actualizar_score(p_conv uuid) returns void
language plpgsql security definer set search_path to '' as $$
declare
  v_cuenta text; v_desde timestamptz; v_pauta boolean;
  v_n integer; v_bits integer; v_foto boolean; v_k smallint; v_prob numeric; v_motivo text;
begin
  select cuenta into v_cuenta from inbox.conversaciones where conversacion_id = p_conv;
  if v_cuenta is distinct from 'MANDI' then return; end if;   -- por ahora solo MANDI

  -- Inicio del episodio: el último entrante que llegó tras ≥30 días de silencio
  -- (o el primero de los últimos 180 días).
  select max(fecha) into v_desde from (
    select fecha, lag(fecha) over (order by fecha) prev
    from inbox.mensajes
    where conversacion_id = p_conv and direccion = 'ENTRANTE'
      and fecha > now() - interval '180 days'
  ) e where prev is null or fecha - prev >= interval '30 days';
  if v_desde is null then return; end if;

  select count(*) filter (where inbox.score_contable(tipo)),
         coalesce(bit_or(inbox.score_bits(coalesce(texto,'') || ' ' || coalesce(transcripcion,'')))
                  filter (where inbox.score_contable(tipo)), 0),
         coalesce(bool_or(tipo in ('imagen', 'documento')), false),
         coalesce(bool_or(inbox.score_hay_referral(referral) and fecha < v_desde + interval '5 minutes'), false)
    into v_n, v_bits, v_foto, v_pauta
  from inbox.mensajes
  where conversacion_id = p_conv and direccion = 'ENTRANTE' and fecha >= v_desde;

  v_k := ((v_bits & 1) > 0)::int + ((v_bits & 2) > 0)::int + ((v_bits & 4) > 0)::int + v_foto::int;
  v_motivo := concat_ws(',',
    case when (v_bits & 1) > 0 then 'talla' end,
    case when (v_bits & 2) > 0 then 'envio' end,
    case when (v_bits & 4) > 0 then 'pago' end,
    case when v_foto then 'foto' end);

  select prob into v_prob from inbox.score_tabla
  where cuenta = v_cuenta and pauta = v_pauta and nb = inbox.score_nb(greatest(v_n, 1)) and k = least(v_k, 3);

  update inbox.conversaciones set
    score_pct    = case when v_prob is null then null else least(99, greatest(0, round(v_prob * 100)))::smallint end,
    score_k      = v_k, score_n = v_n, score_motivo = nullif(v_motivo, ''),
    score_pauta  = v_pauta, score_desde = v_desde, score_at = now()
  where conversacion_id = p_conv
    and (score_pct, score_k, score_n, score_motivo, score_pauta, score_desde) is distinct from
        (case when v_prob is null then null else least(99, greatest(0, round(v_prob * 100)))::smallint end,
         v_k, v_n, nullif(v_motivo, ''), v_pauta, v_desde);
end $$;

-- ── 5. Trigger: cada mensaje del cliente mueve el puntaje ─────────────────────
-- También en UPDATE: la reentrega de Meta convierte el placeholder en el mensaje
-- real con UPDATE, y la transcripción de una nota de voz llega después.
-- Recalcula el episodio entero (idempotente): nunca cuenta dos veces.
create or replace function inbox.trg_score_mensaje() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_conv uuid;
begin
  begin
    v_conv := new.conversacion_id;
    if v_conv is null then
      select conversacion_id into v_conv from inbox.conversaciones
       where cuenta = new.cuenta and telefono = new.telefono;
    end if;
    if v_conv is not null then perform inbox.actualizar_score(v_conv); end if;
  exception when others then
    raise warning '[score] %: %', new.mensaje_id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists mensajes_score_trg on inbox.mensajes;
create trigger mensajes_score_trg
  after insert or update of tipo, texto, transcripcion, referral on inbox.mensajes
  for each row when (new.direccion = 'ENTRANTE' and new.cuenta = 'MANDI')
  execute function inbox.trg_score_mensaje();

-- ── 6. Recálculo semanal de la tabla ─────────────────────────────────────────
-- Cohorte: episodios que EMPEZARON entre hace 150 y hace 30 días (los 30 últimos
-- se excluyen porque todavía pueden comprar). Comprar = pedido de p_tienda con el
-- mismo celular (últimos 9 dígitos) dentro de los 30 días del inicio. Cada
-- episodio cuenta UNA vez en cada casillero por el que pasó, hasta el pedido.
--
-- Suavizado (para que un casillero con 2 chats no diga 0 % ni 100 %):
--   casillero → hacia su fila (pauta × mensajes) → hacia su grupo (pauta), con peso 4.
create or replace function inbox.recalcular_score_tabla(p_cuenta text default 'MANDI', p_tienda text default 'MANDARINA')
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_desde timestamptz := now() - interval '150 days';
        v_hasta timestamptz := now() - interval '30 days';
        v_res jsonb; v_prev jsonb;
begin
  set local statement_timeout = '170s';
  drop table if exists _score_celdas;

  -- Los casilleros por los que pasó cada episodio de la cohorte.
  create temp table _score_celdas on commit drop as
  with ent as (
    select m.conversacion_id, m.fecha, m.tipo, m.texto, m.transcripcion, m.referral,
           lag(m.fecha) over (partition by m.conversacion_id order by m.fecha) prev
    from inbox.mensajes m
    where m.cuenta = p_cuenta and m.direccion = 'ENTRANTE' and m.fecha > v_desde - interval '30 days'
  ),
  epi as (
    select conversacion_id, fecha desde, lead(fecha) over (partition by conversacion_id order by fecha) sig
    from ent where prev is null or fecha - prev >= interval '30 days'
  ),
  coh as (
    select e.*, right(regexp_replace(c.telefono, '\D', '', 'g'), 9) t9
    from epi e join inbox.conversaciones c using (conversacion_id)
    where e.desde >= v_desde and e.desde < v_hasta and coalesce(c.tipo_contacto, '') <> 'interno'
  ),
  ped as (
    select right(regexp_replace(cl.celular, '\D', '', 'g'), 9) t9, p.fecha_pedido
    from crm.pedidos p join crm.clientes cl using (cliente_id)
    where p.tienda_id = p_tienda and p.fecha_pedido >= v_desde
      and upper(coalesce(p.estado_pedido, '')) <> 'CANCELADO'
  ),
  coh2 as (
    select coh.*,
      (select min(ped.fecha_pedido) from ped where ped.t9 = coh.t9
         and ped.fecha_pedido > coh.desde and ped.fecha_pedido < coh.desde + interval '30 days') compra_at
    from coh
  ),
  msg as (
    select k.conversacion_id, k.desde, k.compra_at, e.fecha,
      inbox.score_contable(e.tipo) contable,
      inbox.score_bits(coalesce(e.texto,'') || ' ' || coalesce(e.transcripcion,'')) bits,
      (e.tipo in ('imagen','documento')) foto,
      (inbox.score_hay_referral(e.referral) and e.fecha < k.desde + interval '5 minutes') ref
    from coh2 k join ent e on e.conversacion_id = k.conversacion_id
    where e.fecha >= k.desde
      and e.fecha < least(coalesce(k.compra_at, 'infinity'), k.desde + interval '30 days', coalesce(k.sig, 'infinity'))
  ),
  snap as (
    select conversacion_id, desde, (compra_at is not null) compro,
      bool_or(ref) over (partition by conversacion_id, desde) pauta,
      count(*) filter (where contable) over w n,
      bit_or(case when contable then bits else 0 end) over w b,
      bool_or(foto) over w f, contable
    from msg
    window w as (partition by conversacion_id, desde order by fecha rows between unbounded preceding and current row)
  )
  select distinct conversacion_id, desde, compro, pauta, inbox.score_nb(n::int) nb,
    least(3, ((b & 1) > 0)::int + ((b & 2) > 0)::int + ((b & 4) > 0)::int + f::int)::smallint k
  from snap where contable and n >= 1;

  select jsonb_build_object(
    'episodios', count(distinct (conversacion_id, desde)),
    'compras',   count(distinct (conversacion_id, desde)) filter (where compro))
  into v_res from _score_celdas;

  -- Acierto de la tabla vieja: probabilidad media vs tasa real, por franja.
  select jsonb_object_agg(franja, jsonb_build_object('predicho', pred, 'real', real, 'casos', n))
  into v_prev from (
    select case when t.prob < .10 then '0-9' when t.prob < .50 then '10-49' else '50-99' end franja,
           round(avg(t.prob) * 100) pred, round(avg(c.compro::int) * 100) real, count(*) n
    from _score_celdas c join inbox.score_tabla t
      on t.cuenta = p_cuenta and t.pauta = c.pauta and t.nb = c.nb and t.k = c.k
    group by 1) x;

  with g0 as (select pauta, count(*) ch, count(*) filter (where compro) co from _score_celdas group by 1),
  g1 as (select pauta, nb, count(*) ch, count(*) filter (where compro) co from _score_celdas group by 1, 2),
  g2 as (select pauta, nb, k, count(*) ch, count(*) filter (where compro) co from _score_celdas group by 1, 2, 3),
  todas as (
    select p.pauta, n.nb, kk.k::smallint k
    from (values (true), (false)) p(pauta),
         (values ('1'), ('2-3'), ('4-7'), ('8-15'), ('16+')) n(nb),
         generate_series(0, 3) kk(k)
  ),
  calc as (
    select t.pauta, t.nb, t.k, coalesce(g2.ch, 0) ch, coalesce(g2.co, 0) co,
      g0.co::numeric / nullif(g0.ch, 0) p0, coalesce(g1.ch, 0) ch1, coalesce(g1.co, 0) co1
    from todas t
    left join g0 on g0.pauta = t.pauta
    left join g1 on g1.pauta = t.pauta and g1.nb = t.nb
    left join g2 on g2.pauta = t.pauta and g2.nb = t.nb and g2.k = t.k
  ),
  crudo as (
    select calc.*, (co + 4 * ((co1 + 4 * coalesce(p0, 0)) / (ch1 + 4))) / (ch + 4) r
    from calc
  ),
  -- Un casillero con menos de 5 chats no puede contradecir a sus vecinos firmes
  -- de la misma fila: más señales nunca bajan la probabilidad (medido 28-nov:
  -- "16+ mensajes, 0 señales" con 1 solo chat daba 44 %, más que con 1 señal).
  vecinos as (
    select crudo.*,
      max(r) filter (where ch >= 5) over (partition by pauta, nb order by k rows between unbounded preceding and 1 preceding) lo,
      min(r) filter (where ch >= 5) over (partition by pauta, nb order by k rows between 1 following and unbounded following) hi
    from crudo
  )
  insert into inbox.score_tabla (cuenta, pauta, nb, k, chats, compras, prob, calculado_at)
  select p_cuenta, pauta, nb, k, ch, co,
    least(.99, greatest(.005, case when ch >= 5 then r
      else greatest(least(greatest(r, coalesce(lo, 0)), coalesce(hi, 1)), coalesce(lo, 0)) end)),
    now()
  from vecinos
  on conflict (cuenta, pauta, nb, k) do update set
    chats = excluded.chats, compras = excluded.compras, prob = excluded.prob, calculado_at = excluded.calculado_at;

  -- Los chats vivos (último cálculo en 30 días) toman la probabilidad nueva sin
  -- esperar a que el cliente vuelva a escribir.
  update inbox.conversaciones c set
    score_pct = least(99, greatest(0, round(t.prob * 100)))::smallint
  from inbox.score_tabla t
  where c.cuenta = p_cuenta and c.score_at > now() - interval '30 days'
    and t.cuenta = c.cuenta and t.pauta = c.score_pauta
    and t.nb = inbox.score_nb(greatest(c.score_n, 1)) and t.k = least(c.score_k, 3)
    and c.score_pct is distinct from least(99, greatest(0, round(t.prob * 100)))::smallint;

  insert into inbox.score_corridas (cuenta, cohorte_desde, cohorte_hasta, episodios, compras, detalle)
  values (p_cuenta, v_desde, v_hasta, (v_res->>'episodios')::int, (v_res->>'compras')::int,
          jsonb_build_object('acierto_tabla_anterior', v_prev));

  return v_res || jsonb_build_object('acierto_tabla_anterior', v_prev);
end $$;

-- ── 7. Backfill: chats con mensajes del cliente en los últimos p_dias ──────────
create or replace function inbox.score_backfill(p_cuenta text default 'MANDI', p_dias integer default 30)
returns integer language plpgsql security definer set search_path to '' as $$
declare r record; v integer := 0;
begin
  for r in select conversacion_id from inbox.conversaciones
           where cuenta = p_cuenta and ultimo_entrante_at > now() - make_interval(days => p_dias)
  loop
    perform inbox.actualizar_score(r.conversacion_id); v := v + 1;
  end loop;
  return v;
end $$;

revoke all on function inbox.recalcular_score_tabla(text, text) from public, anon, authenticated;
revoke all on function inbox.score_backfill(text, integer) from public, anon, authenticated;
revoke all on function inbox.actualizar_score(uuid) from public, anon, authenticated;

-- ── 8. Cada lunes 03:00 de Ecuador (08:00 UTC) ───────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'score-tabla-mandi';
select cron.schedule('score-tabla-mandi', '0 8 * * 1',
  $$select inbox.recalcular_score_tabla('MANDI', 'MANDARINA')$$);

-- ── REVERSIÓN ────────────────────────────────────────────────────────────────
-- select cron.unschedule('score-tabla-mandi');
-- drop trigger if exists mensajes_score_trg on inbox.mensajes;
-- (las columnas y tablas pueden quedarse: nada más las lee o escribe)
