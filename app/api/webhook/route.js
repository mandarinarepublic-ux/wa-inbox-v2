import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { registrarContactoEntrante, getContactos, updateEstado, updateModoIA, marcarPush, marcarReceta, registrarAnuncioVisto, reclamarAvisoAnuncio, liberarAvisoAnuncio, updateTemperatura } from '@/lib/contactos'
import { decidirReceta, piezasDeReceta, textoAvisoAnuncioNuevo, esc } from '@/lib/recetas'
import { elegirFlujo, caminoLineal, decidirEntranteEnFlujo, elegirFlujoPorBoton, tituloBotonTocado, nodoDisparador } from '@/lib/flujo'
import { correrTanda } from '@/lib/flujo-motor'
import { getEstadoFlujo, guardarEstadoFlujo, borrarEstadoFlujo, registrarPasos } from '@/lib/flujos'
import { getRespuestas } from '@/lib/respuestas'
import { enviarTelegram } from '@/lib/telegram'
import { usaSupabaseLectura, CUENTA } from '@/lib/supabase'
import { guardarMensajeSupabase, existeWamidSupabase, guardarEventoCrudoSupabase, actualizarEstadoEntregaSupabase, asegurarConversacionSalienteSupabase, getFlujosPublicadosSupabase } from '@/lib/inbox-supabase'
import { archivarMedia } from '@/lib/media-archive'
import { parseLinkpago, crearLinkPago, mensajeLinkPago } from '@/lib/dlocal'
import { getAutomatizaciones } from '@/lib/automatizaciones'
import { enviarPush, avisoDeEntrante } from '@/lib/push'
import { decidirIA } from '@/lib/ia-canal'
import { extraer } from '@/lib/wa-mensaje'
import { extraerEchoes } from '@/lib/echoes'
import { extraerHistorial, extraerContactosSync } from '@/lib/coexistencia'
import { ponerNombreSiFaltaSupabase } from '@/lib/inbox-supabase'
import { observarFirmaMeta } from '@/lib/firma-meta'
import { enviarSaliente, responderConIA } from '@/lib/responder-ia'
import { capturarCtwaClid, revisarLeadAutomatico, revisarVentaEnProceso } from '@/lib/capi'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// Recetas de bienvenida: /api/saliente declara su propio maxDuration=60 porque
// subir fotos/voz es lento. Este valor le da a `procesar()` (donde vive el
// envío de la receta, dentro de un waitUntil) el mismo margen para terminar.
export const maxDuration = 60

// ── Webhook de Meta/WhatsApp — RECEPCIÓN directa (reemplaza a Make) ────────────
// CLAVE: le respondemos 200 a Meta AL INSTANTE y hacemos el trabajo pesado
// (escribir en la hoja + auto-respuesta IA) en segundo plano con waitUntil. Si
// bloqueáramos la respuesta esperando a la IA (~10s), Meta creería que fallamos y
// REINTENTARÍA el mismo mensaje → respuestas duplicadas al cliente.
//
// En Meta → WhatsApp → Configuration, Callback URL = https://wa-inbox-v2.vercel.app/api/webhook
// Verify Token = WHATSAPP_VERIFY_TOKEN. Suscribir el campo "messages".
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || ''

// Tipos de medio (según lo devuelve extraer() en lib/wa-mensaje.js) que hay que
// archivar a Supabase Storage: el media_id que da Meta es temporal (~30 dias) y sin
// esto el medio queda colgado del id de Meta y deja de reproducirse. Agregar un tipo
// nuevo aqui alcanza para que empiece a archivarse.
const TIPOS_MEDIA_ARCHIVABLES = ['imagen', 'sticker', 'audio', 'video', 'documento']

const tail9 = (s) => String(s || '').replace(/\D/g, '').replace(/^593/, '').replace(/^0+/, '').slice(-9)

// Dedup en memoria (sobrevive entre invocaciones en una instancia tibia): atrapa los
// reintentos rápidos de Meta al mismo servidor antes de tocar la hoja.
const procesados = new Set()
function marcarNuevo(wamid) {
  if (!wamid) return true
  if (procesados.has(wamid)) return false
  procesados.add(wamid)
  if (procesados.size > 600) procesados.delete(procesados.values().next().value)
  return true
}

// Mensaje de espera cuando el cliente manda algo que MANDI no procesa (una foto).
const MSG_ESPERA = 'Permíteme un momento por favor 🧡'

// Handoff invisible: el cliente mandó una imagen → MANDI no vende ni identifica.
// Se apaga la IA de ese chat (lo toma una persona) y se responde SOLO con el
// mensaje de espera, en la voz de MANDI.
//
// ⚠️ YA NO se cambia la bandeja a SOPORTE. Antes sí, y por eso esos chats
// desaparecían de Pendientes: el cliente mandaba una foto —o sea, casi siempre
// un pedido— y el chat se iba a una bandeja que quizá nadie miraba. Decisión de
// Rodrigo el 8-ago: **todas las conversaciones caen SIEMPRE en Pendientes**, para
// que su regla siga valiendo — "si esa bandeja está vacía, contesté a todos".
//
// Soporte sigue existiendo como bandeja, pero ahora se marca a mano. Ningún
// automatismo puede sacar un chat de Pendientes sin que una persona lo decida.
async function escalarASoporte(origin, phone, name, canal) {
  await updateModoIA(phone, 'HUMANO')
    .catch(e => console.error('[webhook IA] modoIA HUMANO:', e.message))
  await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: MSG_ESPERA, Canal: canal })
}

