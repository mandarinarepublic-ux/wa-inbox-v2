'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

// ── CONFIG ──────────────────────────────────────────────────────────────────
const SHEET_ID   = '1ZQ_vIhKsDBnAUjitOB3zP-4MDbdmsv7hdDgnqNbOkak'
const SHEET_NAME = 'SOCIAL'
const SHEET_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`

const SOCIAL_SALIENTE_WEBHOOK = 'https://hook.us2.make.com/h58ntr47fibrop55pb42d5waejphay32'

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

function parseCSV(text) {
  const lines = []
  let cur = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { inQ = !inQ }
    else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (cur || lines.length > 0) lines.push(cur)
      cur = ''
      if (ch === '\r' && text[i+1] === '\n') i++
    } else cur += ch
  }
  if (cur) lines.push(cur)
  if (lines.length < 2) return []
  const parseRow = (line) => {
    const vals = []
    let c = '', q = false
    for (const ch of line) {
      if (ch === '"') { q = !q }
      else if (ch === ',' && !q) { vals.push(c.replace(/^"|"$/g, '').trim()); c = '' }
      else c += ch
    }
    vals.push(c.replace(/^"|"$/g, '').trim())
    return vals
  }
  const headers = parseRow(lines[0])
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseRow(line)
    const obj = {}
    headers.forEach((h, i) => { obj[h] = vals[i] || '' })
    return obj
  })
}

function groupByConversation(rows) {
  const map = {}
  rows.forEach(row => {
    const senderId = (row.Sender_ID || '').trim()
    const canal    = (row.CANAL || 'FB').trim()
    if (!senderId) return
    // Clave única = canal + sender para evitar mezclar FB e IG
    const key = `${canal}__${senderId}`
    if (!map[key]) {
      map[key] = {
        sender_id: senderId,
        nombre: (row.Nombre || senderId).trim(),
        canal,
        status: (row.EstadoReal || 'PENDIENTE').trim(),
        mandi_active: (row.MANDI_Activo || '').trim() === 'TRUE',
        messages: [],
        last_time: row.Fecha || '',
        unread: 0,
        // Pauta: de qué anuncio/publicación viene el cliente. Llega solo en la fila de
        // origen (primer mensaje desde un anuncio / comentario en una publicación).
        // FB: Ad_ID/Pauta(título)/Ref del referral CTM. IG: Ad_ID=media.id, Ref=tipo (AD/REELS/FEED).
        pautaAdId:  '',
        pautaTitle: '',
        pautaRef:   '',
      }
    }
    // Captura la primera aparición no vacía de cada campo de pauta
    if (!map[key].pautaAdId  && (row.Ad_ID || '').trim()) map[key].pautaAdId  = (row.Ad_ID || '').trim()
    if (!map[key].pautaTitle && (row.Pauta || '').trim()) map[key].pautaTitle = (row.Pauta || '').trim()
    if (!map[key].pautaRef   && (row.Ref   || '').trim()) map[key].pautaRef   = (row.Ref   || '').trim()
    const msg   = (row.Mensaje || '').trim()
    const reply = (row.MensajeSalida || '').trim()
    if (msg)   map[key].messages.push({ id: row.ID || Date.now(), from: 'user',  text: msg,   time: row.Fecha || '' })
    if (reply) map[key].messages.push({ id: (row.ID || Date.now()) + '_r', from: 'mandi', text: reply, time: row.Fecha || '' })
    map[key].last_time = row.Fecha || ''
    map[key].status    = (row.EstadoReal || map[key].status).trim()
    if (row.Nombre && row.Nombre.trim()) map[key].nombre = row.Nombre.trim()
  })
  return Object.values(map).sort((a, b) => new Date(b.last_time) - new Date(a.last_time))
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
  const [selected, setSelected] = useState(null)
  const [filter, setFilter]     = useState('Todas')
  const [loading, setLoading]   = useState(true)
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [quickReplies, setQuickReplies] = useState([]) // mismas respuestas que WhatsApp (RESPUESTAS_RAPIDAS)
  const [showQR, setShowQR]     = useState(false)
  const bottomRef = useRef(null)
  const pollRef   = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(SHEET_URL)
      const text = await res.text()
      const rows = parseCSV(text)
      const grouped = groupByConversation(rows)
      setConvs(grouped)
      setLastSync(new Date())
    } catch (e) {
      console.error('SocialInbox load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isVisible) return
    load()
    pollRef.current = setInterval(load, 8000)
    return () => clearInterval(pollRef.current)
  }, [isVisible, load])

  // Respuestas rápidas: las MISMAS que WhatsApp (hoja RESPUESTAS_RAPIDAS vía /api/respuestas).
  // Cambian poco → se cargan una vez al abrir el Social Inbox.
  useEffect(() => {
    if (!isVisible) return
    fetch('/api/respuestas')
      .then(r => (r.ok ? r.json() : []))
      .then(data => { if (Array.isArray(data)) setQuickReplies(data) })
      .catch(() => {})
  }, [isVisible])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selected, convs])

  const selectedConv = convs.find(c => c.sender_id === selected) || null

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
      await fetch(SOCIAL_SALIENTE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: selectedConv.sender_id,
          message: text,
          canal: selectedConv.canal
        })
      })
      // Optimistic update
      setConvs(prev => prev.map(c =>
        c.sender_id === selected && c.canal === selectedConv.canal
          ? { ...c, messages: [...c.messages, { id: Date.now(), from: 'agent', text, time: new Date().toISOString() }] }
          : c
      ))
    } catch (e) {
      console.error('Send error:', e)
    } finally {
      setSending(false)
    }
  }

  const FILTERS = ['Todas', 'FB', 'IG', 'PENDIENTE', 'VENTAPROCESO']

  return (
    <div style={{ display:'flex', flex:1, height:'100%', overflow:'hidden', fontFamily:'Outfit,sans-serif' }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width:300, flexShrink:0, background:'#0d1520', borderRight:'1px solid #162030', display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
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
            <ConvRow key={conv.sender_id} conv={conv} isActive={selected === conv.sender_id}
              onClick={() => setSelected(conv.sender_id)} />
          ))}
        </div>

        {/* Footer sync */}
        <div style={{ padding:'7px 14px', borderTop:'1px solid #162030', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <span style={{ fontSize:10, color:'#334155' }}>{lastSync ? 'Sync ' + lastSync.toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'}</span>
          <button onClick={load} style={{ background:'rgba(37,211,102,.1)', border:'1px solid rgba(37,211,102,.25)', color:'#25d366', borderRadius:7, width:28, height:28, cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>↻</button>
        </div>
      </div>

      {/* ── CHAT ── */}
      {selectedConv ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden', background:'#080d14' }}>
          {/* Header chat */}
          <div style={{ padding:'8px 14px', background:'#0a0f1a', borderBottom:'1px solid #111c2a', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
            <SocialAvatar name={selectedConv.nombre} channel={selectedConv.canal} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:14, fontWeight:800, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selectedConv.nombre}</span>
                <ChannelBadge channel={selectedConv.canal} />
              </div>
              <div style={{ fontSize:10, color:'#475569' }}>{CHANNEL_META[selectedConv.canal]?.label} · {selectedConv.sender_id}</div>
              <PautaBadge conv={selectedConv} />
            </div>
            <div style={{ display:'flex', gap:4, flexShrink:0 }}>
              {['PENDIENTE','VENTAPROCESO','ATENDIDO','ARCHIVADO'].map(s => {
                const sc = STATUS_COLORS[s]
                const isActive = selectedConv.status === s
                return (
                  <button key={s} title={s} style={{
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
          <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
            <div style={{ textAlign:'center', marginBottom:16 }}>
              <span style={{ fontSize:10, background: CHANNEL_META[selectedConv.canal]?.bg, color: CHANNEL_META[selectedConv.canal]?.color, padding:'3px 10px', borderRadius:20, fontWeight:700 }}>
                {CHANNEL_META[selectedConv.canal]?.icon} Conversación de {CHANNEL_META[selectedConv.canal]?.label}
              </span>
            </div>
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
              <div style={{ flex:1, background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:13, padding:'9px 13px' }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  placeholder={`Responder por ${CHANNEL_META[selectedConv.canal]?.label}... (Enter para enviar)`}
                  rows={2}
                  style={{ width:'100%', background:'transparent', border:'none', outline:'none', color:'#e2e8f0', fontSize:13, resize:'none', lineHeight:1.5, minHeight:40, maxHeight:100, overflowY:'auto', fontFamily:'Outfit,sans-serif' }}
                />
              </div>
              <button onClick={handleSend} disabled={!input.trim() || sending} style={{
                width:42, height:42, flexShrink:0, borderRadius:11, border:'none', cursor: input.trim() ? 'pointer' : 'default',
                background: input.trim() ? `linear-gradient(135deg,${CHANNEL_META[selectedConv.canal]?.color},${CHANNEL_META[selectedConv.canal]?.color}aa)` : '#111c2a',
                color:'#fff', fontSize:17, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s',
              }}>{sending ? '⏳' : '➤'}</button>
            </div>
            <div style={{ fontSize:9, color:'#2a3f55', marginTop:4, textAlign:'right' }}>Enter · Shift+Enter nueva línea</div>
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
      )}
    </div>
  )
}
