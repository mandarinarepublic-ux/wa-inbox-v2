# Señales a Meta desde el inbox (Conversions API · business messaging)

> Mismo documento en `ind-inbox-next/docs/CAPI-senales.md`. Los dos inbox comparten
> la implementación (`lib/capi.js` es byte por byte idéntico).

## El problema que resuelve

Meta ve el click en el anuncio y ahí se le corta el rastro. No sabe cuáles de esas
conversaciones avanzaron ni cuáles compraron, así que optimiza hacia quien **abre
un chat**, no hacia quien **paga**.

Y eso no es teórico. Medido el 1-ago-2026 sobre las conversaciones nacidas desde
el 14-jul (cuando arrancó la captura del clid):

| | conversaciones nuevas | vinieron de un anuncio | **convierten** |
|---|---|---|---|
| IND | 1 199 | 79,6 % | **1,15 %** |
| IND (otro origen) | 245 | — | **13,06 %** |
| MANDI | 385 | 82,1 % | **1,27 %** |
| MANDI (otro origen) | 69 | — | **8,70 %** |

**El 80 % del volumen viene de pauta y convierte 10 veces peor que el que llega
por otro lado.** Eso es exactamente lo que pasa cuando Meta optimiza hacia el
abridor de chats más barato: trae muchísimo clic frío. Devolverle Lead y Purchase
es lo que le permite empezar a buscar compradores en vez de curiosos.

### Por qué el porcentaje de ventas atribuidas se ve bajo al principio

No es que falte captura (se verificó: **0 referrals perdidos** entre el payload
crudo y la columna). Son tres cosas, y dos se curan solas con el tiempo:

1. **La captura es joven.** Un comprador que escribió por primera vez antes del
   14-jul no tiene clid y nunca lo va a tener. Esto se va a cero solo.
2. **Los otros números no grababan.** REPUBLIC (MANDARINA) y el 9804 (IND) recién
   entraron a Cloud API el 28/29-jul. Antes de esa fecha, el cruce de ventas
   contra conversaciones daba 14 % en MANDARINA; después, 62 %. En IND: 49 % → 82 %.
   Las ventas "sin conversación" sí la tenían — en el número que no se grababa.
3. **~25 % de los pedidos tienen un celular que nunca escribió.** Ese sí es un
   hueco real de datos (el vendedor registra otro número que el del chat) y no lo
   arregla este trabajo.

## Cómo queda el circuito

| Evento | Quién lo manda | Cuándo |
|---|---|---|
| `Lead` | el inbox (`lib/capi.js`) | el chat llega a **4 mensajes entrantes**, dentro de 72 h desde el click |
| `InitiateCheckout` | *(sin implementar — falta definir el disparador)* | — |
| `Purchase` | **el CRM** (`MANDARINACRM/lib/metaCapi.js`) | al crear el pedido |

**Purchase no sale del inbox a propósito.** Un evento solo puede tener un
`action_source`, así que mandar otro desde acá significaría dos Purchase por la
misma venta y el revenue reportado saldría al doble. El CRM es además el único
que sabe de pagos.

## Las cuatro cosas que hay que entender antes de tocar esto

1. **`action_source: 'business_messaging'` + `messaging_channel: 'whatsapp'`.**
   Con cualquier otro `action_source` Meta responde 200 OK y no atribuye nada:
   el evento se pierde en silencio. Un 200 no es prueba de nada.

2. **La llave es el `ctwa_clid`, no el teléfono ni el email.** Sin click id no
   hay nada que atribuir y el evento se descarta. Meta lo manda en el `referral`
   del primer mensaje que entra desde un anuncio; vive en
   `inbox.conversaciones.ctwa_clid` y **gana el primero, nunca se pisa**: si el
   cliente vuelve a entrar por otro anuncio, la venta le pertenece al que lo trajo.

3. **Meta NO deduplica los eventos de business messaging** (a diferencia del pixel
   web, donde le basta el `event_id`). La garantía de "un solo Lead por contacto"
   es nuestra: la da el `UNIQUE` de `inbox.capi_events.event_id`, que se inserta
   **antes** de llamar a Meta. Un chequeo previo tipo "si no existe, mandar"
   tendría carrera con Meta reintentando el mismo webhook.

4. **El `whatsapp_business_account_id` sale del `phone_id`, no de un env var.**
   Cada número está en una WABA distinta. El mapa está en `lib/canales.js` y lo
   cubre `tests/canales.test.js`.

## ⚠️ MANDI e IND comparten la misma base

`mandarina-DATA` (`piingkecjgoisnxccvaa`) es una sola, y
`inbox.conversaciones` es **`UNIQUE (cuenta, telefono)`**. Toda consulta lleva
`cuenta`. Filtrar solo por `telefono` le pondría el clid de un cliente de IND a
la ficha de MANDI del mismo número.

## Los números reales (sacados del tráfico, no de la documentación)