// ── Verificación del webhook (GET) ────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ── Trabajo pesado en segundo plano (fuera del ciclo de respuesta a Meta) ──────
async function procesar(nuevos, origin) {
  // Dedup por wamid contra Supabase (2ª capa, además del set en memoria + UNIQUE en BD).
  const vistos = new Set()
  const yaVisto = async (wamid) => {
    if (!wamid) return false
    if (vistos.has(wamid)) return true
    if (await existeWamidSupabase(wamid).catch(() => false)) return true
    return false
  }

  // `null` = TODOS los números. El webhook NO es una bandeja: atiende lo que entre
  // por cualquier canal, así que su agenda tiene que ser completa.
  //
  // Con el default (solo el número principal) un contacto del OTRO número no
  // aparecía nunca en esta lista, y de ahí salían tres mentiras seguidas:
  // esNuevoDe() daba siempre true → lo saludaba como nuevo EN CADA MENSAJE;
  // estadoDe() nunca veía 'atendido' → no lo reabría a PENDIENTE; y modoIAde()
  // y ultimoEntranteAtDe() lo trataban como si no tuviera historia.
  const contactos = await getContactos(null).catch(() => [])
  // Config de automatizaciones (saludos). Un fetch por ciclo. Si falla → sin saludos.
  const auto = await getAutomatizaciones().catch(() => null)
  // El CORTAFUEGOS por número se aplica ACA y no en cada sitio que llama al
  // agente: una sola fuente. Es la leccion de los 4 bugs del 27-29 jul, donde
  // habia cuatro caminos hacia /api/saliente y solo uno inyectaba el canal.
  const modoIAde = (phone, phoneId) => {
    const t = tail9(phone)
    const contacto = contactos.find(c => tail9(c.telefono) === t)
    return decidirIA({ config: auto, phoneId, contacto })
  }
  // Estado de flujo actual del contacto (snapshot de este ciclo). Contacto nuevo → 'pendiente'.
  const estadoDe = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c ? String(c.estado || 'pendiente').toLowerCase().trim() : 'pendiente'
  }
  // ¿Contacto NUEVO? El mensaje ya se guardó (creando la conversación), así que no
  // sirve el "creado" del registro: usamos el SNAPSHOT leído al inicio del ciclo —
  // si no está ahí, es su primer mensaje de la historia.
  const esNuevoDe = (phone) => !contactos.find(c => tail9(c.telefono) === tail9(phone))
  // ¿Hay una PERSONA atendiendo este chat ahora mismo? Se mira el snapshot (que es
  // de ANTES de este mensaje): si el último mensaje de la conversación fue NUESTRO
  // y es de hace menos de 24 h, alguien está contestando — desde el inbox o desde
  // el celular, da igual, la coexistencia guarda los dos. Solo sirve para callar
  // los disparadores por PALABRA: un flujo no puede meterse a media conversación
  // humana porque el cliente escribió "precio".
  const VENTANA_HUMANO_MS = 24 * 3600 * 1000
  const humanoAtendiendo = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    if (!c?.ultimoMensajeAt) return false
    const ultimo = Date.parse(c.ultimoMensajeAt)
    if (!Number.isFinite(ultimo)) return false
    const entrante = c.ultimoEntranteAt ? Date.parse(c.ultimoEntranteAt) : 0
    // `>` y no `>=`: cuando el último mensaje del chat ES el último entrante, las
    // dos marcas coinciden y eso significa que el que habló fue el CLIENTE.
    if (!(ultimo > (Number.isFinite(entrante) ? entrante : 0))) return false
    return Date.now() - ultimo < VENTANA_HUMANO_MS
  }
  // Marca de tiempo del ÚLTIMO entrante ANTERIOR (del snapshot) → detecta reactivación.
  const ultimoEntranteAtDe = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c?.ultimoEntranteAt ? new Date(c.ultimoEntranteAt).getTime() : 0
  }
  // Anti doble-saludo dentro del mismo lote de webhook.
  const saludados = new Set()

  // Último aviso push enviado por conversación (del snapshot de este ciclo).
  const ultimoPushAtDe = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c?.ultimoPushAt || null
  }
  // Anti doble-aviso dentro del mismo lote: el snapshot no se entera de lo que
  // acabamos de mandar hace dos mensajes.
  const avisados = new Set()

  // Aviso de mensaje nuevo al equipo (web push). Nunca lanza: un fallo acá no puede
  // tocar el webhook. Sin claves VAPID, enviarPush es un no-op silencioso.
  //
  // Se manda SIEMPRE. Lo único que se modera es el sonido, como WhatsApp: si ya
  // avisamos de esta conversación hace menos de un minuto, el aviso se actualiza
  // callado en vez de volver a sonar. `avisados` sigue evitando dos avisos por el
  // mismo lote de webhook.
  async function avisarSiCorresponde(m) {
    const t = tail9(m.telefono)
    if (avisados.has(t)) return
    avisados.add(t)
    await enviarPush(avisoDeEntrante(m, ultimoPushAtDe(m.telefono), Date.now()))
    await marcarPush(m.telefono)
  }

  // Saludo automático. Solo cuando la IA está APAGADA para el contacto (si está
  // prendida, el propio agente saluda → evitamos doble mensaje). Nuevo → saludo de
  // bienvenida; reactivación tras N horas de silencio → "hola de vuelta".
  async function saludarSiCorresponde(phone, name, canal) {
    if (!auto || modoIAde(phone, canal)) return
    const t = tail9(phone)
    if (saludados.has(t)) return
    const nuevo = esNuevoDe(phone)
    if (nuevo) {
      const s = auto.saludo_nuevo
      if (s?.activo && String(s.texto || '').trim()) {
        saludados.add(t)
        await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: s.texto.trim(), Canal: canal })
      }
      return
    }
    const s = auto.saludo_reactivacion
    if (s?.activo && String(s.texto || '').trim()) {
      const horas  = Number(s.horas) || 12
      const prevMs = ultimoEntranteAtDe(phone)
      if (prevMs && Date.now() - prevMs >= horas * 3600 * 1000) {
        saludados.add(t)
        await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: s.texto.trim(), Canal: canal })
      }
    }
  }

  // ── Recetas de bienvenida por anuncio ──────────────────────────────────────
  // Ver lib/recetas.js. Devuelve true si la receta QUEDÓ CONFIRMADA (entonces el
  // saludo automático no se manda: la receta ya saluda ella sola).
  //
  // Orden que importa:
  //   1. Se arman las piezas ANTES de marcar: una receta sin ninguna pieza
  //      (pasos huérfanos y sin pregunta) no debe quemar el marcado — dejaría
  //      al cliente 24h sin poder recibir ninguna receta por nada.
  //   2. marcarReceta ANTES de enviar, con guardia → una reentrega de Meta no
  //      duplica el paquete (el segundo proceso ve `marcado:false` y se va).
  //   3. `recetados` Y `saludados` se marcan juntos, apenas se confirma el
  //      envío: si no, el mensaje 2 del mismo lote corta por `recetados` pero
  //      el saludo automático de abajo no sabe que ya hubo receta y saluda
  //      IGUAL — el cliente recibe la receta Y el "bienvenido".
  //   4. El envío de las piezas se DESENGANCHA del loop con waitUntil: manda a
  //      /api/saliente (que declara su propio maxDuration=60 porque las fotos
  //      y la voz tardan) y ese mismo loop todavía tiene que guardar y
  //      procesar los demás mensajes del lote (m+1..n). Si esperáramos acá
  //      adentro, una función matada a mitad de una receta larga (texto + 3
  //      fotos + voz + pregunta = 6 llamadas) dejaría esos mensajes siguientes
  //      SIN GUARDAR. Las piezas siguen saliendo UNA a UNA con await, en el
  //      orden que Rodrigo cargó (texto → fotos → voz → pregunta), y una pieza
  //      rechazada se registra con su código y se sigue: mejor un paquete
  //      incompleto que uno mudo.
  let respuestasCache = null
  const respuestasRapidas = async () => {
    if (!respuestasCache) respuestasCache = await getRespuestas().catch(() => [])
    return respuestasCache
  }
  const recetados = new Set()
  async function recetaSiCorresponde(m) {
    if (!auto?.recetas?.activo) return false
    const t = tail9(m.telefono)
    if (recetados.has(t)) return false
    const sourceId = String(m.referral?.source_id || '').trim()
    const contacto = contactos.find(c => tail9(c.telefono) === t) || null
    const receta = decidirReceta({
      config: auto, sourceId, esNuevo: esNuevoDe(m.telefono),
      contacto: { ...(contacto || {}), telefono: m.telefono, nombre: m.nombre, phoneId: m.phoneId },
      botActivo: modoIAde(m.telefono, m.phoneId),
    })
    if (!receta) return false
    const piezas = piezasDeReceta({
      receta, respuestas: await respuestasRapidas(),
      contacto: { telefono: m.telefono, nombre: m.nombre, alias: contacto?.alias || '', phoneId: m.phoneId },
      // La primera pieza cita el mensaje del cliente, como "Responder" a mano.
      citaId: m.wamid,
    })
    if (!piezas.length) {
      console.warn('[/api/webhook] receta', receta.id, 'sin piezas que mandar (pasos huérfanos y sin pregunta), no se marca', m.telefono)
      return false
    }
    const { marcado } = await marcarReceta(m.telefono).catch(e => { console.error('[/api/webhook] marcar receta:', e.message); return { marcado: false } })
    if (!marcado) return false
    recetados.add(t)
    saludados.add(t)
    waitUntil((async () => {
      try {
        let salieron = 0
        for (const p of piezas) {
          const r = await enviarSaliente(origin, p)
          if (r?.ok) salieron++
          else console.error('[/api/webhook] receta', receta.id, 'pieza rechazada', r?.status ?? 'red', m.telefono)
        }
        console.log('[/api/webhook] receta', receta.id, 'a', m.telefono, `${salieron}/${piezas.length} piezas`)
        // Si NINGUNA pieza salió, el cliente quedó marcado (marcarReceta ya corrió)
        // pero sin recibir nada por 24h: nadie más lo va a intentar. Sin este aviso
        // el chat se pierde en silencio.
        if (salieron === 0 && piezas.length > 0) {
          await enviarTelegram(
            `⚠️ <b>Receta sin enviar en ${esc(CUENTA)}</b>\n` +
            `receta ${esc(receta.id)} a ${esc(m.telefono)}: 0/${piezas.length} piezas salieron. ` +
            `El chat quedó marcado 24 h. Revisa /api/saliente en los logs de Vercel.`
          ).catch(() => {})
        }
      } catch (e) {
        // Nunca relanzar: esto corre desenganchado del loop principal (waitUntil),
        // y una excepción acá no tiene a quién contarle nada más que al log.
        console.error('[/api/webhook] receta tarea falló:', e.message)
      }
    })())
    return true
  }

  // ── Flujos (creador visual de nodos, Fase A) ───────────────────────────────
  // Ver lib/flujo.js y docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md.
  // Corre ANTES que recetaSiCorresponde (§8 de la spec: "dos motores a la vez"),
  // que se retira en la Fase B — mientras tanto comparte el candado `marcarReceta`
  // (misma ventana de 24h) para que un cliente no reciba receta Y flujo a la vez.
  // Por eso esta función duplica a propósito la forma de recetaSiCorresponde en
  // vez de compartir código con ella: el controlador de la Fase A aceptó la
  // duplicación porque el camino de recetas se retira entero en la Fase B.
  //
  // Los flujos publicados se leen UNA vez por ciclo (como respuestasRapidas) y
  // solo cuando el mensaje puede de verdad disparar uno: trae referral, es de un
  // contacto nuevo, o trae texto (m.tipo==='texto') — así ni una imagen ni un
  // audio de un contacto ya conocido gastan la lectura.
  let flujosCache = null
  const flujosPublicados = async () => {
    if (!flujosCache) {
      // La consulta ya trae la columna `publicado` (que es lo que mira
      // `elegirFlujo`): acá no se remienda nada. Y si la lectura falla, se dice
      // en el log — un `[]` mudo se ve idéntico a "no hay flujos publicados".
      flujosCache = await getFlujosPublicadosSupabase().catch(e => {
        console.error('[/api/webhook] no pude leer los flujos publicados:', e.message)
        return []
      })
    }
    return flujosCache
  }

  // Lo que el motor de flujos (lib/flujo-motor.js) necesita del mundo, una vez
  // por ciclo. `enviar` va por /api/saliente con auto:true, como todo lo
  // automático: así NO reinicia el enfriamiento del push ni borra el estado.
  const depsFlujo = {
    enviar: (p) => enviarSaliente(origin, p),
    guardarEstado: guardarEstadoFlujo,
    borrarEstado: borrarEstadoFlujo,
    registrarPasos,
    setTemperatura: updateTemperatura,
    avisar: (texto) => enviarTelegram(texto),
    ahora: () => new Date(),
    cuenta: CUENTA,
    log: console.log,
  }
  const contactoParaFlujo = (m) => {
    const c = contactos.find(x => tail9(x.telefono) === tail9(m.telefono)) || null
    return {
      telefono: m.telefono, nombre: m.nombre, alias: c?.alias || '', phoneId: m.phoneId,
      temperatura: c?.temperatura || '', tieneVenta: Boolean(c?.idVenta), estado: c?.estado || 'pendiente',
      // El snapshot es de ANTES de este mensaje: el último entrante es ESTE, ahora.
      ultimoEntranteAt: new Date().toISOString(),
    }
  }

  // ── Fase B: el cliente YA está dentro de un flujo → avanzar ──────────────
  // Corre ANTES de evaluar disparadores: el que está gana (spec §4). Cuesta una
  // lectura por clave primaria, y solo si hay algún flujo publicado en el ciclo.
  async function flujoEnCursoSiCorresponde(m) {
    if (!auto?.flujos?.activo) return false
    const flujos = await flujosPublicados()
    if (!flujos.length) return false
    const estado = await getEstadoFlujo(m.telefono)
      .catch(e => { console.error('[/api/webhook] estado de flujo:', e.message); return null })
    if (!estado) return false
    const flujo = flujos.find(f => String(f.flujo_id) === String(estado.flujo_id)) || null
    // Un botón tocado llega como tipo 'texto' con el TÍTULO en `contenido`; el id
    // (rc_N ↔ btn_N) está en el crudo. Una foto o un audio no traen texto.
    const tipoCrudo = m.raw?.type
    const entrante = {
      botonId: m.raw?.interactive?.button_reply?.id || '',
      texto: ['text', 'interactive', 'button'].includes(tipoCrudo) ? m.contenido : '',
    }
    const d = decidirEntranteEnFlujo({ estado, flujo, entrante, ahora: new Date() })
    if (d.accion === 'borrar') {
      console.log('[/api/webhook] flujo en curso se retira:', d.motivo, m.telefono)
      await borrarEstadoFlujo(m.telefono).catch(() => {})
      return false
    }
    if (d.accion === 'ignorar') {
      // Está esperando un reloj: su mensaje va a PENDIENTES para una persona, y
      // ningún OTRO flujo ni receta puede entrar encima (el que está gana).
      recetados.add(tail9(m.telefono))
      return false
    }
    // Si la IA tomó el chat mientras tanto, el flujo no compite con ella.
    if (modoIAde(m.telefono, m.phoneId)) {
      await borrarEstadoFlujo(m.telefono).catch(() => {})
      return false
    }
    const respuestas = await respuestasRapidas()
    waitUntil(correrTanda(depsFlujo, {
      flujo, desde: d.desde, esDisparo: false, contacto: contactoParaFlujo(m),
      wamidEntrante: m.wamid, ultimoWamid: m.wamid, respuestas,
    }).catch(e => console.error('[/api/webhook] flujo en curso falló:', e.message)))
    return true
  }

  // ── Disparador "Botón tocado" (22-sep-2026) ──────────────────────────────
  // El vendedor manda una respuesta rápida con botones ("¿Cómo prefieres pagar?"
  // → Pichincha · Guayaquil · Produbanco) y cada toque se contesta solo con el
  // flujo publicado cuyo Disparador tiene ese título.
  //
  // A propósito NO pasa por las guardas de flujoSiCorresponde, que acá dirían lo
  // contrario de lo que se quiere:
  //   - humanoAtendiendo: el botón lo mandó una persona, así que SIEMPRE hay una.
  //   - marcarReceta (uno por cliente cada 24 h): al que vino de pauta ya le salió
  //     el saludo, y el que toca Pichincha y después Guayaquil necesita los dos.
  //   - modoIAde: el flujo gana; el llamador salta la IA para este mensaje, para
  //     que no conteste encima el título del botón (ni invente una cuenta).
  // La única guarda que sí queda es la de la tanda (`recetados`): un cliente que
  // ya recibió algo automático en ESTE lote no recibe otra cosa encima.
  async function flujoPorBotonSiCorresponde(m) {
    if (!auto?.flujos?.activo) return false
    const titulo = tituloBotonTocado(m.raw)
    if (!titulo) return false
    const flujo = elegirFlujoPorBoton({ flujos: await flujosPublicados(), titulo })
    if (!flujo) return false
    const t = tail9(m.telefono)
    if (recetados.has(t)) return false
    recetados.add(t)
    saludados.add(t)
    const respuestas = await respuestasRapidas()
    const disparador = nodoDisparador(flujo.grafo_vivo)
    console.log('[/api/webhook] botón', JSON.stringify(titulo), '→ flujo', flujo.nombre, m.telefono)
    waitUntil(correrTanda(depsFlujo, {
      flujo, desde: { nodoId: disparador.id, puerto: 'siguiente' }, esDisparo: true,
      contacto: contactoParaFlujo(m), wamidEntrante: m.wamid, ultimoWamid: m.wamid, respuestas,
    }).catch(e => console.error('[/api/webhook] flujo de botón falló:', e.message)))
    return true
  }

  async function flujoSiCorresponde(m) {
    // Interruptor general de FLUJOS (AUTOS). Va PRIMERO: apagado, ni se lee la
    // tabla. Ver DEFAULTS.flujos en lib/automatizaciones.js.
    if (!auto?.flujos?.activo) return false
    const tieneReferral = Boolean(m.referral?.source_id)
    const esNuevo = esNuevoDe(m.telefono)
    if (!tieneReferral && !esNuevo && m.tipo !== 'texto') return false
    const flujos = await flujosPublicados()
    const sourceId = String(m.referral?.source_id || '').trim()
    // ☠️ EL TEXTO QUE VE `elegirFlujo` NO ES SIEMPRE `m.contenido`: solo la rama de
    // PALABRA lo usa, y esa es la peligrosa (aplica a cualquier texto de cualquier
    // cliente, en cualquier momento de la conversación). Dos guardas:
    //   1. `m.raw?.type === 'text'` — y no `m.tipo`, porque un BOTÓN TOCADO y una
    //      UBICACIÓN llegan al inbox como `tipo:'texto'` (el título del botón, la
    //      dirección). "Sí, quiero" no puede disparar un flujo de palabra.
    //   2. `!humanoAtendiendo(...)` — si una persona está contestando este chat,
    //      el lienzo no compite con ella (spec §1).
    // NO se corta de entrada con un `return false`: sin texto, anuncio y orgánico
    // siguen funcionando igual para fotos, audios, ubicaciones y botones tocados.
    // Lo único que se silencia es la palabra clave.
    const textoPalabra = (m.raw?.type === 'text' && !humanoAtendiendo(m.telefono)) ? m.contenido : ''
    const flujo = elegirFlujo({ flujos, sourceId, esNuevo, texto: textoPalabra })
    if (!flujo) return false
    if (modoIAde(m.telefono, m.phoneId)) return false
    const t = tail9(m.telefono)
    if (recetados.has(t)) return false
    // Guardia de forma (sin red): un flujo cuyo camino se rompe antes del primer
    // mensaje no marca al cliente — si no, quedaría 24 h sin recibir nada.
    const forma = caminoLineal(flujo.grafo_vivo)
    if (forma.motivo === 'huerfano' && !forma.mensajes.length) {
      console.warn('[/api/webhook] flujo', flujo.nombre, 'arranca roto, no se marca', m.telefono)
      return false
    }
    const { marcado } = await marcarReceta(m.telefono).catch(e => { console.error('[/api/webhook] marcar flujo:', e.message); return { marcado: false } })
    if (!marcado) return false
    recetados.add(t)
    saludados.add(t)
    const respuestas = await respuestasRapidas()
    const disparador = flujo.grafo_vivo.nodos.filter(Boolean).find(n => n.tipo === 'disparador')
    // Mandar, guardar el estado (si se detiene en botones/espera), la temperatura
    // y la alarma de 0/N: todo eso vive en correrTanda (lib/flujo-motor.js).
    waitUntil(correrTanda(depsFlujo, {
      flujo, desde: { nodoId: disparador.id, puerto: 'siguiente' }, esDisparo: true,
      contacto: contactoParaFlujo(m), wamidEntrante: m.wamid, ultimoWamid: m.wamid, respuestas,
    }).catch(e => console.error('[/api/webhook] flujo tarea falló:', e.message)))
    return true
  }

  // Anuncio que el inbox ve por PRIMERA vez → un aviso por Telegram, una sola vez.
  // La compuerta es `avisado_at is null`, NO "la fila se creó ahora" (`nuevo`):
  // un anuncio pudo registrarse sin que el aviso saliera (Telegram caído, deploy a
  // mitad de un envío) y esa fila sigue con `avisado_at` en null para siempre.
  //
  // RECLAMAR antes de mandar, igual que marcarReceta antes de enviar la receta:
  // `avisado` de registrarAnuncioVisto es solo un chequeo BARATO para no reclamar
  // en cada mensaje de un anuncio que ya se avisó hace rato. El candado real es
  // reclamarAvisoAnuncio (UPDATE con WHERE avisado_at IS NULL): dos invocaciones
  // de `procesar` corriendo a la vez para el mismo anuncio nuevo (dos webhooks
  // concurrentes) pueden pasar las dos el chequeo barato, pero el reclamo solo
  // lo gana una — la otra ve `reclamado:false` y se va sin mandar Telegram. Si
  // el envío falla, se LIBERA el reclamo para que el siguiente referral del
  // mismo anuncio pueda reintentarlo (si no, ese anuncio queda avisado_at
  // puesto pero sin que nadie se haya enterado, para siempre).
  async function anuncioVistoSiCorresponde(m) {
    const sourceId = String(m.referral?.source_id || '').trim()
    if (!sourceId) return
    const { avisado } = await registrarAnuncioVisto({ sourceId, referral: m.referral })
    if (avisado !== false) return
    const { reclamado } = await reclamarAvisoAnuncio(sourceId)
    if (!reclamado) return // otro proceso ya se quedó con este aviso
    const texto = textoAvisoAnuncioNuevo({
      cuenta: CUENTA, titular: m.referral?.headline || '', sourceId,
      url: origin,
      tieneReceta: Boolean(auto?.recetas?.por_anuncio?.[sourceId]),
      tipo: m.referral?.source_type,
    })
    const r = await enviarTelegram(texto)
    if (!r?.ok) await liberarAvisoAnuncio(sourceId).catch(() => {})
  }

  // Archivado de fotos entrantes a Supabase Storage (URL estable en media_url).
  // Corre concurrente con la IA; lo esperamos al final para que waitUntil no mate
  // la función antes de terminar. Solo en modo supabase (la fila ya está insertada).
  const archivos = []

  for (const m of nuevos) {
    if (await yaVisto(m.wamid)) continue
    vistos.add(m.wamid)
    // Registro del entrante en Supabase (idempotente por wamid).
    await guardarMensajeSupabase({
      id: m.wamid, telefono: m.telefono, nombre: m.nombre, tipo: m.tipo,
      mensaje: m.contenido, mediaUrl: '', timestamp: m.fecha, direccion: 'ENTRANTE',
      mediaId: m.mediaId, contextoId: m.contextoId, referral: m.referral, raw: m.raw,
      phoneId: m.phoneId,
    }).catch(e => console.error('[/api/webhook] guardar entrante:', e.message))

    // Archivar el medio entrante (foto, sticker, audio, video o documento) a Supabase
    // Storage (URL estable → media_url). Solo en modo supabase, donde la fila ya quedó
    // insertada por guardarMensajeSupabase arriba.
    if (usaSupabaseLectura() && TIPOS_MEDIA_ARCHIVABLES.includes(m.tipo) && m.mediaId) {
      archivos.push(archivarMedia({ mediaId: m.mediaId, wamid: m.wamid }))
    }

    try { await registrarContactoEntrante(m.telefono, m.nombre, m.telefono) }
    catch (e) { console.error('[/api/webhook] contacto:', e.message) }

    // ── Señales a Meta (Conversions API) ─────────────────────────────────────
    // 1) Guardar de qué anuncio vino, si vino de uno. Va DESPUÉS de
    //    registrarContactoEntrante: la conversación tiene que existir para
    //    poder escribirle el clid.
    // 2) Avisarle a Meta cuando el chat ya se ganó el nombre de Lead.
    // Ninguna de las dos lanza nunca (ver lib/capi.js): Meta tiene que recibir
    // su 200 pase lo que pase, o reintenta y nos mete en rate limit (#131056).
    await capturarCtwaClid({ telefono: m.telefono, referral: m.referral, phoneId: m.phoneId })
      .catch(e => console.error('[/api/webhook] ctwa:', e.message))
    await revisarLeadAutomatico(m.telefono)
      .catch(e => console.error('[/api/webhook] lead capi:', e.message))
    await revisarVentaEnProceso(m.telefono)
      .catch(e => console.error('[/api/webhook] venta capi:', e.message))

    // Aviso al equipo. Va DESPUÉS de registrarContactoEntrante para que la
    // conversación exista y se le pueda escribir ultimo_push_at.
    await avisarSiCorresponde(m)
      .catch(e => console.error('[/api/webhook] aviso push:', e.message))

    // REABRIR: si un cliente escribe, su chat vuelve a PENDIENTES. SIEMPRE, venga
    // del estado que venga.
    //
    // Antes esto solo reabría los que estaban en 'atendido', respetando
    // venta/soporte/archivado por considerarlos "estados deliberados". Rodrigo lo
    // reportó el 8-ago: marcaba un chat, el cliente volvía a escribir y el chat NO
    // aparecía en Pendientes. Eso rompe la garantía con la que él trabaja:
    //
    //   "si tengo esa bandeja vacía, he contestado a todas las personas"
    //
    // Y esa garantía vale más que conservar la etiqueta: una bandeja de Pendientes
    // en la que un mensaje sin contestar puede NO aparecer no sirve para nada.
    // Ojo que a Soporte se llega solo —la IA escala ahí cuando el cliente manda una
    // foto—, así que había chats atascados sin que nadie los hubiera puesto ahí.
    //
    // La temperatura (🔥 caliente / 🌤️ tibio / ❄️ frío) es el OTRO eje y no se toca:
    // un chat puede estar en Pendientes y caliente a la vez, que es justo la idea.
    //
    // Se comprueba antes de escribir para no gastar una escritura por cada mensaje
    // de un chat que ya estaba en Pendientes, que es el caso más común.
    if (estadoDe(m.telefono) !== 'pendiente') {
      await updateEstado(m.telefono, 'PENDIENTE')
        .catch(e => console.error('[/api/webhook] reabrir a PENDIENTE:', e.message))
    }

    // Anuncio nuevo → aviso. Fuera del camino de guardado (waitUntil): un
    // Telegram lento no puede retrasar que se guarden los demás mensajes del
    // lote. Nunca lanza, nunca frena el resto.
    waitUntil(anuncioVistoSiCorresponde(m)
      .catch(e => console.error('[/api/webhook] anuncio visto:', e.message)))

    // Flujo publicado (Fase A) primero; recetas de bienvenida solo mientras sigan
    // activas (se retiran en la Fase B). Si alguno salió, reemplaza al saludo
    // automático.
    // Primero, si el cliente ya está dentro de un flujo, se avanza ese (el que
    // está gana: un entrante que dispararía otro flujo no reinicia nada).
    let conReceta = await flujoEnCursoSiCorresponde(m)
      .catch(e => { console.error('[/api/webhook] flujo en curso:', e.message); return false })
    let porBoton = false
    if (!conReceta) {
      porBoton = await flujoPorBotonSiCorresponde(m)
        .catch(e => { console.error('[/api/webhook] flujo de botón:', e.message); return false })
      conReceta = porBoton
    }
    if (!conReceta) {
      conReceta = await flujoSiCorresponde(m)
        .catch(e => { console.error('[/api/webhook] flujo:', e.message); return false })
    }
    if (!conReceta && auto?.recetas?.activo) {
      conReceta = await recetaSiCorresponde(m)
        .catch(e => { console.error('[/api/webhook] receta:', e.message); return false })
    }

    // Saludo automático (bienvenida a nuevo / "hola de vuelta" al reactivarse).
    // Va antes de LINKPAGO/IA y solo dispara con la IA apagada.
    if (!conReceta) {
      await saludarSiCorresponde(m.telefono, m.nombre, m.phoneId)
        .catch(e => console.error('[/api/webhook] saludo:', e.message))
    }

    // LINKPAGO<monto> entrante → genera link dLocal y lo devuelve al remitente.
    // Funciona SIEMPRE (independiente del modo IA), como el flujo viejo de Make.
    if (m.tipo === 'texto') {
      const monto = parseLinkpago(m.contenido)
      if (monto) {
        try {
          const link = await crearLinkPago(monto, `${m.telefono}-${Date.now()}`)
          await enviarSaliente(origin, { Telefono: m.telefono, Nombre: m.nombre || '', Mensaje: mensajeLinkPago(monto, link), Canal: m.phoneId })
        } catch (e) {
          console.error('[webhook LINKPAGO] falló:', e.message)
        }
        continue // no seguir con la IA para este mensaje
      }
    }

    // Un botón que ya contestó su flujo no se le pasa además a la IA.
    if (porBoton) continue

    // Auto-respuesta IA (solo si el contacto tiene la IA prendida):
    if (modoIAde(m.telefono, m.phoneId)) {
      if (m.tipo === 'texto' && String(m.contenido).trim()) {
        // Texto → MANDI responde normalmente.
        await responderConIA(origin, m.telefono, m.nombre, m.contenido, m.phoneId)
      } else if (m.tipo === 'imagen') {
        // Foto del cliente → NO vender/identificar: mensaje de espera + handoff a
        // SOPORTE (apaga la IA para que un ejecutivo tome el chat).
        await escalarASoporte(origin, m.telefono, m.nombre, m.phoneId)
      }
    }
  }

  // Esperar el archivado de fotos: mantiene viva la función (waitUntil) hasta que
  // todas las subidas a Storage + updates de media_url terminen. No bloquea la IA
  // (corrió concurrente durante el loop).
  if (archivos.length) await Promise.allSettled(archivos)
}

