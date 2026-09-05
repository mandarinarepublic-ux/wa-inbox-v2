'use client'
import { useState, useEffect } from 'react'
import { colorFor, initialsFor, fmtTime, parseDate, hashWamid } from '@/lib/utils'
import { partirEnlaces } from '@/lib/enlaces'
import { resumenDeLista } from '@/lib/resumen-lista'

// ── SPINNER ──────────────────────────────────────────────────────
export function Spinner({ size = 24 }) {
  return (
    <div style={{
      width: size, height: size,
      border: `${size * 0.125}px solid #1e2d3d`,
      borderTop: `${size * 0.125}px solid #25d366`,
      borderRadius: '50%',
      animation: 'spin .7s linear infinite',
      flexShrink: 0,
    }} />
  )
}

// ── AVATAR ───────────────────────────────────────────────────────
export function Avatar({ name, phone, size = 44 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: colorFor(phone),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 800, color: '#fff', flexShrink: 0,
      letterSpacing: '0.03em', userSelect: 'none',
    }}>
      {initialsFor(name)}
    </div>
  )
}

// ── STATUS PILL ──────────────────────────────────────────────────
export function StatusPill({ estado }) {
  const map = {
    recibido: { bg: 'rgba(239,68,68,.13)',   color: '#f87171', label: 'Sin leer' },
    leido:    { bg: 'rgba(100,116,139,.11)', color: '#64748b', label: 'Leído'    },
    enviado:  { bg: 'rgba(34,197,94,.11)',   color: '#4ade80', label: 'Enviado'  },
    error:    { bg: 'rgba(239,68,68,.16)',   color: '#f87171', label: 'Error'    },
  }
  const s = map[estado] || map.leido
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px',
      borderRadius: 20, background: s.bg, color: s.color,
    }}>{s.label}</span>
  )
}

// Read receipts estilo WhatsApp para mensajes SALIENTES.
// sent → ✓ gris · delivered → ✓✓ gris · read → ✓✓ azul · failed → ⚠ rojo.
export function Ticks({ estado }) {
  if (estado === 'failed') {
    return <span title="No se pudo entregar" style={{ fontSize: 11, color: '#f87171', fontWeight: 700 }}>⚠</span>
  }
  const doble = estado === 'read' || estado === 'delivered'
  const azul  = estado === 'read'
  const label = { sent: 'Enviado', delivered: 'Entregado', read: 'Leído' }[estado] || 'Enviado'
  return (
    <span title={label} style={{
      fontSize: 13, lineHeight: 1, letterSpacing: '-3px', paddingRight: 2,
      color: azul ? '#53bdeb' : '#8aa0b3', fontWeight: 700,
    }}>{doble ? '✓✓' : '✓'}</span>
  )
}

// ── Resaltar coincidencias de búsqueda ───────────────────────────
function highlight(text, query) {
  const t = String(text ?? '')
  const q = String(query || '').trim().toLowerCase()
  if (!q) return t
  const lt = t.toLowerCase()
  const parts = []
  let last = 0, idx, key = 0
  while ((idx = lt.indexOf(q, last)) !== -1) {
    if (idx > last) parts.push(t.slice(last, idx))
    parts.push(<mark key={key++} style={{ background:'#25d36633', color:'#4ade80', borderRadius:3, padding:'0 1px' }}>{t.slice(idx, idx + q.length)}</mark>)
    last = idx + q.length
  }
  if (last < t.length) parts.push(t.slice(last))
  return parts.length ? parts : t
}

// Etiqueta + color por estado (para el chip al buscar)
const ESTADO_INFO = {
  pendiente:    { label:'Pendiente',  color:'#f87171' },
  atendido:     { label:'Atendido',   color:'#4ade80' },
  ventaproceso: { label:'En proceso', color:'#f59e0b' },
  venta:        { label:'Venta',      color:'#10b981' },
  soporte:      { label:'Soporte',    color:'#a78bfa' },
  archivado:    { label:'Archivado',  color:'#64748b' },
}

// ── MINI-BURBUJA IA / HUMANO ─────────────────────────────────────
// Indica de un vistazo quién atiende el chat: la IA (🤖 verde) o un
// humano (🧑 ámbar, IA apagada). modoIA: true = IA, false = HUMANO.
function IABadge({ modoIA }) {
  const ia = modoIA !== false // undefined/true → IA prendida por defecto
  const c  = ia ? '#f59e0b' : '#25d366' // IA = amarillo, HUMANO = verde
  return (
    <span
      title={ia ? 'IA atendiendo' : 'Atiende un humano'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
        fontSize: 9, fontWeight: 800, letterSpacing: '.04em', lineHeight: 1,
        color: c, background: `${c}1e`, border: `1px solid ${c}55`,
        borderRadius: 20, padding: '2px 6px',
      }}
    >
      {ia ? '🤖 IA' : '🧑 TÚ'}
    </span>
  )
}

