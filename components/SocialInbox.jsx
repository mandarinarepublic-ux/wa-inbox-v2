'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

// ── CONFIG ──────────────────────────────────────────────────────────────────
// Los datos ya NO se leen de la hoja SOCIAL de Google Sheets: vienen de Supabase
// vía /api/social/lista (entrantes los ingesta Make → /api/social/ingest).

// ── HELPERS ──────────────────────────────────────────────────────────────────
const CHANNEL_META = {
  FB: { label: 'Facebook', color: '#1877F2', bg: 'rgba(24,119,242,.12)', icon: '📘' },
  IG: { label: 'Instagram', color: '#E1306C', bg: 'rgba(225,48,108,.12)', icon: '📸' },
}

const STATUS_COLORS = {
  PENDIENTE:     { bg: 'rgba(248,113,113,.15)', color: '#f87171' },
  VENTAPROCESO:  { bg: 'rgba(245,158,11,.15)',  color: '#f59e0b' },
  ATENDIDO:      { bg: 'rgba(74,222,128,.15)',   color: '#4ade80' },
  ARCHIVADO:     { bg: 'rgba(100,116,139,.15)',  color: '#64748b' },
}

// Devuelve la info de pauta lista para mostrar, o null si la conversación no vino
// de un anuncio/publicación.
function pautaInfo(conv) {
  const title = conv.pautaTitle, adId = conv.pautaAdId, ref = conv.pautaRef
  if (!title && !adId && !ref) return null
  if (conv.canal === 'IG') {
    // IG son comentarios: ref = tipo de media (AD/REELS/FEED/STORY), adId = media.id
    const tipo = (ref || '').toUpperCase()
    const tipoLabel = { AD: 'un anuncio', REELS: 'un Reel', FEED: 'una publicación', STORY: 'una historia' }[tipo] || 'una publicación'
    return { esAnuncio: tipo === 'AD', titulo: `Comentó en ${tipoLabel}`, detalle: adId }
  }
  // FB: referral de anuncio Click-to-Messenger
  return { esAnuncio: true, titulo: title || (ref ? `ref: ${ref}` : 'Anuncio (Click-to-Messenger)'), detalle: adId || ref }
}

function PautaBadge({ conv }) {
  const info = pautaInfo(conv)
  if (!info) return null
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:5, padding:'4px 9px', borderRadius:8, background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.28)', maxWidth:'100%' }}>
      <span style={{ fontSize:12, flexShrink:0 }}>📢</span>
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:10, fontWeight:800, color:'#f59e0b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{info.titulo}</div>
        {info.detalle && <div style={{ fontSize:9, color:'#64748b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>ID: {info.detalle}</div>}
      </div>
    </div>
  )
}

// ── COMPONENTES ──────────────────────────────────────────────────────────────

function ChannelBadge({ channel }) {
  const meta = CHANNEL_META[channel] || CHANNEL_META.FB
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'1px 6px', borderRadius:5, fontSize:10, fontWeight:700, background: meta.bg, color: meta.color }}>
      {meta.icon} {channel}
    </span>
  )
}

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.PENDIENTE
  return (
    <span style={{ padding:'1px 6px', borderRadius:5, fontSize:9, fontWeight:700, background: s.bg, color: s.color }}>
      {status}
    </span>
  )
}

function SocialAvatar({ name, channel }) {
  const initials = (name || '?').split(/[\s._@]/).slice(0, 2).map(w => (w[0] || '').toUpperCase()).join('')
  const meta = CHANNEL_META[channel] || CHANNEL_META.FB
  return (
    <div style={{ position:'relative', flexShrink:0 }}>
      <div style={{ width:40, height:40, borderRadius:'50%', background: meta.color, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:14, fontWeight:700 }}>
        {initials || '?'}
      </div>
      <div style={{ position:'absolute', bottom:-1, right:-1, width:16, height:16, borderRadius:'50%', background: meta.color, border:'2px solid #0d1520', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8 }}>
        {meta.icon}
      </div>
    </div>
  )
}