// Read receipts: procesa los value.statuses[] de Meta (sent/delivered/read/failed)
// y actualiza estado_entrega del mensaje saliente por wamid. Solo en modo supabase.
async function procesarStatuses(statuses) {
  if (!usaSupabaseLectura()) return
  for (const s of statuses) {
    await actualizarEstadoEntregaSupabase(s.wamid, s.estado)
      .catch(e => console.error('[webhook status]', e.message))
  }
}

// Echoes: lo que se responde DESDE EL CELULAR llega de vuelta por el webhook.
// Carril MÍNIMO a propósito: guardar y archivar el medio. Nada de saludos, IA,
// LINKPAGO, push ni cambios de estado — un echo no es un cliente escribiendo, es
// nuestra propia respuesta. Por eso no pasa por procesar(), que es donde vive
// todo eso: así no hay nada que acordarse de excluir.
async function procesarEchoes(echoes) {
  for (const e of echoes) {
    try {
      if (await existeWamidSupabase(e.wamid).catch(() => false)) continue
      await asegurarConversacionSalienteSupabase(e.telefono)
      await guardarMensajeSupabase({
        id: e.wamid, telefono: e.telefono, nombre: '', tipo: e.tipo,
        mensaje: e.contenido, mediaUrl: '', timestamp: e.fecha,
        direccion: 'SALIENTE', mediaId: e.mediaId, contextoId: e.contextoId,
        raw: e.raw, phoneId: e.phoneId,
      })
      // Escrito desde el CELULAR (coexistencia) = una persona contestó → el flujo
      // automático de ese cliente se retira, igual que al contestar desde el inbox.
      await borrarEstadoFlujo(e.telefono).catch(() => {})
      if (e.mediaId) await archivarMedia({ mediaId: e.mediaId, wamid: e.wamid }).catch(() => {})
    } catch (err) {
      console.error('[/api/webhook echo]', e.wamid, err.message)
    }
  }
}