Confirmados contra `entry[0].id` de `inbox.webhook_eventos`:

| cuenta | número | phone_id | WABA |
|---|---|---|---|
| MANDI | +593 98 374 5757 | `1024077200794372` | `1250794910496982` |
| MANDI | +593 97 910 4167 (REPUBLIC) | `118582961194601` | `110133805380815` |
| IND | +593 99 995 3326 | `1153686904504422` | `1043571971409840` |
| IND | +593 98 415 9804 | `2241248862581450` | `396966121059860` |

Pixels (negocio `114968056344676`): MANDARINA `612911870044679`
("PixelFinalMandarinaRepublic"), IND `1520595899347453` ("IND WEB").

**Si se migra un número de WABA** (pasó con el 3326 el 28-jul-2026) hay que
actualizar `lib/canales.js` de ese inbox **y** el mapa `WABA_POR_PHONE_ID` de
`MANDARINACRM/lib/metaCapi.js`. Nada se rompe visiblemente: lo único que se cae
es la atribución, en silencio y semanas después.

## Variables de entorno

Sin estas dos, `capiConfigurado()` es `false` y **no se manda nada** (el inbox
funciona igual). Es el interruptor: quitarlas revierte la función sin desplegar.

| Variable | MANDI | IND |
|---|---|---|
| `META_CAPI_PIXEL_ID` | `612911870044679` | `1520595899347453` |
| `META_CAPI_TOKEN` | token del dataset de Mandarina | token del dataset IND WEB |
| `CAPI_LEAD_UMBRAL` | opcional, default `4` | igual |
| `CAPI_VENTANA_HORAS` | opcional, default `72` | igual |

Los tokens de CAPI quedan **atados al dataset desde el que se generan**: el de
Mandarina no sirve para IND WEB (Meta responde "Object with ID … cannot be
loaded due to missing permissions"). El CRM ya tiene los dos, en
`META_CAPI_TOKEN` y `META_CAPI_TOKEN_INDSTORE` — son esos mismos.

## Consultas de salud

```sql
-- Qué se mandó y cómo le fue
select cuenta, event_name,
       count(*) enviados,
       count(*) filter (where http_status = 200) ok,
       count(*) filter (where http_status is distinct from 200) fallidos,
       max(sent_at) ultimo
from inbox.capi_events
group by 1, 2 order by 1, 2;

-- Cobertura de atribución por marca
select cuenta,
       count(*) filter (where ctwa_clid is not null) con_atribucion,
       count(*) total,
       round(100.0 * count(*) filter (where ctwa_clid is not null) / count(*), 1) pct
from inbox.conversaciones group by 1;

-- Los que fallaron, con el motivo que dio Meta
select cuenta, telefono, event_name, http_status,
       meta_response->'error'->>'message' motivo, sent_at
from inbox.capi_events
where http_status is distinct from 200
order by sent_at desc limit 50;

-- ¿Se está cerrando el círculo? Ventas de clientes que vinieron de un anuncio.
-- (El Purchase lo manda el CRM, por eso no está en capi_events.)
select p.tienda_id,
       count(*) ventas,
       count(c.ctwa_clid) con_atribucion,
       round(sum(p.monto_total) filter (where c.ctwa_clid is not null)::numeric, 2) usd_atribuido
from crm.pedidos p
join crm.clientes cl on cl.cliente_id = p.cliente_id
left join inbox.conversaciones c
  on c.cuenta = case when upper(p.tienda_id) like '%IND%' then 'IND' else 'MANDI' end
 and right(regexp_replace(c.telefono,  '\D', '', 'g'), 9)
   = right(regexp_replace(cl.celular,  '\D', '', 'g'), 9)
where p.estado_pago = 'PAGADO'
group by 1 order by 1;
```

## Verificar en Meta

Events Manager → el dataset → **Test Events**, y elegir el canal de mensajería
(business messaging → WhatsApp). Los eventos con `action_source` de mensajería
**no aparecen en la vista web por defecto**: si se mira ahí, parece que no llegó
nada. Las estadísticas tardan ~30 min.

## Lo que quedó pendiente

- **`InitiateCheckout` no tiene disparador.** El plan original apuntaba a un
  estado `VENTAPROCESO` que ya no existe (es vocabulario muerto, solo queda una
  mención en `lib/social-agrupar.js`). Los estados reales hoy son `PENDIENTE`,
  `ATENDIDO`, `ARCHIVADO`, `SOPORTE` y `VENTA` (esta última con 1 sola
  conversación en IND). Hay que decidir cuál es la señal de "propuesta enviada"
  antes de implementarlo.
- **El backfill sirvió para guardar el clid, no para mandar eventos viejos.**
  Meta rechaza eventos de más de 7 días: de los 297 contactos que califican como
  Lead, solo ~41 caían dentro de la ventana. El valor está de aquí en adelante.
