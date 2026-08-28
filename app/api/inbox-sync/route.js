import { NextResponse } from 'next/server'
import { getLista, getMensajes } from '@/lib/mensajes'
import { getContactos } from '@/lib/contactos'
import { contarPendientesPorCanalSupabase, contarPendientesTotalSupabase, versionInboxSupabase } from '@/lib/inbox-supabase'
import { etagDe, sinCambios } from '@/lib/version-inbox'

// Sync unificado del inbox: UNA sola función en vez de 3 (/api/lista +
// /api/mensajes + /api/contactos) por cada ciclo de polling → 1/3 de las
// invocaciones. Las tres lecturas corren en paralelo.
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    // ?canal=<phone_id>. Cada bandeja pide la suya; sin parámetro, el número
    // principal (así una pestaña vieja en caché sigue viendo lo de siempre).
    // ?canal=todos es la pestaña GENERAL: null = sin filtro de número.
    const pedido = new URL(req.url).searchParams.get('canal') || undefined
    const canal = pedido === 'todos' ? null : pedido

    // ── "¿Cambió algo desde tu última pregunta?" ──────────────────────────
    // El ciclo completo son ~310 KB cada 25 s. Medido el 28-ago en horario de
    // atención: el 92% de los ciclos de MANDI NO trae nada nuevo. Eso es Fast
    // Origin Transfer, el 63% de la factura de Vercel.
    //
    // La versión NO se filtra por canal a propósito: el payload lleva los
    // pendientes de TODOS los números, así que un mensaje que entra por el otro
    // TIENE que invalidarla. Y en GENERAL la lista misma mezcla los dos.
    //
    // ⚠️ NO es un delta: si cambió cualquier cosa se manda TODO, igual que
    // siempre. Ante la duda también se manda todo (ver lib/version-inbox.js).
    //
    // La versión viaja por QUERY y vuelve en el CUERPO, no por cabecera: con
    // `If-None-Match`/`ETag` el log del borde mostró `cliente=NINGUNO` en todos
    // los polls de IND. El query y el cuerpo no los toca ninguna capa.
    const etagActual = etagDe(await versionInboxSupabase())
    const etagCliente = new URL(req.url).searchParams.get('v') || req.headers.get('if-none-match')
    if (sinCambios(etagCliente, etagActual)) {
      return new Response(null, { status: 304, headers: { ETag: etagActual, 'Cache-Control': 'no-store' } })
    }

    const [lista, rows, contactos, pendientes, pendientesTotal] = await Promise.all([
      getLista(canal),
      getMensajes(canal),
      // Contactos SIN filtro de canal, a propósito. El estado (pendiente, atendido,
      // ARCHIVADO, venta…) vive en la conversación, y hay UNA por cliente, no una
      // por número. En cambio la lista se filtra por el canal del MENSAJE.
      //
      // Filtrando los dos igual, un cliente que escribió a los dos números aparecía
      // en la lista de un canal mientras su ficha quedaba del lado del otro: la
      // pantalla no encontraba su estado, asumía "pendiente", y ARCHIVAR parecía no
      // funcionar (se guardaba bien y volvía a pintarse pendiente al refrescar).
      getContactos(null),
      // ☠️ AQUÍ ESTABA LA LECTURA QUE DEGRADÓ EL INBOX EL 19-ago. Se traía la tabla
      // `bandeja` ENTERA (1.642 filas) para saber el estado por canal — y como los
      // dos contadores de abajo también la leían, salían TRES lecturas completas
      // por ciclo: 6 viajes de red extra y +142 kB, en la ruta que ya es el 47 %
      // del consumo de Vercel. Se notaba a simple vista en el primer minuto de uso.
      //
      // Ya no existe: el estado viene PEGADO a cada fila de `getLista` (vista
      // `inbox.lista_bandeja`), sin una sola consulta extra.
      // De TODOS los canales, no solo del activo: alimenta el contador de la
      // pestaña que no se está mirando.
      contarPendientesPorCanalSupabase().catch(() => ({})),
      // El de GENERAL. Desde el 20-ago SÍ es la suma de los de arriba, y el cambio
      // es deliberado: GENERAL pasó a mostrar una fila por (cliente, número), así
      // que quien está pendiente en los dos aparece dos veces y el contador tiene
      // que decir dos. La regla no cambió — el contador cuenta lo que se ve debajo.
      // `null` (no 0) si falla, para que la pantalla sepa distinguir "no vino" de
      // "no hay ninguno" y caiga a la suma en vez de mostrar un 0 falso.
      contarPendientesTotalSupabase().catch(() => null),
    ])
    // `v` va en el cuerpo: de ahí lo toma el cliente para la próxima vuelta.
    return NextResponse.json({ lista, rows, contactos, pendientes, pendientesTotal, v: etagActual }, {
      // Cache COMPARTIDO en el edge, corto (5s) para no agregar latencia visible al
      // vendedor: varias pestañas que pollean dentro de la misma ventana comparten
      // UNA ejecución de origen. stale-while-revalidate sirve al instante y revalida.
      // 2 s de caché compartido (antes 5) y ventana corta de stale (antes 20):
      // con los valores viejos un mensaje entrante podía tardar ~35-45 s en
      // aparecer, sumando el polling. Ahora el peor caso baja a ~12-15 s.
      // Cuesta más invocaciones, es el precio de que la bandeja se sienta viva.
      //
      // ⚠️ 28-ago: el caché compartido SE QUITA y lo reemplaza el ETag. En IND se
      // midió que de 40 respuestas seguidas, 40 daban `cache=MISS` — con
      // s-maxage=2 y polls cada 10-25 s la entrada siempre expiraba, no ahorraba
      // nada. Y un caché por URL no distingue el condicional: podría guardar un
      // 304 y servírselo a una pestaña que sí necesitaba el cuerpo.
      headers: { ETag: etagActual, 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[/api/inbox-sync]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