// Historial del celular (coexistencia). Se guarda para poder LEERLO en el chat;
// no mueve bandejas ni ventanas (`historial: true` corta en guardarMensaje).
// La conversación se asegura como ATENDIDA si no existía, igual que un eco:
// nadie escribió hoy, no hay nada que contestar.
async function procesarHistorial(filas) {
  let guardados = 0
  for (const h of filas) {
    try {
      if (await existeWamidSupabase(h.wamid).catch(() => false)) continue
      await asegurarConversacionSalienteSupabase(h.telefono)
      await guardarMensajeSupabase({
        id: h.wamid, telefono: h.telefono, nombre: '', tipo: h.tipo,
        mensaje: h.contenido, mediaUrl: '', timestamp: h.fecha,
        direccion: h.direccion, mediaId: h.mediaId, contextoId: h.contextoId,
        raw: h.raw, phoneId: h.phoneId, historial: true,
      })
      guardados++
      if (h.mediaId) await archivarMedia({ mediaId: h.mediaId, wamid: h.wamid }).catch(() => {})
    } catch (err) {
      console.error('[/api/webhook historial]', h.wamid, err.message)
    }
  }
  console.log(`[/api/webhook historial] ${guardados}/${filas.length} guardados`)
}

// Agenda del celular (coexistencia): solo completa nombres que faltan.
async function procesarAgenda(contactos) {
  for (const c of contactos) {
    try { await ponerNombreSiFaltaSupabase(c.telefono, c.nombre) }
    catch (err) { console.error('[/api/webhook agenda]', c.telefono, err.message) }
  }
}

