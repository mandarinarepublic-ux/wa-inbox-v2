'use client'
import { useState, useEffect } from 'react'
import { colorFor, initialsFor, fmtTime, parseDate, hashWamid } from '@/lib/utils'

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

// ── CONTACT ROW ──────────────────────────────────────────────────
export function ContactRow({ conv, isActive, onClick, search = '', estado, msgSnippet = null }) {
  const [hovered, setHovered] = useState(false)
  const searching = String(search || '').trim().length > 0
  const info = ESTADO_INFO[estado] || null
  return (
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>
            {highlight(conv.nombre, search)}
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0, marginLeft: 6 }}>
            {fmtTime(conv.last?.timestamp)}
          </span>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
            <span style={{
              fontSize: 12,
              color: conv.unread > 0 ? '#94a3b8' : '#8899aa',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 175,
              fontWeight: conv.unread > 0 ? 600 : 400,
            }}>
              {conv.last?.direccion === 'SALIENTE' ? 'Tú: ' : ''}
              {conv.last?.mensaje}
            </span>
            {conv.unread > 0 && (
              <span style={{
                background: '#25d366', color: '#040807',
                borderRadius: 10, fontSize: 11, fontWeight: 800,
                padding: '1px 7px', marginLeft: 6, flexShrink: 0,
              }}>{conv.unread}</span>
            )}
          </div>
        )}
      </div>
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

// ── MEDIA CONTENT ────────────────────────────────────────────────
function MediaContent({ tipo, mediaUrl, mediaId }) {
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
    <a href={src} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 6 }}>
      <img
        src={src}
        alt="imagen"
        style={{
          maxWidth: '100%', maxHeight: 260, borderRadius: 10,
          display: 'block', objectFit: 'cover',
          border: '1px solid rgba(255,255,255,.06)',
        }}
        onError={e => { e.currentTarget.style.display = 'none' }}
      />
    </a>
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
        <audio controls src={src} style={{ width: '100%', minWidth: 280, height: 40, display: 'block', borderRadius: 10, outline: 'none', accentColor: '#25d366' }} />
      </div>
    )
  }

  if (has && isVideo) return (
    <a href={src} target="_blank" rel="noreferrer" style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
      background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.2)',
      borderRadius: 10, padding: '10px 14px', textDecoration: 'none',
    }}>
      <span style={{ fontSize: 22 }}>🎬</span>
      <span style={{ fontSize: 13, color: '#818cf8', fontWeight: 600 }}>Ver video en Drive</span>
    </a>
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
function QuotedMessage({ contextoId, allMsgs }) {
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
export function MessageBubble({ msg, allMsgs }) {
  const isMe     = msg.direccion === 'SALIENTE'
  const hasMedia = !!msg.mediaUrl
  const hasText  = !!msg.mensaje

  return (
    <div style={{
      display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start',
      marginBottom: 4, animation: 'up .2s ease',
    }}>
      <div className="msg-bubble" style={{
        maxWidth: '68%',
        background: isMe ? '#0d4f3c' : '#111c2a',
        borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: '10px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,.3)',
        border: isMe ? '1px solid rgba(37,211,102,.1)' : '1px solid #1e2d3d',
      }}>

        {msg.referral && <ReferralCard referral={msg.referral} />}

        {msg.contextoId && (
          <QuotedMessage contextoId={msg.contextoId} allMsgs={allMsgs} />
        )}

        {hasMedia && (
          <MediaContent tipo={msg.tipo} mediaUrl={msg.mediaUrl} mediaId={msg.mediaId} />
        )}

        {hasText && (
          <p style={{
            margin: 0, fontSize: 14, color: '#e2e8f0',
            lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          }}>{msg.mensaje}</p>
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
          {isMe && <StatusPill estado={msg.estado} />}
        </div>
      </div>
    </div>
  )
}

// ── TOAST NOTIFICATION ───────────────────────────────────────────
export function Toast({ result }) {
  if (!result) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8, animation: 'up .2s ease' }}>
      <span style={{
        fontSize: 12, padding: '5px 16px', borderRadius: 20,
        background: result.ok ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
        color: result.ok ? '#4ade80' : '#f87171',
        border: `1px solid ${result.ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`,
      }}>
        {result.ok
          ? result.demo
            ? '✓ Enviado (demo) — activa tus webhooks de Make para envío real'
            : '✓ Mensaje enviado por WhatsApp vía Make'
          : '✗ Error al enviar — revisa tu escenario en Make'}
      </span>
    </div>
  )
}
