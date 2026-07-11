'use client'
import { useState, useRef, useEffect } from 'react'
import { Avatar } from '@/components/Components'
import { fetchRepliesFromSheet, writeReply, saveNotes, setIdVenta } from '@/lib/api-client'
import { parseDate } from '@/lib/utils'

const IMGBB_KEY = '2307574d43689522feabd27cff3443df'
const MAX_IMGS  = 10

// Extrae todas las urls de imagen de un reply (imageUrl, imageUrl2..imageUrl10)
function getImgUrls(reply) {
  return Array.from({ length: MAX_IMGS }, (_, i) =>
    i === 0 ? (reply.imageUrl || '') : (reply[`imageUrl${i + 1}`] || '')
  ).filter(Boolean)
}

// Convierte array de urls → objeto reply { imageUrl, imageUrl2, ... }
function urlsToReply(urls) {
  const obj = {}
  for (let i = 0; i < MAX_IMGS; i++) {
    obj[i === 0 ? 'imageUrl' : `imageUrl${i + 1}`] = urls[i] || ''
  }
  return obj
}

async function toJpeg(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => resolve(new File([blob], 'imagen.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92)
    }
    img.src = url
  })
}

const uploadImg = async (file, setUrl, setPrev, setLoading) => {
  setLoading(true)
  try {
    const converted = await toJpeg(file)
    const fd = new FormData()
    fd.append('image', converted)
    const res  = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: 'POST', body: fd })
    const data = await res.json()
    if (data.success) { setUrl(data.data.url); setPrev(data.data.url) }
  } finally { setLoading(false) }
}

// Sube un archivo a imgbb y devuelve la url (para el editor multi-foto)
async function uploadToImgbb(file) {
  const converted = await toJpeg(file)
  const fd = new FormData(); fd.append('image', converted)
  const res  = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, { method: 'POST', body: fd })
  const data = await res.json()
  return data.success ? data.data.url : ''
}

// ── MultiImgEditor — editor de hasta 10 fotos ────────────────────
function MultiImgEditor({ urls, onChange }) {
  const [uploading, setUploading] = useState({})
  const refs = Array.from({ length: MAX_IMGS }, () => useRef(null))

  const handleFile = async (e, idx) => {
    const f = e.target.files[0]; if (!f) return
    setUploading(p => ({ ...p, [idx]: true }))
    try {
      const url = await uploadToImgbb(f)
      if (url) {
        const next = [...urls]
        next[idx] = url
        onChange(next.filter(Boolean)) // compactar — quitar huecos
      }
    } finally {
      setUploading(p => ({ ...p, [idx]: false }))
      if (refs[idx].current) refs[idx].current.value = ''
    }
  }

  const removeImg = (idx) => onChange(urls.filter((_, i) => i !== idx))

  // Fotos existentes + 1 slot vacío (si hay espacio)
  const slots = urls.length < MAX_IMGS ? [...urls, null] : urls

  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:4 }}>
      {slots.map((url, idx) => (
        <div key={idx} style={{ position:'relative', width:44, height:44 }}>
          {url ? (
            <>
              <img src={url} style={{ width:44, height:44, borderRadius:6, objectFit:'cover', display:'block' }} alt=""
                onError={e => e.currentTarget.style.display='none'} />
              {uploading[idx] && (
                <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.55)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:'#e2e8f0' }}>↑</div>
              )}
              <button onClick={() => removeImg(idx)}
                style={{ position:'absolute', top:-4, right:-4, width:14, height:14, borderRadius:'50%', background:'#f87171', border:'none', color:'#fff', fontSize:8, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>✕</button>
            </>
          ) : (
            <>
              <button onClick={() => refs[idx].current?.click()}
                style={{ width:44, height:44, border:'1px dashed #2a3f55', borderRadius:6, background:'transparent', cursor:'pointer', color:'#475569', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>
                {uploading[idx] ? '↑' : '+'}
              </button>
              <input ref={refs[idx]} type="file" accept="image/*" style={{ display:'none' }} onChange={e => handleFile(e, idx)} />
            </>
          )}
        </div>
      ))}
      {urls.length > 0 && (
        <div style={{ width:'100%', fontSize:9, color:'#475569', marginTop:2 }}>{urls.length}/{MAX_IMGS} fotos</div>
      )}
    </div>
  )
}

