-- Suscripciones de web push (un aparato/navegador por fila).
create table if not exists inbox.push_subs (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  creado      timestamptz not null default now(),
  fallos      int not null default 0
);

-- Enfriamiento del aviso, por conversación. Misma convención que
-- ultimo_seguimiento_at y alerta_ventana_at.
alter table inbox.conversaciones
  add column if not exists ultimo_push_at timestamptz;

-- PostgREST cachea el esquema: sin esto la tabla nueva da 404 hasta el
-- siguiente reinicio.
notify pgrst, 'reload schema';