// ── CONTACT ROW ──────────────────────────────────────────────────
const TEMP_ICON = { caliente: '🔥', tibio: '🌤️', frio: '❄️' }
export function ContactRow({ conv, isActive, onClick, search = '', estado, modoIA, temp = '', alerta = false, msgSnippet = null, colorCanal = '', etiquetaCanal = '' }) {
  const [hovered, setHovered] = useState(false)
  const searching = String(search || '').trim().length > 0
  const info = ESTADO_INFO[estado] || null
  return (
    <div>
      <div
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '13px 16px', cursor: 'pointer', transition: 'all .12s',
          background: isActive
            ? 'rgba(37,211,102,.08)'
            : hovered ? 'rgba(255,255,255,.02)' : 'transparent',
          borderLeft: isActive ? '3px solid #25d366' : '3px solid transparent',
        }}
      >
        <Avatar name={conv.nombre} phone={conv.telefono} size={46} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {highlight(conv.nombre, search)}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {/* Chip del canal — SOLO en GENERAL, la única pestaña donde conviven
                  números distintos y donde el mismo cliente aparece dos veces.
                  Lleva el nombre y no solo el color: dos filas idénticas separadas
                  nada más por una franja se confunden en el celular, y equivocarse
                  de fila es responder por el número donde la ventana está cerrada.
                  El texto va en el color del canal para que casen chip y franja. */}
              {etiquetaCanal && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '.04em',
                  color: colorCanal || '#94a3b8',
                  background: `${colorCanal || '#94a3b8'}1e`,
                  border: `1px solid ${colorCanal || '#94a3b8'}55`,
                  borderRadius: 6, padding: '1px 6px', flexShrink: 0,
                }}>{etiquetaCanal}</span>
              )}
              {alerta && <span title="🔥 Caliente — cerca de cerrar la ventana de 24h" style={{ fontSize: 12, animation: 'pulse 2s infinite' }}>⏰</span>}
              {temp && TEMP_ICON[temp] && <span title={`Lead ${temp}`} style={{ fontSize: 12 }}>{TEMP_ICON[temp]}</span>}
              <IABadge modoIA={modoIA} />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {fmtTime(conv.last?.timestamp)}
              </span>
            </div>
          </div>
          {msgSnippet != null ? (
            // Búsqueda por MENSAJE: mostrar el fragmento que coincide + bandeja
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#8899aa', fontFamily: 'monospace' }}>+{conv.telefono}</span>
                {info && (
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.04em', color: info.color, background: `${info.color}1e`, border: `1px solid ${info.color}44`, borderRadius: 6, padding: '1px 6px', flexShrink: 0 }}>
                    {info.label}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                💬 {highlight(msgSnippet, search)}
              </div>
            </div>
          ) : searching ? (
            // Al BUSCAR contacto: mostrar el número (grande, resaltado) + en qué bandeja está
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                📱 {highlight('+' + conv.telefono, search)}
              </span>
              {info && (
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.04em', color: info.color, background: `${info.color}1e`, border: `1px solid ${info.color}44`, borderRadius: 6, padding: '1px 6px', flexShrink: 0 }}>
                  {info.label}
                </span>
              )}
            </div>
          ) : (
            <>
            {/* ── DE QUÉ ANUNCIO VINO ─────────────────────────────────
                816 conversaciones al mes arrancan con el mismo texto y en la
                bandeja se ven todas iguales. Esta línea dice de qué vino la
                persona; la de abajo, qué acaba de decir. Las dos hacen falta:
                una para saber de qué te habla, otra para saber qué contestar.

                ⚠️ Sale de la CONVERSACIÓN (conv.origenAnuncio), no del último
                mensaje. Cuando un chat espera respuesta el último suele ser un
                seguimiento y el anuncio quedó en el primero — medido: el
                referral del último se dispara en 0 de 20 pendientes de MANDI.

                Solo mientras el chat ESPERA respuesta: contestado, la fila
                vuelve a dos líneas y la bandeja no crece de alto por gusto.
                Y sin origen NO se pinta nada: un cliente del que no sabemos de
                dónde vino tiene que NOTARSE, no disfrazarse. */}
            {conv.origenAnuncio && conv.last?.direccion === 'ENTRANTE' && (
              <div style={{
                fontSize: 11, color: '#25d366', marginTop: 3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: 190,
              }} title={conv.origenAnuncio}>🎯 {conv.origenAnuncio}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
              <span style={{
                fontSize: 12,
                color: conv.unread > 0 ? '#94a3b8' : '#8899aa',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: 175,
                fontWeight: conv.unread > 0 ? 600 : 400,
              }}>
                {conv.last?.direccion === 'SALIENTE' ? 'Tú: ' : ''}
                {/* Una ubicación acá se veía como "📍 -0.18640510737896,-78.4934…":
                    ocupaba la fila entera sin decir nada. La vista de la lista no
                    trae `raw`, pero parseUbicacion igual saca el nombre del texto
                    cuando el cliente escogió un sitio guardado. */}
                {/* 816 conversaciones al mes arrancan con EXACTAMENTE el mismo texto
                    ("¡Hola! Quiero más información.", el que arma Meta al tocar un
                    anuncio) y en la lista se veían todas iguales. `resumenDeLista`
                    saca de qué anuncio o de qué producto viene. Solo en ENTRANTES:
                    al contestar vuelve a mandar el último mensaje. */}
                {(() => {
                  const r = resumenDeLista(conv.last)
                  if (r) return `${r.icono} ${r.texto}`
                  if (conv.last?.ubicacion) return `📍 ${conv.last.ubicacion.nombre || 'Ubicación'}`
                  return conv.last?.mensaje
                })()}
              </span>
              {conv.unread > 0 && (
                <span style={{
                  background: '#25d366', color: '#040807',
                  borderRadius: 10, fontSize: 11, fontWeight: 800,
                  padding: '1px 7px', marginLeft: 6, flexShrink: 0,
                }}>{conv.unread}</span>
              )}
            </div>
            </>
          )}
        </div>
      </div>
      {colorCanal && (
        // Separador de canal: dice por cuál número va a salir la respuesta si
        // abres este chat. Va DEBAJO de la fila, a lo ancho, para que se lea de
        // reojo bajando la columna sin tener que enfocar cada contacto.
        <div style={{ height: 2, background: colorCanal, opacity: .55, margin: '0 16px' }} />
      )}
    </div>
  )
}

// ── QUICK REPLIES ────────────────────────────────────────────────
const QUICK_REPLIES = [
  '¡Hola! ¿En qué te puedo ayudar? 😊',
  'Claro, con mucho gusto te atiendo.',
  'Dame un momento, ya te respondo.',
  '¿Podrías darme más detalles?',
  'Perfecto, queda confirmado ✅',
  'Gracias por tu mensaje, en breve te atendemos.',
  'Por supuesto, te ayudo con eso ahora mismo.',
]

export function QuickReplies({ onSelect }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: open ? 'rgba(37,211,102,.18)' : 'rgba(37,211,102,.08)',
          border: '1px solid rgba(37,211,102,.25)', color: '#25d366',
          borderRadius: 10, padding: '7px 14px', fontSize: 12, cursor: 'pointer',
          fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'inherit', transition: 'all .15s',
        }}
      >
        ⚡ Respuestas rápidas
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
          background: '#141a24', border: '1px solid #1e2d3d',
          borderRadius: 14, overflow: 'hidden', minWidth: 300,
          boxShadow: '0 16px 48px rgba(0,0,0,.6)', zIndex: 200,
        }}>
          {QUICK_REPLIES.map((r, i) => (
            <div
              key={i}
              onClick={() => { onSelect(r); setOpen(false) }}
              style={{
                padding: '11px 16px', fontSize: 13, color: '#cbd5e1',
                cursor: 'pointer', fontFamily: 'inherit',
                borderBottom: i < QUICK_REPLIES.length - 1
                  ? '1px solid rgba(255,255,255,.04)' : 'none',
                transition: 'background .1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(37,211,102,.07)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >{r}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── VISOR DE FOTO ────────────────────────────────────────────────
/**
 * Ver una foto del chat en grande, SIN salir del inbox.
 *
 * Antes la foto era un <a target="_blank">: cada una abría una pestaña nueva y
 * había que cerrarla con la X del navegador y volver al chat. Con 25 chats al
 * día eso son 25 pestañas y 50 clics.
 *
 * Cierra con CUALQUIER clic —incluido sobre la propia foto— y con Escape. Es
 * deliberado: acá no hay zoom ni nada que hacer sobre la imagen, así que pedir
 * puntería sobre el fondo o sobre una X sería fricción sin motivo.
 */
function VisorFoto({ src, onCerrar }) {
  useEffect(() => {
    const alTeclear = (e) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  return (
    <div
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Foto ampliada — toca en cualquier lado para cerrar"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, cursor: 'zoom-out', animation: 'up .15s ease',
      }}
    >
      <img src={src} alt="Foto ampliada" style={{
        maxWidth: '92vw', maxHeight: '90vh',
        objectFit: 'contain', borderRadius: 6, display: 'block',
      }} />

      {/* La X no hace falta para cerrar (cualquier clic cierra), pero se deja
          visible: sin ninguna señal, una pantalla negra no se ve "cerrable". */}
      <button onClick={onCerrar} aria-label="Cerrar" style={{
        position: 'fixed', top: 16, right: 20,
        background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8,
        color: '#fff', fontSize: 18, lineHeight: 1, cursor: 'pointer',
        padding: '8px 12px', fontFamily: 'inherit',
      }}>✕</button>

      {/* Abrir aparte sigue disponible para descargar o ver al 100%. Frena el
          clic para que el enlace no se coma su propio cierre. */}
      <a href={src} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,.1)', borderRadius: 8,
          color: '#fff', fontSize: 12, textDecoration: 'none',
          padding: '8px 14px', fontWeight: 600,
        }}>Abrir en pestaña ↗</a>
    </div>
  )
}

// ── MEDIA CONTENT ────────────────────────────────────────────────
function MediaContent({ tipo, mediaUrl, mediaId }) {
  // Va ANTES de cualquier return condicional: los hooks no pueden quedar
  // detrás de un if.
  const [verFoto, setVerFoto] = useState(false)
  const url = mediaUrl || ''
  const t   = String(tipo || '').toLowerCase()
  const has = !!(url || mediaId) // entrante directo de Meta trae solo mediaId (sin url)

  // Fuente: con MediaID (entrante de Meta) o URL de Meta → proxy /api/media (usa el
  // token server-side). Drive → vista. Cualquier otra URL pública → directa.
  const isMeta = /lookaside\.fbsbx\.com|graph\.facebook\.com/i.test(url)
  const src = mediaId
    ? `/api/media?id=${encodeURIComponent(mediaId)}`
    : isMeta
      ? `/api/media?url=${encodeURIComponent(url)}`
      : (url.includes('drive.google.com/uc') ? url.replace('export=download', 'export=view') : url)

  // Acepta tipos en inglés (Make/legacy) y español (webhook directo de Meta).
  const isImage    = ['image', 'imagen', 'sticker'].includes(t) || !!url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)
  const isAudio    = t === 'audio' || !!url.match(/\.(ogg|mp3|aac|m4a|opus)(\?|$)/i)
  const isVideo    = t === 'video' || !!url.match(/\.(mp4|mov|webm)(\?|$)/i)
  const isDocument = ['document', 'documento'].includes(t) || !!url.match(/\.(pdf|doc|docx|xls|xlsx)(\?|$)/i)

  if (has && isImage) return (
    <>
      {/* La foto ya no es un enlace: abre el visor de acá al lado, sin sacar a
          nadie del inbox. `img` sigue estando en la lista que ignora `alTocar`
          de la burbuja, así que tocarla no dispara "responder". */}
      <img
        src={src}
        alt="Foto — toca para verla en grande"
        title="Toca para ver en grande"
        onClick={() => setVerFoto(true)}
        style={{
          maxWidth: '100%', maxHeight: 260, borderRadius: 10,
          display: 'block', objectFit: 'cover', marginBottom: 6,
          border: '1px solid rgba(255,255,255,.06)',
          cursor: 'zoom-in',
        }}
        onError={e => { e.currentTarget.style.display = 'none' }}
      />
      {verFoto && <VisorFoto src={src} onCerrar={() => setVerFoto(false)} />}
    </>
  )

  if (has && isAudio) {
    const isDrive = url.includes('drive.google.com')
    if (isDrive) return (
      <a href={src} target="_blank" rel="noreferrer" style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
        background: 'rgba(37,211,102,.08)', border: '1px solid rgba(37,211,102,.15)',
        borderRadius: 10, padding: '10px 14px', textDecoration: 'none',
      }}>
        <span style={{ fontSize: 22 }}>🎵</span>
        <span style={{ fontSize: 13, color: '#25d366', fontWeight: 600 }}>Escuchar audio</span>
      </a>
    )
    return (
      <div style={{ marginBottom: 6, minWidth: 280 }}>
        <audio controls preload="metadata" src={src} style={{ width: '100%', minWidth: 280, height: 40, display: 'block', borderRadius: 10, outline: 'none', accentColor: '#25d366' }} />
        {/* Respaldo: si el reproductor inline falla (caché/navegador), este link
            abre el audio en pestaña nueva, donde siempre suena. */}
        <a href={src} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 11, color: '#25d366', textDecoration: 'none', fontWeight: 600 }}>
          🎧 Abrir audio ↗
        </a>
      </div>
    )
  }

  if (has && isVideo) return (
    <div style={{ marginBottom: 6, maxWidth: '100%' }}>
      <video
        controls
        preload="metadata"
        src={src}
        style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 10, display: 'block', border: '1px solid rgba(255,255,255,.06)' }}
      />
      {/* Respaldo: si el reproductor inline falla, abre el video en pestaña nueva. */}
      <a href={src} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 11, color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}>
        🎬 Abrir video ↗
      </a>
    </div>
  )

  if (has && isDocument) return (
    <a href={src} target="_blank" rel="noreferrer" style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
      background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.2)',
      borderRadius: 10, padding: '10px 14px', textDecoration: 'none',
    }}>
      <span style={{ fontSize: 22 }}>📄</span>
      <span style={{ fontSize: 13, color: '#818cf8', fontWeight: 600 }}>Documento adjunto</span>
    </a>
  )

  if (has && t && !['text', 'texto', 'reaction'].includes(t)) return (
    <a href={src} target="_blank" rel="noreferrer" style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
      background: 'rgba(37,211,102,.08)', border: '1px solid rgba(37,211,102,.15)',
      borderRadius: 10, padding: '10px 14px', textDecoration: 'none',
    }}>
      <span style={{ fontSize: 20 }}>📎</span>
      <span style={{ fontSize: 13, color: '#25d366', fontWeight: 600 }}>Abrir {tipo}</span>
    </a>
  )

  return null
}

