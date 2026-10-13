-- 🏷️ ETIQUETAS de chats — 13-oct-2026 (migración `etiquetas` en el registro de Supabase).
--
-- La Cloud API NO tiene etiquetas: existen solo en la app WhatsApp Business y la
-- API no las lee ni las escribe. Por eso viven acá.
--
-- Son POR PERSONA (una fila de `conversaciones` = cuenta + teléfono), no por número:
-- igual que la temperatura y la etapa. La base es compartida con IND → todo lleva
-- `cuenta`; las etiquetas de MANDI no existen para IND.
--
-- Cómo llegan a la pantalla sin encarecer la ruta caliente:
--   · `etiquetas_por_telefono` trae SOLO los chats que tienen alguna (no una fila
--     por contacto: la ficha de contactos ya es el 65 % del payload de inbox-sync).
--   · Poner/quitar una etiqueta toca `conversaciones.updated_at` (trigger), que es
--     una de las marcas del ETag de inbox-sync → las otras pestañas se enteran.

create table if not exists inbox.etiquetas (
  etiqueta_id  bigint generated always as identity primary key,
  cuenta       text not null check (cuenta in ('IND','MANDI')),
  nombre       text not null check (btrim(nombre) <> ''),
  color        text not null default '#25d366' check (color ~ '^#[0-9a-fA-F]{6}$'),
  activa       boolean not null default true,
  -- Regla automática que la pone sola ('pauta' | 'productos'). Se busca por esta
  -- clave y no por el nombre: así se puede renombrar sin romper la regla.
  clave        text check (clave is null or clave in ('pauta','productos')),
  creada_en    timestamptz not null default now()
);
create unique index if not exists etiquetas_cuenta_nombre_uq on inbox.etiquetas (cuenta, lower(btrim(nombre)));
create unique index if not exists etiquetas_cuenta_clave_uq on inbox.etiquetas (cuenta, clave) where clave is not null;
alter table inbox.etiquetas enable row level security;

create table if not exists inbox.conversacion_etiquetas (
  conversacion_id uuid   not null references inbox.conversaciones(conversacion_id) on delete cascade,
  etiqueta_id     bigint not null references inbox.etiquetas(etiqueta_id) on delete cascade,
  puesta_por      text   not null,   -- usuario del inbox, o 'auto'
  puesta_en       timestamptz not null default now(),
  primary key (conversacion_id, etiqueta_id)
);
create index if not exists conversacion_etiquetas_etiqueta_idx on inbox.conversacion_etiquetas (etiqueta_id);
alter table inbox.conversacion_etiquetas enable row level security;

-- Poner o quitar una etiqueta mueve el ETag de inbox-sync.
create or replace function inbox.etiquetas_tocar_conversacion() returns trigger
language plpgsql security definer set search_path = inbox, public as $$
begin
  update inbox.conversaciones set updated_at = now()
   where conversacion_id = coalesce(new.conversacion_id, old.conversacion_id);
  return null;
end $$;
drop trigger if exists conversacion_etiquetas_tocar_trg on inbox.conversacion_etiquetas;
create trigger conversacion_etiquetas_tocar_trg
  after insert or delete on inbox.conversacion_etiquetas
  for each row execute function inbox.etiquetas_tocar_conversacion();

-- Regla automática "Pauta": entrante con referral → etiqueta de clave 'pauta'.
-- En la base y no en el webhook: no frena el 200 a Meta, y cubre la reentrega
-- (el referral puede llegar en el UPDATE que reemplaza al placeholder).
-- Solo actúa si la cuenta TIENE una etiqueta 'pauta' activa (hoy solo MANDI).
-- NUNCA tumba el guardado del mensaje: cualquier error se traga con WARNING.
create or replace function inbox.etiqueta_pauta_auto() returns trigger
language plpgsql security definer set search_path = inbox, public as $$
declare v_etiqueta bigint; v_conv uuid;
begin
  begin
    if new.direccion = 'ENTRANTE' and new.referral is not null
       and new.referral::text not in ('null','{}') then
      select etiqueta_id into v_etiqueta from inbox.etiquetas
       where cuenta = new.cuenta and clave = 'pauta' and activa;
      if v_etiqueta is not null then
        v_conv := new.conversacion_id;
        if v_conv is null then
          select conversacion_id into v_conv from inbox.conversaciones
           where cuenta = new.cuenta and telefono = new.telefono;
        end if;
        if v_conv is not null then
          insert into inbox.conversacion_etiquetas (conversacion_id, etiqueta_id, puesta_por)
          values (v_conv, v_etiqueta, 'auto') on conflict do nothing;
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'etiqueta_pauta_auto: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists mensajes_etiqueta_pauta_trg on inbox.mensajes;
create trigger mensajes_etiqueta_pauta_trg
  after insert or update of referral on inbox.mensajes
  for each row when (new.referral is not null)
  execute function inbox.etiqueta_pauta_auto();

-- Para la pantalla: solo los chats con alguna etiqueta ACTIVA.
create or replace view inbox.etiquetas_por_telefono with (security_invoker = on) as
select c.cuenta, c.telefono, array_agg(ce.etiqueta_id order by ce.puesta_en, ce.etiqueta_id) as etiquetas
  from inbox.conversacion_etiquetas ce
  join inbox.conversaciones c using (conversacion_id)
  join inbox.etiquetas e on e.etiqueta_id = ce.etiqueta_id and e.activa
 group by c.cuenta, c.telefono;

-- Para cruzar con el CRM por SQL (por teléfono, como `pedido_por_telefono`).
create or replace view inbox.etiquetas_chats with (security_invoker = on) as
select c.cuenta, c.telefono, c.nombre_contacto, e.nombre as etiqueta, e.color, e.activa,
       ce.puesta_por, ce.puesta_en
  from inbox.conversacion_etiquetas ce
  join inbox.conversaciones c using (conversacion_id)
  join inbox.etiquetas e on e.etiqueta_id = ce.etiqueta_id;

-- Las dos automáticas de MANDI. "Le mostré productos" la pondrá el carrusel (parte 2).
insert into inbox.etiquetas (cuenta, nombre, color, clave) values
  ('MANDI', 'Pauta', '#1877f2', 'pauta'),
  ('MANDI', 'Le mostré productos', '#f59e0b', 'productos')
on conflict do nothing;