function ConvRow({ conv, isActive, onClick }) {
  return (
    <button onClick={onClick} style={{
      width:'100%', textAlign:'left', padding:'10px 14px',
      background: isActive ? 'rgba(37,211,102,.06)' : 'transparent',
      borderLeft: isActive ? '2px solid #25d366' : '2px solid transparent',
      border:'none', borderBottom:'1px solid #111c2a',
      cursor:'pointer', display:'flex', gap:10, alignItems:'flex-start',
      transition:'all .15s', fontFamily:'Outfit,sans-serif',
    }}>
      <SocialAvatar name={conv.nombre} channel={conv.canal} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:130 }}>{conv.nombre}</span>
          <span style={{ fontSize:9, color:'#334155', flexShrink:0 }}>{conv.last_time ? new Date(conv.last_time).toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit' }) : ''}</span>
        </div>
        <div style={{ display:'flex', gap:4, marginBottom:3, alignItems:'center' }}>
          <ChannelBadge channel={conv.canal} />
          <StatusBadge status={conv.status} />
          {pautaInfo(conv) && (
            <span title="Vino de un anuncio/publicación" style={{ fontSize:10, color:'#f59e0b' }}>📢</span>
          )}
        </div>
        <div style={{ fontSize:11, color:'#334155', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {conv.messages[conv.messages.length - 1]?.text || '—'}
        </div>
      </div>
      {conv.unread > 0 && (
        <span style={{ flexShrink:0, width:18, height:18, borderRadius:'50%', background:'#f59e0b', color:'#000', fontSize:9, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>{conv.unread}</span>
      )}
    </button>
  )
}

function MsgBubble({ msg, channel }) {
  const isUser = msg.from === 'user'
  const isMandi = msg.from === 'mandi'
  const meta = CHANNEL_META[channel] || CHANNEL_META.FB
  return (
    <div style={{ display:'flex', marginBottom:10, justifyContent: isUser ? 'flex-start' : 'flex-end' }}>
      <div style={{
        maxWidth:'72%', padding:'9px 13px', borderRadius: isUser ? '14px 14px 14px 4px' : '14px 14px 4px 14px',
        background: isUser ? '#111c2a' : isMandi ? meta.color : '#1e3a5f',
        color: isUser ? '#e2e8f0' : '#fff',
        fontSize:13, lineHeight:1.5,
        border: isUser ? '1px solid #1e2d3d' : 'none',
      }}>
        {isMandi && <div style={{ fontSize:9, fontWeight:700, opacity:.75, marginBottom:3 }}>🍊 MANDI</div>}
        <div>{msg.text}</div>
        {msg.time && (
          <div style={{ fontSize:9, opacity:.5, marginTop:4, textAlign:'right' }}>
            {new Date(msg.time).toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit' })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── COMPONENTE PRINCIPAL ──────────────────────────────────────────────────────
export default function SocialInbox({ active: isVisible }) {
  const [convs, setConvs]       = useState([])
  const [selected, setSelected] = useState(null) // clave compuesta: `${canal}__${sender_id}`
  const [filter, setFilter]     = useState('Todas')
  const [loading, setLoading]   = useState(true)
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [quickReplies, setQuickReplies] = useState([]) // mismas respuestas que WhatsApp (RESPUESTAS_RAPIDAS)
  const [showQR, setShowQR]     = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [mediaInfo, setMediaInfo] = useState(null) // publicación/anuncio que comentó el cliente
  const bottomRef = useRef(null)
  const pollRef   = useRef(null)
  const mediaCacheRef = useRef({}) // cache por media id → info de la publicación
  const backGuardRef = useRef(false) // móvil: entrada de historial empujada al abrir un chat

  const convKey = (c) => `${c.canal}__${c.sender_id}`

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/lista')
      const data = await res.json()
      if (Array.isArray(data)) {
        setConvs(data)
        setLastSync(new Date())
      }
    } catch (e) {
      console.error('SocialInbox load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // ¿Pantalla de celular? (mismo umbral que el inbox de WhatsApp: 767px)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    const apply = () => setIsMobile(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])

  useEffect(() => {
    if (!isVisible) return
    load()
    pollRef.current = setInterval(load, 8000)
    return () => clearInterval(pollRef.current)
  }, [isVisible, load])

  // Respuestas rápidas: las MISMAS que WhatsApp (hoja RESPUESTAS_RAPIDAS vía /api/respuestas).
  useEffect(() => {
    if (!isVisible) return
    fetch('/api/respuestas')
      .then(r => (r.ok ? r.json() : []))
      .then(data => { if (Array.isArray(data)) setQuickReplies(data) })
      .catch(() => {})
  }, [isVisible])

  const selectedConv = convs.find(c => convKey(c) === selected) || null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selected, convs])

  // Trae la publicación/anuncio de Instagram que comentó el cliente, para ver A QUÉ
  // producto se refiere (el comentario suele ser un "precio?" sin contexto).
  useEffect(() => {
    setMediaInfo(null)
    const mediaId = selectedConv?.pautaAdId
    if (!selectedConv || selectedConv.canal !== 'IG' || !mediaId) return
    if (mediaCacheRef.current[mediaId]) { setMediaInfo(mediaCacheRef.current[mediaId]); return }
    // id del comentario del cliente → fallback para anuncios (dark posts) que no se
    // leen como media suelto, pero sí expandiendo el media desde el comentario.
    const lastUser = [...selectedConv.messages].reverse().find(m => m.from === 'user')
    const commentId = lastUser?.id || ''
    let cancel = false
    fetch(`/api/social/media?id=${encodeURIComponent(mediaId)}&comment=${encodeURIComponent(commentId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancel || !d || d.error) return
        if (!d.image && !d.permalink && !d.caption) return
        mediaCacheRef.current[mediaId] = d
        setMediaInfo(d)
      })
      .catch(() => {})
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedConv?.canal, selectedConv?.pautaAdId])

  // Botón "atrás" del celular: al abrir un chat empujamos una entrada de historial y
  // acá la consumimos para VOLVER A LA LISTA en vez de salir de la app.
  useEffect(() => {
    const onPop = () => {
      if (backGuardRef.current) {
        backGuardRef.current = false
        setSelected(null)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openConv = (conv) => {
    setSelected(convKey(conv))
    setShowQR(false)
    if (isMobile && !backGuardRef.current) {
      window.history.pushState({ social: 'chat' }, '')
      backGuardRef.current = true
    }
  }

  const goBack = () => {
    if (backGuardRef.current) {
      window.history.back() // dispara popstate → setSelected(null)
    } else {
      setSelected(null)
    }
  }

  const filtered = convs.filter(c => {
    if (filter === 'FB') return c.canal === 'FB'
    if (filter === 'IG') return c.canal === 'IG'
    if (filter === 'PENDIENTE') return c.status === 'PENDIENTE'
    if (filter === 'VENTAPROCESO') return c.status === 'VENTAPROCESO'
    return true
  })

  const handleSend = async () => {
    if (!input.trim() || !selectedConv || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    try {
      // IG: los chats son comentarios → respondemos con DM privado al comentario más
      // reciente del cliente (recipient.comment_id). FB: DM normal por PSID.
      const lastUser = [...selectedConv.messages].reverse().find(m => m.from === 'user')
      const res = await fetch('/api/social/saliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: selectedConv.sender_id,
          message: text,
          canal: selectedConv.canal,
          comment_id: selectedConv.canal === 'IG' ? (lastUser?.id || '') : '',
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        console.error('Send error:', data.error || res.status)
        setInput(text) // devolver el texto para reintentar
        alert('❌ No se pudo enviar: ' + (data.error || `HTTP ${res.status}`))
        return
      }
      // Optimistic update: agrega el saliente y marca ATENDIDO (como en el server).
      setConvs(prev => prev.map(c =>
        convKey(c) === selected
          ? { ...c, status: 'ATENDIDO', messages: [...c.messages, { id: Date.now(), from: 'mandi', text, time: new Date().toISOString() }] }
          : c
      ))
    } catch (e) {
      console.error('Send error:', e)
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  const cambiarEstado = async (nuevo) => {
    if (!selectedConv || selectedConv.status === nuevo) return
    const { canal, sender_id } = selectedConv
    setConvs(prev => prev.map(c => convKey(c) === selected ? { ...c, status: nuevo } : c))
    try {
      await fetch('/api/social/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canal, sender_id, estado: nuevo }),
      })
    } catch (e) {
      console.error('Estado error:', e)
    }
  }

  const FILTERS = ['Todas', 'FB', 'IG', 'PENDIENTE', 'VENTAPROCESO']

  // En móvil mostramos UNA sola vista: lista o chat (nunca las dos apretadas, que era
  // lo que "tapaba la pantalla" y no dejaba responder).
  const mostrarSidebar = !isMobile || !selectedConv
  const mostrarChat    = !isMobile || !!selectedConv

  return (
    <div style={{ display:'flex', flex:1, height:'100%', minHeight:0, overflow:'hidden', fontFamily:'Outfit,sans-serif' }}>

      {/* ── SIDEBAR ── */}
      {mostrarSidebar && (
      <div style={{ width: isMobile ? '100%' : 300, flexShrink:0, background:'#0d1520', borderRight: isMobile ? 'none' : '1px solid #162030', display:'flex', flexDirection:'column', height:'100%', minHeight:0, overflow:'hidden' }}>
        {/* Header */}
        <div style={{ padding:'14px 14px 10px', borderBottom:'1px solid #162030', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#1877F2,#E1306C)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:17 }}>🌐</div>
            <div>
              <div style={{ fontSize:13, fontWeight:800, color:'#e2e8f0' }}>Social Inbox</div>
              <div style={{ fontSize:10, color:'#25d366', display:'flex', alignItems:'center', gap:3 }}>
                <span style={{ width:5, height:5, borderRadius:'50%', background:'#25d366', display:'inline-block' }} />
                {loading ? 'Cargando...' : `${convs.length} conversaciones`}
              </div>
            </div>
          </div>
          {/* Filtros */}
          <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding:'3px 8px', fontSize:9, fontWeight:700, borderRadius:6, cursor:'pointer',
                background: filter === f ? 'rgba(37,211,102,.15)' : 'transparent',
                border: `1px solid ${filter === f ? 'rgba(37,211,102,.4)' : '#1a2d40'}`,
                color: filter === f ? '#25d366' : '#334155',
                fontFamily:'Outfit,sans-serif', transition:'all .15s',
              }}>{f}</button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
          {loading ? (
            <div style={{ padding:28, textAlign:'center', color:'#2a3f55', fontSize:12 }}>Cargando...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:28, textAlign:'center', color:'#2a3f55', fontSize:12 }}>Sin conversaciones</div>
          ) : filtered.map(conv => (
            <ConvRow key={convKey(conv)} conv={conv} isActive={selected === convKey(conv)}
              onClick={() => openConv(conv)} />
          ))}
        </div>

        {/* Footer sync */}
        <div style={{ padding:'7px 14px', borderTop:'1px solid #162030', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <span style={{ fontSize:10, color:'#334155' }}>{lastSync ? 'Sync ' + lastSync.toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'}</span>
          <button onClick={load} style={{ background:'rgba(37,211,102,.1)', border:'1px solid rgba(37,211,102,.25)', color:'#25d366', borderRadius:7, width:28, height:28, cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>↻</button>
        </div>
      </div>
      )}

      {/* ── CHAT ── */}
      {mostrarChat && (selectedConv ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, minHeight:0, overflow:'hidden', background:'#080d14' }}>
          {/* Header chat */}
          <div style={{ padding:'8px 14px', background:'#0a0f1a', borderBottom:'1px solid #111c2a', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
            {isMobile && (
              <button onClick={goBack} title="Volver" style={{ flexShrink:0, width:34, height:34, borderRadius:9, background:'#111c2a', border:'1px solid #1e2d3d', color:'#94a3b8', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>‹</button>
            )}
            <SocialAvatar name={selectedConv.nombre} channel={selectedConv.canal} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:14, fontWeight:800, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selectedConv.nombre}</span>
                <ChannelBadge channel={selectedConv.canal} />
              </div>
              <div style={{ fontSize:10, color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{CHANNEL_META[selectedConv.canal]?.label} · {selectedConv.sender_id}</div>
              <PautaBadge conv={selectedConv} />
            </div>
            <div style={{ display:'flex', gap:4, flexShrink:0 }}>
              {['PENDIENTE','VENTAPROCESO','ATENDIDO','ARCHIVADO'].map(s => {
                const sc = STATUS_COLORS[s]
                const isActive = selectedConv.status === s
                return (
                  <button key={s} title={s} onClick={() => cambiarEstado(s)} style={{
                    padding:'3px 6px', fontSize:8, fontWeight:700, borderRadius:5, cursor:'pointer',
                    background: isActive ? sc.bg : 'transparent',
                    border: `1px solid ${isActive ? sc.color + '60' : '#1a2d40'}`,
                    color: isActive ? sc.color : '#334155',
                    fontFamily:'Outfit,sans-serif',
                  }}>{s.slice(0,4)}</button>
                )
              })}
            </div>
          </div>

          {/* Mensajes */}
          <div style={{ flex:1, overflowY:'auto', minHeight:0, padding:'16px 20px' }}>
            <div style={{ textAlign:'center', marginBottom:16 }}>
              <span style={{ fontSize:10, background: CHANNEL_META[selectedConv.canal]?.bg, color: CHANNEL_META[selectedConv.canal]?.color, padding:'3px 10px', borderRadius:20, fontWeight:700 }}>
                {CHANNEL_META[selectedConv.canal]?.icon} Conversación de {CHANNEL_META[selectedConv.canal]?.label}
              </span>
            </div>

            {/* Publicación/anuncio sobre el que comentó el cliente (para ver el producto) */}
            {mediaInfo && (mediaInfo.image || mediaInfo.permalink || mediaInfo.caption) && (
              <a href={mediaInfo.permalink || undefined} target="_blank" rel="noreferrer"
                style={{ display:'flex', gap:10, alignItems:'center', textDecoration:'none', margin:'0 auto 16px', maxWidth:360,
                  background:'#0d1520', border:'1px solid #1e2d3d', borderRadius:12, padding:8, cursor: mediaInfo.permalink ? 'pointer' : 'default' }}>
                {mediaInfo.image
                  ? <img src={mediaInfo.image} alt="" style={{ width:52, height:52, borderRadius:8, objectFit:'cover', flexShrink:0 }} />
                  : <div style={{ width:52, height:52, borderRadius:8, background:'#111c2a', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>🖼️</div>}
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#E1306C', marginBottom:2 }}>📸 Comentó en esta publicación</div>
                  <div style={{ fontSize:11, color:'#cbd5e1', lineHeight:1.35, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                    {mediaInfo.caption || 'Ver publicación en Instagram'}
                  </div>
                  {mediaInfo.permalink && <div style={{ fontSize:9, color:'#475569', marginTop:2 }}>Toca para abrir en Instagram ↗</div>}
                </div>
              </a>
            )}
            {selectedConv.messages.map((msg, i) => (
              <MsgBubble key={msg.id || i} msg={msg} channel={selectedConv.canal} />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding:'10px 16px 14px', background:'#0a0f1a', borderTop:'1px solid #111c2a', flexShrink:0 }}>
            {/* Respuestas rápidas (mismas que WhatsApp) */}
            {showQR && (
              quickReplies.length > 0 ? (
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8, maxHeight:130, overflowY:'auto' }}>
                  {quickReplies.map(qr => (
                    <button key={qr.id} onClick={() => { setInput(qr.text || ''); setShowQR(false) }}
                      style={{ padding:'5px 12px', borderRadius:20, background:'#111c2a', border:'1px solid #1e2d3d', color:'#94a3b8', fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'Outfit,sans-serif' }}>
                      {qr.imageUrl && <img src={qr.imageUrl} alt="" style={{ width:18, height:18, borderRadius:3, objectFit:'cover' }} />}
                      {(qr.text || '').substring(0, 40)}{(qr.text || '').length > 40 ? '…' : ''}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ marginBottom:8, fontSize:11, color:'#334155' }}>Sin respuestas rápidas. Agrégalas en MANDI (hoja RESPUESTAS_RAPIDAS).</div>
              )
            )}
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              <button onClick={() => setShowQR(s => !s)} title="Respuestas rápidas"
                style={{ width:42, height:42, flexShrink:0, borderRadius:11, background: showQR ? '#f59e0b' : '#111c2a', border:`1px solid ${showQR ? '#f59e0b' : '#1e2d3d'}`, color: showQR ? '#fff' : '#64748b', fontSize:17, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                ⚡
              </button>
              <div style={{ flex:1, minWidth:0, background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:13, padding:'9px 13px' }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !isMobile) { e.preventDefault(); handleSend() } }}
                  placeholder={`Responder por ${CHANNEL_META[selectedConv.canal]?.label}...`}
                  rows={2}
                  style={{ width:'100%', background:'transparent', border:'none', outline:'none', color:'#e2e8f0', fontSize:16, resize:'none', lineHeight:1.5, minHeight:40, maxHeight:100, overflowY:'auto', fontFamily:'Outfit,sans-serif' }}
                />
              </div>
              <button onClick={handleSend} disabled={!input.trim() || sending} style={{
                width:42, height:42, flexShrink:0, borderRadius:11, border:'none', cursor: input.trim() ? 'pointer' : 'default',
                background: input.trim() ? `linear-gradient(135deg,${CHANNEL_META[selectedConv.canal]?.color},${CHANNEL_META[selectedConv.canal]?.color}aa)` : '#111c2a',
                color:'#fff', fontSize:17, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s',
              }}>{sending ? '⏳' : '➤'}</button>
            </div>
            <div style={{ fontSize:9, color:'#2a3f55', marginTop:4, textAlign:'right' }}>
              {isMobile ? 'Toca ➤ para enviar' : 'Enter · Shift+Enter nueva línea'}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#080d14' }}>
          <div style={{ textAlign:'center', color:'#1e2d3d' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🌐</div>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:4 }}>Social Inbox</div>
            <div style={{ fontSize:11 }}>Selecciona una conversación de FB o IG</div>
          </div>
        </div>
      ))}
    </div>
  )
}