// ── Tarjeta de un pedido del historial (MANDARINACRM) ────────────
function PedidoCard({ p }) {
  const est       = String(p.estado || '').toUpperCase()
  const pago      = String(p.estadoPago || '').toUpperCase()
  const entregado = /ENTREG/.test(est)
  const pagado    = /PAG/.test(pago)
  const estColor  = entregado ? '#10b981' : '#f59e0b'
  const items     = p.items || []
  return (
    <div style={{ padding:'7px 9px', background:'#0d1828', border:'1px solid #162030', borderRadius:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:11, fontWeight:800, color:'#e2e8f0' }}>
          <span style={{ color: estColor }}>{entregado ? '●' : '○'}</span> {p.id || 'Pedido'}
        </span>
        <span style={{ fontSize:10, color:'#94a3b8', flexShrink:0 }}>
          {p.fecha} · <strong style={{ color:'#10b981' }}>${Number(p.total || 0).toFixed(2)}</strong>
        </span>
      </div>
      {items.slice(0, 4).map((it, i) => (
        <div key={i} style={{ fontSize:11, color:'#cbd5e1', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          • {it.producto}{it.talla ? ` · ${it.talla}` : ''}{it.color ? ` · ${it.color}` : ''}{it.cantidad > 1 ? ` ×${it.cantidad}` : ''}
        </div>
      ))}
      {items.length > 4 && (
        <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>+{items.length - 4} ítem{items.length - 4 === 1 ? '' : 's'} más…</div>
      )}
      <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:5, flexWrap:'wrap' }}>
        <span style={{ fontSize:8.5, fontWeight:800, color:estColor, background:`${estColor}1e`, border:`1px solid ${estColor}44`, borderRadius:5, padding:'1px 6px' }}>{p.estado || '—'}</span>
        <span style={{ fontSize:8.5, fontWeight:800, color: pagado ? '#10b981' : '#f87171', background: pagado ? 'rgba(16,185,129,.12)' : 'rgba(248,113,113,.12)', border:`1px solid ${pagado ? 'rgba(16,185,129,.35)' : 'rgba(248,113,113,.35)'}`, borderRadius:5, padding:'1px 6px' }}>{p.estadoPago || 'PENDIENTE'}</span>
        {p.url && <a href={p.url} target="_blank" rel="noreferrer" style={{ marginLeft:'auto', fontSize:9, fontWeight:700, color:'#60a5fa', textDecoration:'none' }}>Ver →</a>}
      </div>
    </div>
  )
}