// ── REFERRAL / PAUTA (anuncio Click-to-WhatsApp) ─────────────────
// Cuando un cliente entra desde un anuncio de Meta, el mensaje trae `referral`
// con el anuncio del que vino. Lo mostramos para responder con contexto.
function ReferralCard({ referral }) {
  let r = referral
  if (typeof r === 'string') { try { r = JSON.parse(r) } catch { return null } }
  if (!r || typeof r !== 'object') return null

  const img = r.image_url || r.thumbnail_url || ''
  const proxied = img && /lookaside\.fbsbx\.com|graph\.facebook\.com|fbcdn|scontent/i.test(img)
    ? `/api/media?url=${encodeURIComponent(img)}`
    : img
  if (!r.headline && !r.body && !proxied && !r.source_url) return null

  return (
    <div style={{
      border: '1px solid rgba(99,102,241,.35)',
      background: 'rgba(99,102,241,.10)',
      borderRadius: 12, padding: 8, marginBottom: 8,
      display: 'flex', gap: 8, alignItems: 'flex-start', maxWidth: '100%',
    }}>
      {proxied && (
        <img
          src={proxied}
          alt="anuncio"
          style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
          onError={e => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#818cf8', letterSpacing: '.03em', marginBottom: 2 }}>
          📣 VINO DE {r.source_type === 'post' ? 'UNA PUBLICACIÓN' : 'UN ANUNCIO'}
        </div>
        {r.headline && (
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#e2e8f0',
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>{r.headline}</div>
        )}
        {r.body && (
          <div style={{
            fontSize: 12, color: '#94a3b8', marginTop: 2,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', whiteSpace: 'pre-wrap',
          }}>{r.body}</div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {r.source_url && (
            <a href={r.source_url} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: '#818cf8', fontWeight: 600, textDecoration: 'none' }}>
              Ver anuncio ↗
            </a>
          )}
          {r.source_id && (
            <span style={{ fontSize: 10, color: '#475569' }}>ID: {r.source_id}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── QUOTED MESSAGE (cita) ────────────────────────────────────────
function QuotedMessage({ contextoId, allMsgs, esReaccion = false }) {
  const [fetched, setFetched] = useState(null)
  const valid    = !!contextoId && contextoId.startsWith('wamid.')
  const inWindow = valid && allMsgs ? allMsgs.find(m => hashWamid(m.id) === hashWamid(contextoId)) : null
  const cited    = inWindow || fetched
  // Si el mensaje citado quedó fuera de la ventana reciente, lo buscamos por API.
  const needFetch = valid && !inWindow && !fetched

  useEffect(() => {
    if (!needFetch) return
    let cancel = false
    fetch(`/api/mensaje?id=${encodeURIComponent(contextoId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancel && d && d.id) setFetched(d) })
      .catch(() => {})
    return () => { cancel = true }
  }, [contextoId, needFetch])

  if (!valid) return null

  // Fallback mientras resuelve, o si el mensaje citado ya no existe
  if (!cited) {
    // Una REACCIÓN cuyo mensaje no tenemos guardado no pinta nada: la burbuja ya
    // dice "❤️ Reaccionó a un mensaje", y encima de eso un "Respondió a un
    // mensaje anterior" sería redundante Y con el verbo equivocado. Pasa sobre
    // todo con reacciones a mensajes anteriores a nuestro historial.
    if (esReaccion) return null
    return (
      <div style={{
        borderLeft: '3px solid rgba(37,211,102,.5)',
        background: 'rgba(0,0,0,.25)',
        borderRadius: '0 8px 8px 0',
        padding: '5px 10px', marginBottom: 6,
        fontSize: 11, color: '#64748b', fontStyle: 'italic',
      }}>
        ↩️ Respondió a un mensaje anterior
      </div>
    )
  }

  const isImage = ['image','sticker'].includes(cited.tipo) || !!cited.mediaUrl?.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)

  return (
    <div style={{
      borderLeft: '3px solid rgba(37,211,102,.5)',
      background: 'rgba(0,0,0,.25)',
      borderRadius: '0 8px 8px 0',
      padding: '5px 10px',
      marginBottom: 6,
      maxWidth: '100%',
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#25d366', marginBottom: 2 }}>
        {cited.direccion === 'SALIENTE' ? 'Tú' : cited.nombre || cited.telefono}
      </div>
      {isImage && cited.mediaUrl ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <img
            src={/lookaside\.fbsbx\.com|graph\.facebook\.com/i.test(cited.mediaUrl)
              ? (cited.mediaId ? `/api/media?id=${encodeURIComponent(cited.mediaId)}` : `/api/media?url=${encodeURIComponent(cited.mediaUrl)}`)
              : cited.mediaUrl}
            alt="img citada"
            style={{ width: 36, height: 36, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
          {cited.mensaje && (
            <span style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cited.mensaje}
            </span>
          )}
        </div>
      ) : (
        <div style={{
          fontSize: 12, color: '#64748b',
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {cited.mensaje || `[${cited.tipo || 'media'}]`}
        </div>
      )}
    </div>
  )
}

// ── MESSAGE BUBBLE ───────────────────────────────────────────────
// `onResponder` (opcional): al tocar la burbuja aparece "↩ Responder" SOLO en ese
// mensaje. Nada visible hasta que el usuario toca — a propósito: una flecha fija en
// cada burbuja ensucia el hilo entero.
// ── TEXTO CON ENLACES ─────────────────────────────────────
//
// El chat pintaba el texto plano y una URL llegaba MUERTA: había que copiarla y
// pegarla a mano. Importa porque la web manda clientes por
// `api.whatsapp.com/send?text=…` y ahí va a viajar el link del producto.
//
// ☠️ Solo se enlazan http y https, por lista BLANCA (ver lib/enlaces.js): el
// texto lo escribe el cliente, y un `javascript:` en un href se ejecutaría en la
// sesión de quien atiende, que tiene la cookie del CRM.
//
// El `stopPropagation` es para que tocar un enlace ABRA el enlace y no despliegue
// el "Responder" de la burbuja.
function TextoConEnlaces({ texto }) {
  return partirEnlaces(texto).map((p, i) => (
    p.tipo === 'enlace' ? (
      <a key={i} href={p.href} target="_blank" rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
        style={{ color: '#25d366', textDecoration: 'underline', wordBreak: 'break-all' }}>
        {p.valor}
      </a>
    ) : p.valor
  ))
}

// ── TARJETA DE PEDIDO DEL CATÁLOGO ────────────────────────
//
// Meta manda SOLO el `product_retailer_id` de cada línea: ni nombre ni foto. El
// chat mostraba "1 × $35.00 (44500256129117)" y no había forma de saber qué se
// había vendido — 20 pedidos ($760) así. El nombre y la foto los resuelve
// lib/catalogo.js y llegan en msg.pedido.
//
// ☠️ Una línea que NO se pudo resolver muestra su id, NO se esconde. Siete ids de
// IND no tienen cómo resolverse todavía (su catálogo no pertenece a "Mandarina
// Lab"): si se filtraran, un pedido de 2 artículos se vería como de 1.
function PedidoCard({ pedido }) {
  const money = (n) => `$${Number(n || 0).toFixed(2)}`
  return (
    <div style={{
      background: 'rgba(37,211,102,.07)', border: '1px solid rgba(37,211,102,.35)',
      borderRadius: 12, padding: '9px 11px', minWidth: 210,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#25d366', marginBottom: 7 }}>
        📦 Pedido del catálogo
      </div>

      {pedido.items.map((it, i) => (
        <div key={i} style={{
          display: 'flex', gap: 8, alignItems: 'center',
          paddingTop: i ? 7 : 0, marginTop: i ? 7 : 0,
          borderTop: i ? '1px solid rgba(37,211,102,.16)' : 'none',
        }}>
          {it.imagen ? (
            <img src={it.imagen} alt="" loading="lazy" style={{
              width: 46, height: 46, borderRadius: 8, objectFit: 'cover',
              flexShrink: 0, background: '#0b1520',
            }} />
          ) : (
            <div style={{
              width: 46, height: 46, borderRadius: 8, flexShrink: 0,
              background: '#0b1520', border: '1px solid #1e2d3d',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>🛍️</div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
              {it.nombre || 'Producto no identificado'}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              {it.cant} × {money(it.precio)}
              {it.color ? ` · ${it.color}` : ''}
              {it.cant > 1 ? ` · ${money(it.total)}` : ''}
            </div>
            {/* Sin nombre, el id es lo ÚNICO que identifica el producto: se
                muestra para que se pueda buscar a mano en el catálogo. */}
            {!it.nombre && (
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 1, fontFamily: 'monospace' }}>
                {it.retailerId}
              </div>
            )}
          </div>
        </div>
      ))}

      <div style={{
        marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(37,211,102,.2)',
        display: 'flex', justifyContent: 'space-between', fontSize: 12,
      }}>
        <span style={{ color: '#94a3b8' }}>
          {pedido.items.length} {pedido.items.length === 1 ? 'artículo' : 'artículos'}
        </span>
        <span style={{ color: '#25d366', fontWeight: 700 }}>{money(pedido.total)}</span>
      </div>
      {/* ⚠️ La talla NO viene en el pedido: Meta no la manda y el catálogo la
          trae vacía. Hay que preguntársela al cliente SIEMPRE. */}
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
        ⚠️ El pedido no trae la talla — hay que preguntarla
      </div>
    </div>
  )
}

// ── TARJETA DE UBICACIÓN ──────────────────────────────────
//
// WhatsApp guarda la ubicación como texto ("📍 lat,lon nombre") y el chat mostraba
// esas coordenadas pelonas. Acá se pintan como tarjeta clicable que abre Google
// Maps. El objeto lo arma parseUbicacion (lib/wa-mensaje.js) y viaja en
// msg.ubicacion desde toMensaje.
//
// Meta manda `name`/`address` SOLO cuando el cliente escoge un sitio guardado;
// cuando suelta el pin de "ubicación actual" llegan puras coordenadas (27 de 38
// entrantes de IND). Por eso el título cae a "Ubicación compartida" y la segunda
// línea a las coordenadas redondeadas: la tarjeta NUNCA queda vacía.
function UbicacionCard({ u }) {
  const titulo   = u.nombre || 'Ubicación compartida'
  const coords   = `${Number(u.lat).toFixed(5)}, ${Number(u.lon).toFixed(5)}`
  const subtitulo = u.direccion || coords

  return (
    <a href={u.url} target="_blank" rel="noreferrer"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'block', textDecoration: 'none',
        background: 'rgba(37,211,102,.07)',
        border: '1px solid rgba(37,211,102,.35)',
        borderRadius: 12, padding: '9px 11px', minWidth: 190,
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18, lineHeight: 1.2 }}>📍</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: '#e2e8f0',
            wordBreak: 'break-word', lineHeight: 1.35,
          }}>{titulo}</div>
          <div style={{
            fontSize: 12, color: '#94a3b8', marginTop: 2,
            wordBreak: 'break-word', lineHeight: 1.35,
          }}>{subtitulo}</div>
          {/* La dirección desplaza las coordenadas: se muestran igual, porque son
              el dato con el que se busca el sitio si el nombre no alcanza. */}
          {u.direccion && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{coords}</div>
          )}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6,
            fontSize: 11, fontWeight: 700, color: '#25d366',
          }}>↗ Abrir en Google Maps</div>
        </div>
      </div>
    </a>
  )
}

export function MessageBubble({ msg, allMsgs, onResponder }) {
  const [accion, setAccion] = useState(false)
  const isMe     = msg.direccion === 'SALIENTE'

  // Un clic sobre una foto, un link o un botón hace LO SUYO, no abre el "Responder".
  const alTocar = (e) => {
    if (!onResponder) return
    if (e.target.closest('a, button, img, video, audio')) return
    setAccion(v => !v)
  }
  // Los entrantes de Meta (audio/video/doc) llegan SOLO con mediaId (sin mediaUrl):
  // sin incluir mediaId aquí, la burbuja no pintaba el reproductor (audios "mudos").
  const hasMedia = !!(msg.mediaUrl || msg.mediaId)
  const hasText  = !!msg.mensaje

  return (
    <div style={{
      display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start',
      marginBottom: 4, animation: 'up .2s ease',
    }}>
      <div className="msg-bubble"
        onClick={alTocar}
        title={onResponder ? 'Toca para responder a este mensaje' : undefined}
        style={{
        maxWidth: '68%',
        background: isMe ? '#0d4f3c' : '#111c2a',
        borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: '10px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,.3)',
        border: isMe ? '1px solid rgba(37,211,102,.1)' : '1px solid #1e2d3d',
        cursor: onResponder ? 'pointer' : 'default',
      }}>

        {msg.referral && <ReferralCard referral={msg.referral} />}

        {msg.contextoId && (
          <QuotedMessage contextoId={msg.contextoId} allMsgs={allMsgs} esReaccion={msg.tipo === 'reaction'} />
        )}

        {hasMedia && (
          <MediaContent tipo={msg.tipo} mediaUrl={msg.mediaUrl} mediaId={msg.mediaId} />
        )}

        {/* La ubicación reemplaza al texto: el `mensaje` de esa fila SON las
            coordenadas, y la tarjeta ya las muestra. Nunca deja la burbuja
            vacía — si parseUbicacion no reconoce algo, cae al <p> de siempre. */}
        {msg.pedido ? (
          <PedidoCard pedido={msg.pedido} />
        ) : msg.ubicacion ? (
          <UbicacionCard u={msg.ubicacion} />
        ) : hasText && (
          <p style={{
            margin: 0, fontSize: 14, color: '#e2e8f0',
            lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          }}><TextoConEnlaces texto={msg.mensaje} /></p>
        )}

        {/* Botones interactivos enviados por nosotros */}
        {isMe && msg.botones && (() => {
          try {
            const btns = typeof msg.botones === 'string' ? JSON.parse(msg.botones) : msg.botones
            if (!Array.isArray(btns) || btns.length === 0) return null
            return (
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:7 }}>
                {btns.map((btn, i) => (
                  <div key={i} style={{
                    padding:'5px 12px', borderRadius:20,
                    border:'1px solid rgba(37,211,102,.4)',
                    color:'#25d366', fontSize:12, fontWeight:600,
                    background:'rgba(37,211,102,.07)',
                  }}>[ {btn.title} ]</div>
                ))}
              </div>
            )
          } catch { return null }
        })()}

        {!hasText && !hasMedia && (
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
            {msg.tipo ? `[${msg.tipo}]` : '[mensaje]'}
          </p>
        )}

        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          alignItems: 'center', gap: 5, marginTop: 4,
        }}>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>
            {(() => {
              const d = parseDate(msg.timestamp)
              const today = new Date()
              const yesterday = new Date(today); yesterday.setDate(today.getDate()-1)
              const isToday = d.toDateString() === today.toDateString()
              const isYesterday = d.toDateString() === yesterday.toDateString()
              const timeStr = d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})
              if (isToday) return timeStr
              if (isYesterday) return `Ayer ${timeStr}`
              return `${d.getDate()}${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()]} ${timeStr}`
            })()}
          </span>
          {isMe && <Ticks estado={msg.estadoEntrega} />}
        </div>

        {/* Aparece SOLO en el mensaje que tocaste. Se va al usarlo o al tocar de nuevo. */}
        {accion && onResponder && (
          <div style={{ display:'flex', justifyContent: isMe ? 'flex-start' : 'flex-end', marginTop: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setAccion(false); onResponder(msg) }}
              style={{
                background:'rgba(37,211,102,.12)', border:'1px solid rgba(37,211,102,.45)',
                color:'#25d366', borderRadius:14, padding:'3px 12px',
                fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit',
              }}>↩ Responder</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── TOAST NOTIFICATION ───────────────────────────────────────────
export function Toast({ result }) {
  if (!result) return null
  // Si trae `msg`, muestra ese texto tal cual (lo usan los cambios de estado/temperatura).
  const custom = typeof result.msg === 'string' ? result.msg : null
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8, animation: 'up .2s ease' }}>
      <span style={{
        fontSize: 12, padding: '5px 16px', borderRadius: 20,
        background: result.ok ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
        color: result.ok ? '#4ade80' : '#f87171',
        border: `1px solid ${result.ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`,
      }}>
        {custom
          ? custom
          : result.ok
            ? result.demo
              ? '✓ Enviado (demo) — configura META_TOKEN para envío real'
              : '✓ Mensaje enviado por WhatsApp'
            : '✗ Error al enviar — intenta de nuevo'}
      </span>
    </div>
  )
}
