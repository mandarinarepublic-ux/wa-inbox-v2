-- Aplicada el 9-oct-2026 como migración `guias_servientrega` (registro de Supabase).
-- 🚚 Guías de Servientrega reenviadas al inbox: el resultado de leer cada una.
-- La fuente de verdad de "registrada" sigue siendo crm.guias_despacho; acá
-- queda lo que el inbox leyó y, sobre todo, POR QUÉ una no se pudo asignar.
create table if not exists inbox.guias_servientrega (
  cuenta          text not null,
  numero_guia     text not null,
  wa_message_id   text,
  fecha_mensaje   timestamptz,
  media_url       text,
  destino         text,
  direccion       text,
  destinatario    text,      -- leído de la foto (OCR)
  celular         text,      -- leído de la foto (OCR)
  estado          text not null default 'PENDIENTE' check (estado in ('PENDIENTE','REGISTRADA')),
  motivo          text,      -- por qué quedó pendiente
  pedido_id       text,      -- dónde quedó registrada
  metodo          text,      -- 'celular' | 'nombre' | 'manual'
  registrado_por  text,
  actualizado_en  timestamptz not null default now(),
  primary key (cuenta, numero_guia)
);
alter table inbox.guias_servientrega enable row level security;
create index if not exists guias_servientrega_fecha_idx on inbox.guias_servientrega (cuenta, fecha_mensaje desc);