export default function RightPanel({ activeConv, onQuickReply, onSendText, onSendImage, contactInfo, onUpdateContact, windowOpen }) {
  const [countdown, setCountdown] = useState('')

  // ── Contador regresivo ventana 24h ───────────────────────────
  useEffect(() => {
    if (!activeConv) return
    const lastIncoming = [...activeConv.msgs].reverse().find(m => m.direccion === 'ENTRANTE')
    if (!lastIncoming) return

    const tick = () => {
      const diff = parseDate(lastIncoming.timestamp).getTime() + 24 * 60 * 60 * 1000 - Date.now()
      if (diff <= 0) { setCountdown('00:00:00'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setCountdown(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [activeConv])
  const [replies,       setReplies]       = useState([])
  const [repliesLoaded, setRepliesLoaded] = useState(false)
  const [repliesOpen,   setRepliesOpen]   = useState(true)
  const [nuevaOpen,     setNuevaOpen]     = useState(false)
  const [notasOpen,     setNotasOpen]     = useState(true)
  const [editingIdx,    setEditingIdx]    = useState(null)
  const [editText,      setEditText]      = useState('')
  const [editImgUrls,   setEditImgUrls]   = useState([])
  const [newText,       setNewText]       = useState('')
  const [newImgUrls,    setNewImgUrls]    = useState([])
  const [sending,       setSending]       = useState(null)
  const [editAlias,     setEditAlias]     = useState(false)
  const [aliasInput,    setAliasInput]    = useState('')

  // ── Notas del vendedor ───────────────────────────────────────
  const [notasInput,  setNotasInput]  = useState('')
  const [notasSaving, setNotasSaving] = useState(false)
  const [notasSaved,  setNotasSaved]  = useState(false)
  const notasLoadedRef = useRef(null)

  // ── Crear pedido (botón que lee la conversación y crea el pedido en el CRM) ──
  const [pedidoLoading, setPedidoLoading] = useState(false)
  const [pedidoRes,     setPedidoRes]     = useState(null)

  // ── Historial de pedidos del cliente (desde MANDARINACRM) ────
  const [historial,   setHistorial]   = useState(null)  // null = cargando
  const [histError,   setHistError]   = useState(false)
  const [histOpen,    setHistOpen]    = useState(true)
  const histLoadedRef = useRef(null)

  const loadHistorial = async (tel, idVenta) => {
    setHistorial(null); setHistError(false)
    try {
      const url = `/api/cliente-pedidos?telefono=${encodeURIComponent(tel)}${idVenta ? `&idVenta=${encodeURIComponent(idVenta)}` : ''}`
      const r = await fetch(url)
      if (!r.ok) throw new Error('http ' + r.status)
      const d = await r.json()
      if (histLoadedRef.current === tel) setHistorial(d)
    } catch {
      if (histLoadedRef.current === tel) setHistError(true)
    }
  }

  // ── Leer respuestas directamente desde Google Sheets ─────────
  useEffect(() => {
    if (repliesLoaded) return
    fetchRepliesFromSheet().then(data => {
      setReplies(data || [])
      setRepliesLoaded(true)
    })
  }, [repliesLoaded])

  // Cargar la nota al cambiar de contacto (no pisa lo que estás escribiendo)
  useEffect(() => {
    if (!activeConv) return
    if (notasLoadedRef.current !== activeConv.telefono) {
      notasLoadedRef.current = activeConv.telefono
      setNotasInput(contactInfo?.notas || '')
      setNotasSaved(false)
      setPedidoRes(null)
    }
  }, [activeConv, contactInfo])

  // Cargar historial de pedidos al cambiar de contacto (una sola vez por teléfono)
  useEffect(() => {
    if (!activeConv) return
    if (histLoadedRef.current === activeConv.telefono) return
    histLoadedRef.current = activeConv.telefono
    loadHistorial(activeConv.telefono, contactInfo?.idVenta)
  }, [activeConv, contactInfo])

  if (!activeConv) return null

  const lastMsg = activeConv?.last
  // windowOpen viene como prop desde App.jsx (calculado con último msg ENTRANTE)

  const startEdit = (idx) => {
    setEditingIdx(idx); setEditText(replies[idx].text)
    setEditImgUrls(getImgUrls(replies[idx]))
  }

  const saveEdit = async () => {
    if (!editText.trim()) return
    const updated = { ...replies[editingIdx], text: editText.trim(), ...urlsToReply(editImgUrls) }
    setReplies(prev => prev.map((r, i) => i === editingIdx ? updated : r))
    setEditingIdx(null); setEditText(''); setEditImgUrls([])
    await writeReply('actualizar', updated)
  }

  const deleteReply = async (idx) => {
    const reply = replies[idx]
    setReplies(prev => prev.filter((_, i) => i !== idx))
    await writeReply('eliminar', reply)
  }

  const addReply = async () => {
    if (!newText.trim()) return
    const newReply = { id: crypto.randomUUID(), text: newText.trim(), ...urlsToReply(newImgUrls) }
    setReplies(prev => [...prev, newReply])
    setNewText(''); setNewImgUrls([])
    await writeReply('agregar', newReply)
  }

  const handleSendQuick = async (idx) => {
    setSending(idx)
    await onQuickReply(replies[idx])
    setSending(null)
  }

  // Guardar nota del vendedor (col I vía webhook)
  const crearPedido = async () => {
    if (pedidoLoading || !activeConv) return
    // Armamos el transcript desde la conversación que el inbox ya tiene en memoria
    const transcript = (activeConv.msgs || [])
      .map(m => String(m.mensaje || '').trim())
      .filter(Boolean).length
      ? (activeConv.msgs || [])
          .filter(m => String(m.mensaje || '').trim())
          .map(m => `${m.direccion === 'SALIENTE' ? 'VENDEDOR' : 'CLIENTE'}: ${m.mensaje}`)
          .join('\n')
      : ''
    if (!transcript) { setPedidoRes({ ok: false, error: 'La conversación está vacía' }); return }
    setPedidoLoading(true); setPedidoRes(null)
    try {
      const r = await fetch('https://mandi-agent.vercel.app/api/crear-pedido', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: activeConv.telefono, transcript }),
      })
      const res = await r.json()
      setPedidoRes(res)
      if (res?.ok && res.pedidoId) {
        // Persiste el pedido en NOTAS y marca idVenta → queda en 💰 Ventas y no se pierde el link
        const linea = `📦 Pedido ${res.pedidoId} · $${res.montoTotal}\n${res.url}`
        const base = String(notasInput || '')
        const nueva = base.includes(res.pedidoId) ? base : (base.trim() ? `${base.trim()}\n${linea}` : linea)
        setNotasInput(nueva); setNotasOpen(true)
        saveNotes(activeConv.telefono, contactInfo?.nombre || activeConv.nombre, nueva).catch(() => {})
        setIdVenta(activeConv.telefono, res.pedidoId).catch(() => {})
      }
    } catch {
      setPedidoRes({ ok: false, error: 'No se pudo conectar con MANDI' })
    } finally { setPedidoLoading(false) }
  }

  const handleSaveNotas = async () => {
    if (notasSaving) return
    setNotasSaving(true)
    try {
      await saveNotes(activeConv.telefono, contactInfo?.nombre || activeConv.nombre, notasInput)
      setNotasSaved(true)
      setTimeout(() => setNotasSaved(false), 2500)
    } finally { setNotasSaving(false) }
  }

  const contactName = contactInfo?.alias || contactInfo?.nombre || activeConv.nombre

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#07111d', overflow:'hidden' }}>

      {/* ── INFO CONTACTO ── */}
      <div style={{ flexShrink:0, padding:'14px 14px 10px', borderBottom:'1px solid #111c2a' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:8 }}>
          <Avatar name={contactName} phone={activeConv.telefono} size={38} />
          <div style={{ flex:1, minWidth:0 }}>
            {editAlias ? (
              <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                <input value={aliasInput} onChange={e=>setAliasInput(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter'){ onUpdateContact?.({alias:aliasInput.trim()}); setEditAlias(false) } if(e.key==='Escape') setEditAlias(false) }}
                  autoFocus style={{ flex:1, background:'#0d1828', border:'1px solid #25d366', borderRadius:6, color:'#e2e8f0', fontSize:12, padding:'3px 7px', outline:'none', fontFamily:'inherit' }} />
                <button onClick={()=>{ onUpdateContact?.({alias:aliasInput.trim()}); setEditAlias(false) }} style={{ background:'rgba(37,211,102,.15)', border:'1px solid rgba(37,211,102,.3)', color:'#25d366', borderRadius:5, padding:'3px 7px', fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>✓</button>
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ fontWeight:700, color:'#f1f5f9', fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{contactName}</span>
                <button onClick={()=>{ setAliasInput(contactInfo?.alias||''); setEditAlias(true) }} style={{ background:'transparent', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:10, padding:0, flexShrink:0 }}>✏️</button>
              </div>
            )}
            <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>+{activeConv.telefono}</div>
          </div>
        </div>
        <div style={{ marginTop:7, padding:'5px 10px', background:windowOpen?'rgba(37,211,102,.06)':'rgba(245,158,11,.06)', border:`1px solid ${windowOpen?'rgba(37,211,102,.2)':'rgba(245,158,11,.2)'}`, borderRadius:7, fontSize:11, color:windowOpen?'#25d366':'#f59e0b', fontWeight:700, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>{windowOpen ? '✅ Ventana activa' : '⚠️ Ventana cerrada'}</span>
          {countdown && windowOpen && (
            <span style={{ fontFamily:'monospace', fontSize:12, fontWeight:800, color: parseInt(countdown.split(':')[0]) === 0 && parseInt(countdown.split(':')[1]) < 30 ? '#f87171' : '#25d366', animation: parseInt(countdown.split(':')[0]) === 0 && parseInt(countdown.split(':')[1]) < 30 ? 'blink 1s infinite' : 'none' }}>
              ⏱ {countdown}
            </span>
          )}
          {!windowOpen && (
            <span style={{ fontFamily:'monospace', fontSize:11, color:'#94a3b8' }}>Expirada</span>
          )}
        </div>

      </div>

      {/* ── NOTAS DEL VENDEDOR (arriba, debajo de VENTANA ACTIVA — guarda el pedido creado) ── */}
      <div style={{ flexShrink:0, padding:'8px 12px 10px', borderBottom:'1px solid #111c2a', background:'#0a1019' }}>
        <div onClick={() => setNotasOpen(o => !o)} style={{ padding:'0 0 6px', cursor:'pointer', userSelect:'none', display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ fontSize:9, color:'#475569', transition:'transform .2s', display:'inline-block', transform: notasOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <p style={{ fontSize:10, color:'#f59e0b', fontWeight:700, letterSpacing:'.08em', margin:0, display:'flex', alignItems:'center', gap:5 }}>
            📝 NOTAS
            {notasSaved && <span style={{ fontSize:8, background:'rgba(37,211,102,.15)', color:'#25d366', borderRadius:10, padding:'1px 6px' }}>Guardado ✓</span>}
          </p>
        </div>
        {notasOpen && <>
          {(() => { const u = (String(notasInput || '').match(/https?:\/\/\S+\/dashboard\/pedido\/\S+/) || [])[0]; return u ? (
            <a href={u} target="_blank" rel="noreferrer" style={{ display:'inline-block', marginBottom:6, padding:'4px 9px', background:'rgba(16,185,129,.15)', border:'1px solid rgba(16,185,129,.35)', color:'#10b981', borderRadius:6, fontSize:11, fontWeight:700, textDecoration:'none' }}>📄 Ver pedido</a>
          ) : null })()}
          <textarea
            value={notasInput}
            onChange={e => { setNotasInput(e.target.value); setNotasSaved(false) }}
            placeholder="Ej: Falta que envíe la foto del pago..."
            rows={3}
            style={{ width:'100%', background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:7, color:'#ffffff', fontSize:11, padding:'6px 8px', resize:'vertical', outline:'none', fontFamily:'inherit', whiteSpace:'pre-wrap', minHeight:56 }}
            onFocus={e => e.target.style.borderColor='#f59e0b'} onBlur={e => e.target.style.borderColor='#1e2d3d'}
          />
          <button onClick={handleSaveNotas} disabled={notasSaving}
            style={{ width:'100%', marginTop:5, padding:'6px', background: notasSaving ? '#111c2a' : 'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.3)', color:'#f59e0b', borderRadius:7, fontSize:11, fontWeight:700, cursor: notasSaving ? 'default' : 'pointer', fontFamily:'inherit', transition:'all .15s' }}>
            {notasSaving ? '⏳ Guardando...' : '💾 Guardar nota'}
          </button>
        </> }
      </div>

      {/* ── CREAR PEDIDO ── */}
      <div style={{ flexShrink:0, padding:'10px 12px', borderBottom:'1px solid #111c2a' }}>
        <button onClick={crearPedido} disabled={pedidoLoading}
          style={{ width:'100%', padding:'9px', background: pedidoLoading?'#111c2a':'linear-gradient(135deg,#10b981,#059669)', border:'1px solid rgba(16,185,129,.4)', color:'#fff', borderRadius:8, fontSize:12, fontWeight:800, cursor: pedidoLoading?'default':'pointer', fontFamily:'inherit', letterSpacing:'.03em' }}>
          {pedidoLoading ? '⏳ Leyendo conversación y creando…' : '🧾 CREAR PEDIDO'}
        </button>

        {pedidoRes?.ok && (
          <div style={{ marginTop:8, padding:'9px 10px', background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.3)', borderRadius:8 }}>
            <div style={{ fontSize:12, fontWeight:800, color:'#10b981' }}>✅ Pedido creado: {pedidoRes.pedidoId}</div>
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>Total ${pedidoRes.montoTotal} · {pedidoRes.diasCalculado} días</div>
            <a href={pedidoRes.url} target="_blank" rel="noreferrer" style={{ display:'inline-block', marginTop:6, padding:'5px 10px', background:'rgba(16,185,129,.15)', border:'1px solid rgba(16,185,129,.35)', color:'#10b981', borderRadius:6, fontSize:11, fontWeight:700, textDecoration:'none' }}>📄 Ver pedido</a>
          </div>
        )}

        {pedidoRes && !pedidoRes.ok && pedidoRes.faltan && (
          <div style={{ marginTop:8, padding:'9px 10px', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', borderRadius:8 }}>
            <div style={{ fontSize:11, fontWeight:800, color:'#f59e0b' }}>⚠️ Faltan datos: {pedidoRes.faltan.join(', ')}</div>
            <textarea readOnly value={pedidoRes.sugerencia || ''} rows={3}
              style={{ width:'100%', marginTop:6, background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:6, color:'#e2e8f0', fontSize:11, padding:'6px 8px', resize:'vertical', outline:'none', fontFamily:'inherit', whiteSpace:'pre-wrap' }} />
            <div style={{ display:'flex', gap:5, marginTop:5 }}>
              <button onClick={() => onSendText && onSendText(pedidoRes.sugerencia)} disabled={!windowOpen}
                style={{ flex:1, padding:'6px', background:'rgba(37,211,102,.12)', border:'1px solid rgba(37,211,102,.3)', color:'#25d366', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>📤 Enviar al cliente</button>
              <button onClick={() => onSendText && onSendText(null, pedidoRes.sugerencia)}
                style={{ flex:1, padding:'6px', background:'rgba(255,255,255,.04)', border:'1px solid #2a3f55', color:'#94a3b8', borderRadius:6, fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>✏️ Editar</button>
            </div>
          </div>
        )}

        {pedidoRes && !pedidoRes.ok && !pedidoRes.faltan && (
          <div style={{ marginTop:8, padding:'8px 10px', background:'rgba(248,113,113,.08)', border:'1px solid rgba(248,113,113,.3)', borderRadius:8, fontSize:11, color:'#f87171' }}>
            ❌ {pedidoRes.error || 'No se pudo crear el pedido'}
          </div>
        )}
      </div>

      {/* ── HISTORIAL DE PEDIDOS (MANDARINACRM) ── */}
      <div style={{ flexShrink:0, padding:'8px 12px 10px', borderBottom:'1px solid #111c2a', background:'#0a1019' }}>
        <div onClick={() => setHistOpen(o => !o)} style={{ cursor:'pointer', userSelect:'none', display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ fontSize:9, color:'#475569', transition:'transform .2s', display:'inline-block', transform: histOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <p style={{ fontSize:10, color:'#60a5fa', fontWeight:700, letterSpacing:'.08em', margin:0, display:'flex', alignItems:'center', gap:6 }}>
            📦 HISTORIAL DE PEDIDOS
            {historial?.totalPedidos > 0 && (historial.totalPedidos >= 3 || historial.totalGastado >= 80) && (
              <span style={{ fontSize:8, background:'rgba(245,158,11,.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,.35)', borderRadius:10, padding:'1px 6px', fontWeight:800 }}>⭐ VIP</span>
            )}
          </p>
          <span
            onClick={e => { e.stopPropagation(); loadHistorial(activeConv.telefono, contactInfo?.idVenta) }}
            title="Recargar historial"
            style={{ marginLeft:'auto', color:'#475569', fontSize:12, cursor:'pointer', padding:'0 2px', lineHeight:1 }}
          >🔄</span>
        </div>

        {histOpen && (
          <div style={{ marginTop:8 }}>
            {historial === null && !histError ? (
              // Skeleton mientras carga
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {[0, 1].map(i => (
                  <div key={i} style={{ height:38, borderRadius:8, background:'#0d1828', border:'1px solid #162030', opacity:.6, animation:'pulse 1.2s infinite' }} />
                ))}
              </div>
            ) : histError ? (
              <div style={{ fontSize:11, color:'#64748b', padding:'4px 0' }}>
                No se pudo cargar el historial.{' '}
                <button onClick={() => loadHistorial(activeConv.telefono, contactInfo?.idVenta)}
                  style={{ background:'transparent', border:'none', color:'#60a5fa', cursor:'pointer', fontSize:11, padding:0, textDecoration:'underline', fontFamily:'inherit' }}>Reintentar</button>
              </div>
            ) : !historial || historial.totalPedidos === 0 ? (
              <div style={{ fontSize:11, color:'#94a3b8', padding:'7px 9px', background:'rgba(96,165,250,.06)', border:'1px solid rgba(96,165,250,.18)', borderRadius:7 }}>
                Cliente nuevo ✨ — sin pedidos previos
              </div>
            ) : (
              <>
                <div style={{ fontSize:11, color:'#94a3b8', marginBottom:7 }}>
                  {historial.totalPedidos} pedido{historial.totalPedidos === 1 ? '' : 's'} · <strong style={{ color:'#10b981' }}>${historial.totalGastado.toFixed(2)}</strong> total
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {historial.pedidos.map(p => <PedidoCard key={p.id} p={p} />)}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── RESPUESTAS RÁPIDAS — scroll independiente ── */}
      <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
        <div
          onClick={() => setRepliesOpen(o => !o)}
          style={{ padding:'10px 12px 6px', cursor:'pointer', userSelect:'none' }}
        >
          <p style={{ fontSize:10, color:'#94a3b8', fontWeight:700, letterSpacing:'.08em', display:'flex', alignItems:'center', gap:5, margin:0 }}>
            <span style={{ fontSize:9, color:'#475569', transition:'transform .2s', display:'inline-block', transform: repliesOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            ⚡ RESPUESTAS RÁPIDAS
            {!repliesLoaded && <span style={{ fontSize:9, color:'#94a3b8' }}>cargando...</span>}
            <span onClick={e => { e.stopPropagation(); setRepliesLoaded(false) }} title="Recargar" style={{ marginLeft:'auto', background:'transparent', border:'none', color:'#475569', fontSize:12, cursor:'pointer', padding:'0 2px', lineHeight:1 }}>🔄</span>
          </p>
        </div>

        {repliesOpen && <div style={{ padding:'0 12px', display:'flex', flexDirection:'column', gap:5 }}>
          {replies.map((reply, idx) => { const imgs = getImgUrls(reply); return (
            <div key={reply.id || idx}>
              {editingIdx === idx ? (
                <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid #25d366', borderRadius:9, padding:'7px', marginBottom:2 }}>
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={5} placeholder="Texto..."
                    style={{ width:'100%', background:'#111c2a', border:'1px solid #25d366', borderRadius:6, color:'#e2e8f0', fontSize:12, padding:'8px 10px', resize:'vertical', outline:'none', fontFamily:'inherit', marginBottom:5, whiteSpace:'pre-wrap', minHeight:100 }} />
                  <p style={{ fontSize:9, color:'#475569', marginBottom:3 }}>Fotos ({editImgUrls.length}/{MAX_IMGS})</p>
                  <MultiImgEditor urls={editImgUrls} onChange={setEditImgUrls} />
                  <div style={{ display:'flex', gap:3, marginTop:7 }}>
                    <button onClick={saveEdit} style={{ flex:1, padding:'4px', background:'rgba(37,211,102,.15)', border:'1px solid rgba(37,211,102,.3)', color:'#25d366', borderRadius:6, fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>✓ Guardar</button>
                    <button onClick={() => { setEditingIdx(null); setEditText(''); setEditImgUrls([]) }} style={{ flex:1, padding:'4px', background:'transparent', border:'1px solid #2a3f55', color:'#94a3b8', borderRadius:6, fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
                  </div>
                </div>
              ) : (
                <div style={{ background:'rgba(255,255,255,.02)', border:'1px solid #111c2a', borderRadius:8, overflow:'hidden', transition:'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.04)'}
                  onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.02)'}
                >
                  {/* Strip de fotos (hasta 10) */}
                  {imgs.length > 0 && (
                    <div style={{ display:'flex', gap:1, height:44 }}>
                      {imgs.map((u, i) => (
                        <img key={i} src={u} style={{ flex:1, objectFit:'cover', display:'block', maxWidth:`${100/imgs.length}%` }} alt="" onError={e => e.currentTarget.style.display='none'} />
                      ))}
                    </div>
                  )}
                  {/* Texto + botones */}
                  <div style={{ padding:'7px 8px', display:'flex', alignItems:'flex-start', gap:4 }}>
                    <span style={{ flex:1, fontSize:12, color:'#94a3b8', lineHeight:1.4, overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', minWidth:0 }}>
                      {imgs.length > 0 && `🖼×${imgs.length} `}{reply.text}
                    </span>
                    <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                      <button onClick={() => handleSendQuick(idx)} disabled={sending===idx||!windowOpen} title="Enviar" style={{ background:'rgba(37,211,102,.12)', border:'1px solid rgba(37,211,102,.2)', color:'#25d366', borderRadius:5, padding:'3px 8px', fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>{sending===idx?'⏳':'▶ Enviar'}</button>
                      <button onClick={() => startEdit(idx)} style={{ background:'transparent', border:'1px solid #1e2d3d', color:'#64748b', borderRadius:5, padding:'3px 6px', fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>✏️</button>
                      <button onClick={() => deleteReply(idx)} style={{ background:'transparent', border:'1px solid #1e2d3d', color:'#64748b', borderRadius:5, padding:'3px 6px', fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>🗑</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) })}
        </div>

        }

        {/* Nueva respuesta */}
        <div style={{ margin:'8px 12px 14px', background:'rgba(255,255,255,.02)', border:'1px dashed #1a2d40', borderRadius:8, overflow:'hidden' }}>
          <div
            onClick={() => setNuevaOpen(o => !o)}
            style={{ padding:'7px 9px', cursor:'pointer', userSelect:'none', display:'flex', alignItems:'center', gap:5 }}
          >
            <span style={{ fontSize:9, color:'#475569', transition:'transform .2s', display:'inline-block', transform: nuevaOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            <p style={{ fontSize:9, color:'#ffffff', fontWeight:700, letterSpacing:'.06em', margin:0 }}>+ NUEVA RESPUESTA</p>
          </div>
          {nuevaOpen && <div style={{ padding:'0 7px 7px' }}>
          <textarea value={newText} onChange={e => setNewText(e.target.value)} placeholder="Texto..." rows={2}
            style={{ width:'100%', background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:6, color:'#ffffff', fontSize:11, padding:'5px 7px', resize:'none', outline:'none', fontFamily:'inherit', marginBottom:5, whiteSpace:'pre-wrap' }}
            onFocus={e => e.target.style.borderColor='#25d366'} onBlur={e => e.target.style.borderColor='#1e2d3d'} />
          <p style={{ fontSize:9, color:'#475569', margin:'0 0 3px' }}>Fotos ({newImgUrls.length}/{MAX_IMGS})</p>
          <MultiImgEditor urls={newImgUrls} onChange={setNewImgUrls} />
            <button onClick={addReply} disabled={!newText.trim()} style={{ width:'100%', marginTop:7, padding:'6px', background:newText.trim()?'rgba(37,211,102,.1)':'transparent', border:`1px solid ${newText.trim()?'rgba(37,211,102,.3)':'#475569'}`, color:newText.trim()?'#25d366':'#ffffff', borderRadius:7, fontSize:11, fontWeight:600, cursor:newText.trim()?'pointer':'default', fontFamily:'inherit', transition:'all .15s' }}>
              + Agregar
            </button>
          </div>}
        </div>
      </div>

    </div>
  )
}