// ── Recepción de mensajes (POST) — responde 200 YA, procesa en background ──────
export async function POST(req) {
  try {
    // ⚠️ El cuerpo se lee UNA SOLA VEZ, como texto. No se puede hacer `req.text()`
    // y después `req.json()`: el cuerpo se consume y el segundo se queda sin nada,
    // o sea que el webhook dejaría de procesar mensajes. Se lee crudo porque la
    // firma de Meta se calcula sobre esos bytes exactos —re-serializar el JSON
    // cambia espacios y orden de claves y el sello ya no cuadraría— y de ahí se
    // parsea el objeto que usa todo lo de abajo.
    const crudo = await req.text().catch(() => '')
    let body = {}
    try { body = crudo ? JSON.parse(crudo) : {} } catch { body = {} }

    // Solo ANOTA si la firma habría coincidido. NO rechaza nada, a propósito:
    // ver el encabezado de lib/firma-meta.js. Envuelto por si acaso, aunque la
    // función ya se traga sus propios errores: nada acá puede tumbar la
    // recepción de un mensaje de un cliente.
    try { observarFirmaMeta(req.headers.get('x-hub-signature-256'), crudo) } catch {}

    const entries = body?.entry || []
    const origin = new URL(req.url).origin

    // Respaldo crudo (histórico tipo Make): guarda el POST COMPLETO tal cual llegó,
    // antes de parsear. En background: Meta recibe su 200 al instante. Best-effort.
    if (usaSupabaseLectura() && entries.length) {
      waitUntil(guardarEventoCrudoSupabase(body))
    }

    const nuevos = []
    const statuses = [] // read receipts: {wamid, estado}
    const echoes = []
    const historial = [] // coexistencia: mensajes viejos del celular
    const agenda = []    // coexistencia: nombres de la agenda del celular
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value    = change?.value || {}

        // Lo que se manda desde el CELULAR viene en value.message_echoes, no en
        // value.messages, y con `to`/`from` al revés. Carril aparte: el `continue`
        // garantiza que no toque nada del camino de los entrantes.
        if (change?.field === 'smb_message_echoes') {
          for (const fila of extraerEchoes(value)) {
            if (marcarNuevo(fila.wamid)) echoes.push(fila)
          }
          continue
        }

        // Coexistencia: al enganchar un número, Meta manda el HISTORIAL del
        // celular (`history`, en tandas) y su AGENDA (`smb_app_state_sync`).
        // Carriles aparte, como los ecos: no pasan por el camino de los entrantes
        // (ni saludos, ni IA, ni bandeja). Ver lib/coexistencia.js.
        if (change?.field === 'history') {
          for (const fila of extraerHistorial(value)) {
            if (marcarNuevo(fila.wamid)) historial.push(fila)
          }
          continue
        }
        if (change?.field === 'smb_app_state_sync') {
          agenda.push(...extraerContactosSync(value))
          continue
        }

        // Por cuál de NUESTROS números entró esto. Con un solo número daba igual;
        // con dos (MANDI y REPUBLIC) es lo único que permite separar las bandejas
        // y saber por dónde responder. Meta ya lo manda y se tiraba.
        const phoneId  = value?.metadata?.phone_number_id || ''
        const contacts = value?.contacts || []
        const nombreDe = {}
        for (const c of contacts) nombreDe[c.wa_id] = c.profile?.name || ''

        // Estados de entrega (✓✓) de mensajes que ENVIAMOS.
        for (const st of value?.statuses || []) {
          if (st?.id && st?.status) statuses.push({ wamid: String(st.id), estado: String(st.status).toLowerCase() })
        }

        for (const msg of value?.messages || []) {
          if (!marcarNuevo(msg.id)) continue // reintento rápido de Meta → ignorar
          const telefono = String(msg.from || '')
          const { tipo, contenido, mediaId, contextoId, referral } = extraer(msg)
          nuevos.push({
            wamid: msg.id || '',
            telefono,
            nombre: nombreDe[telefono] || '',
            tipo, contenido, mediaId, contextoId, referral, phoneId,
            raw: msg, // respaldo: objeto crudo del mensaje tal cual de Meta
            fecha: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
          })
        }
      }
    }

    // Meta exige un 200 rápido: lo damos YA y hacemos hoja+IA en segundo plano.
    if (nuevos.length) waitUntil(procesar(nuevos, origin))
    if (statuses.length) waitUntil(procesarStatuses(statuses))
    if (echoes.length && usaSupabaseLectura()) waitUntil(procesarEchoes(echoes))
    if (historial.length && usaSupabaseLectura()) waitUntil(procesarHistorial(historial))
    if (agenda.length && usaSupabaseLectura()) waitUntil(procesarAgenda(agenda))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/webhook]', err)
    return NextResponse.json({ ok: false, error: err.message })
  }
}
