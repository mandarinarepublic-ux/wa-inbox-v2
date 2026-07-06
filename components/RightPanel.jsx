'use client'
import { useState, useRef, useEffect } from 'react'
import { Avatar } from '@/components/Components'
import { fetchRepliesFromSheet, writeReply, saveNotes } from '@/lib/api-client'

const IMGBB_KEY = '2307574d43689522feabd27cff3443df'

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

export default function RightPanel({ activeConv, onQuickReply, onSendText, onSendImage, contactInfo, onUpdateContact, windowOpen }) {
  const [countdown, setCountdown] = useState('')

  // ── Contador regresivo ventana 24h ───────────────────────────
  useEffect(() => {
    if (!activeConv) return
    const lastIncoming = [...activeConv.msgs].reverse().find(m => m.direccion === 'ENTRANTE')
    if (!lastIncoming) return

    const tick = () => {
      const diff = new Date(lastIncoming.timestamp).getTime() + 24 * 60 * 60 * 1000 - Date.now()
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
  const [notasOpen,     setNotasOpen]     = useState(false)
  const [iaOpen,        setIaOpen]        = useState(true)
  const [editingIdx,    setEditingIdx]    = useState(null)
  const [editText,      setEditText]      = useState('')
  const [editImgUrl,    setEditImgUrl]    = useState('')
  const [editImgPrev,   setEditImgPrev]   = useState('')
  const [editUploading, setEditUploading] = useState(false)
  const [newText,       setNewText]       = useState('')
  const [newImgUrl,     setNewImgUrl]     = useState('')
  const [newImgPrev,    setNewImgPrev]    = useState('')
  const [newUploading,  setNewUploading]  = useState(false)
  const [sending,       setSending]       = useState(null)
  const [editAlias,     setEditAlias]     = useState(false)
  const [aliasInput,    setAliasInput]    = useState('')
  const [aiText,        setAiText]        = useState('')
  const [aiSending,     setAiSending]     = useState(false)
  const [aiSent,        setAiSent]        = useState(false)
  const [lastAiMsg,     setLastAiMsg]     = useState('')

  // ── Estado imagen IA ─────────────────────────────────────────
  const [aiImgUrl,      setAiImgUrl]      = useState('')   // URL activa (Shopify o reemplazada)
  const [aiImgPrev,     setAiImgPrev]     = useState('')   // preview visual
  const [aiImgUploading,setAiImgUploading]= useState(false)
  const [aiImgSending,  setAiImgSending]  = useState(false)
  const [aiImgSent,     setAiImgSent]     = useState(false)
  const [lastAiImgSrc,  setLastAiImgSrc]  = useState('')

  // ── Notas del vendedor ───────────────────────────────────────
  const [notasInput,  setNotasInput]  = useState('')
  const [notasSaving, setNotasSaving] = useState(false)
  const [notasSaved,  setNotasSaved]  = useState(false)
  const notasLoadedRef = useRef(null)

  const editFileRef  = useRef(null)
  const newFileRef   = useRef(null)
  const aiImgFileRef = useRef(null)

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
    }
  }, [activeConv, contactInfo])

  if (!activeConv) return null

  const lastMsg = activeConv?.last
  // windowOpen viene como prop desde App.jsx (calculado con último msg ENTRANTE)

  const lastIncoming  = [...activeConv.msgs].reverse().find(m => m.direccion === 'ENTRANTE')
  const aiSuggestion  = lastIncoming?.respuestaIA || ''
  // columna K — imagen sugerida por Shopify
  const aiImgShopify  = lastIncoming?.imagenProducto || ''

  // Sincronizar texto IA cuando cambia el mensaje entrante
  if (aiSuggestion && aiSuggestion !== lastAiMsg) {
    setLastAiMsg(aiSuggestion)
    setAiText(aiSuggestion)
    setAiSent(false)
  }

  // Sincronizar imagen IA cuando llega nueva imagen de Shopify
  if (aiImgShopify && aiImgShopify !== lastAiImgSrc) {
    setLastAiImgSrc(aiImgShopify)
    setAiImgUrl(aiImgShopify)
    setAiImgPrev(aiImgShopify)
    setAiImgSent(false)
  }

  const startEdit = (idx) => {
    setEditingIdx(idx); setEditText(replies[idx].text)
    setEditImgUrl(replies[idx].imageUrl); setEditImgPrev(replies[idx].imageUrl)
  }

  const saveEdit = async () => {
    if (!editText.trim()) return
    const updated = { ...replies[editingIdx], text: editText.trim(), imageUrl: editImgUrl }
    setReplies(prev => prev.map((r, i) => i === editingIdx ? updated : r))
    setEditingIdx(null); setEditText(''); setEditImgUrl(''); setEditImgPrev('')
    await writeReply('actualizar', updated)
  }

  const deleteReply = async (idx) => {
    const reply = replies[idx]
    setReplies(prev => prev.filter((_, i) => i !== idx))
    await writeReply('eliminar', reply)
  }

  const addReply = async () => {
    if (!newText.trim()) return
    const newReply = { id: crypto.randomUUID(), text: newText.trim(), imageUrl: newImgUrl }
    setReplies(prev => [...prev, newReply])
    setNewText(''); setNewImgUrl(''); setNewImgPrev('')
    if (newFileRef.current) newFileRef.current.value = ''
    await writeReply('agregar', newReply)
  }

  const handleSendQuick = async (idx) => {
    setSending(idx)
    await onQuickReply(replies[idx])
    setSending(null)
  }

  const handleSendAI = async () => {
    if (!aiText.trim() || aiSending) return
    setAiSending(true)
    await onSendText(aiText.trim())
    setAiSending(false)
    setAiSent(true)
  }

  // Enviar imagen IA por WhatsApp
  const handleSendAIImage = async () => {
    if (!aiImgUrl || aiImgSending) return
    setAiImgSending(true)
    try {
      if (onSendImage) await onSendImage(aiImgUrl)
      setAiImgSent(true)
    } finally {
      setAiImgSending(false)
    }
  }

  // Reemplazar imagen IA con upload manual
  const handleAiImgReplace = async (e) => {
    const f = e.target.files[0]
    if (!f) return
    setAiImgPrev(URL.createObjectURL(f))
    setAiImgSent(false)
    await uploadImg(f, setAiImgUrl, setAiImgPrev, setAiImgUploading)
  }

  // Guardar nota del vendedor (col I vía webhook)
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

      {/* ── SUGERENCIA IA — fija ── */}
      <div style={{ flexShrink:0, borderBottom:'1px solid #111c2a' }}>
        <div
          onClick={() => setIaOpen(o => !o)}
          style={{ padding:'10px 12px 6px', cursor:'pointer', userSelect:'none', display:'flex', alignItems:'center', gap:5 }}
        >
          <span style={{ fontSize:9, color:'#475569', transition:'transform .2s', display:'inline-block', transform: iaOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <p style={{ fontSize:10, color:'#6366f1', fontWeight:700, letterSpacing:'.08em', margin:0, display:'flex', alignItems:'center', gap:5 }}>
            🤖 SUGERENCIA IA
            {aiSuggestion && <span style={{ fontSize:8, background:'rgba(99,102,241,.15)', color:'#818cf8', borderRadius:10, padding:'1px 6px' }}>Gemini</span>}
          </p>
        </div>
        {iaOpen && <div style={{ padding:'0 12px 10px' }}>
        {aiSuggestion ? (
          <>
            {/* ── Imagen del producto Shopify ── */}
            {(aiImgPrev || aiImgShopify) && (
              <div style={{ marginBottom:7, position:'relative', borderRadius:8, overflow:'hidden', border:'1px solid #1a2d40' }}>
                <img
                  src={aiImgPrev || aiImgShopify}
                  alt="Producto"
                  style={{ width:'100%', height:160, objectFit:'contain', background:'#0a0f1a', display:'block' }}
                  onError={e => e.currentTarget.style.display='none'}
                />
                {aiImgUploading && (
                  <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#fff' }}>
                    Subiendo...
                  </div>
                )}
                {/* Controles imagen */}
                <div style={{ position:'absolute', bottom:4, right:4, display:'flex', gap:3 }}>
                  <button
                    onClick={() => aiImgFileRef.current?.click()}
                    title="Cambiar imagen"
                    style={{ background:'rgba(0,0,0,.7)', border:'1px solid rgba(255,255,255,.2)', color:'#fff', borderRadius:5, padding:'2px 6px', fontSize:9, cursor:'pointer', fontFamily:'inherit' }}>
                    🔄 Cambiar
                  </button>
                  <button
                    onClick={() => { setAiImgUrl(''); setAiImgPrev(''); setAiImgSent(false) }}
                    title="Quitar imagen"
                    style={{ background:'rgba(0,0,0,.7)', border:'1px solid rgba(255,255,255,.2)', color:'#f87171', borderRadius:5, padding:'2px 6px', fontSize:9, cursor:'pointer', fontFamily:'inherit' }}>
                    ✕
                  </button>
                </div>
                <input ref={aiImgFileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleAiImgReplace} />
              </div>
            )}

            {/* Botón enviar imagen */}
            {aiImgUrl && (
              <button
                onClick={handleSendAIImage}
                disabled={aiImgSending || aiImgSent || !windowOpen}
                style={{
                  width:'100%', marginBottom:5, padding:'5px',
                  background: aiImgSent ? 'rgba(37,211,102,.15)' : aiImgSending ? '#111c2a' : 'rgba(99,102,241,.12)',
                  border: `1px solid ${aiImgSent ? 'rgba(37,211,102,.3)' : 'rgba(99,102,241,.3)'}`,
                  color: aiImgSent ? '#25d366' : '#818cf8',
                  borderRadius:7, fontSize:10, fontWeight:700, cursor: aiImgSent || aiImgSending ? 'default' : 'pointer',
                  fontFamily:'inherit', transition:'all .15s'
                }}>
                {aiImgSent ? '✓ Foto enviada' : aiImgSending ? '⏳ Enviando...' : '🖼 Enviar foto del producto'}
              </button>
            )}

            {/* Texto editable — con soporte whitespace */}
            <textarea
              value={aiText}
              onChange={e => { setAiText(e.target.value); setAiSent(false) }}
              rows={4}
              style={{
                width:'100%',
                background:'rgba(99,102,241,.06)',
                border:`1px solid ${aiSent?'rgba(37,211,102,.3)':'rgba(99,102,241,.25)'}`,
                borderRadius:8, color:'#c7d2fe', fontSize:12,
                padding:'7px 9px', resize:'none', outline:'none',
                fontFamily:'inherit', lineHeight:1.5,
                whiteSpace:'pre-wrap'   // ← FIX saltos de línea
              }}
            />
            <div style={{ display:'flex', gap:5, marginTop:5 }}>
              <button onClick={handleSendAI} disabled={aiSending||aiSent||!aiText.trim()||!windowOpen} style={{
                flex:2, padding:'6px',
                background:aiSent?'rgba(37,211,102,.15)':aiSending?'#111c2a':'linear-gradient(135deg,#6366f1,#4f46e5)',
                border:`1px solid ${aiSent?'rgba(37,211,102,.3)':'rgba(99,102,241,.4)'}`,
                color:aiSent?'#25d366':'#fff',
                borderRadius:7, fontSize:11, fontWeight:700,
                cursor:aiSent||aiSending?'default':'pointer', fontFamily:'inherit',
              }}>{aiSent?'✓ Enviado':aiSending?'⏳...':'📤 Enviar texto'}</button>
              <button onClick={() => onSendText && onSendText(null, aiText)} style={{ flex:1, padding:'6px', background:'rgba(255,255,255,.04)', border:'1px solid #2a3f55', color:'#94a3b8', borderRadius:7, fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>✏️ Editar</button>
            </div>
          </>
        ) : (
          <div style={{ padding:'12px', textAlign:'center', color:'#94a3b8', fontSize:11, background:'rgba(255,255,255,.02)', borderRadius:8, border:'1px dashed #2a3f55' }}>
            Esperando mensaje...
          </div>
        )}
        </div>}
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
          {replies.map((reply, idx) => (
            <div key={reply.id || idx}>
              {editingIdx === idx ? (
                <div style={{ background:'rgba(255,255,255,.03)', border:'1px solid #25d366', borderRadius:9, padding:'7px', marginBottom:2 }}>
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={5} placeholder="Texto..."
                    style={{ width:'100%', background:'#111c2a', border:'1px solid #25d366', borderRadius:6, color:'#e2e8f0', fontSize:12, padding:'8px 10px', resize:'vertical', outline:'none', fontFamily:'inherit', marginBottom:5, whiteSpace:'pre-wrap', minHeight:100 }} />
                  <div style={{ marginBottom:5 }}>
                    {editImgPrev ? (
                      <div style={{ position:'relative' }}>
                        <img src={editImgPrev} style={{ width:'100%', height:52, objectFit:'cover', borderRadius:5 }} alt="" />
                        {editUploading && <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.5)', borderRadius:5, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#fff' }}>Subiendo...</div>}
                        <button onClick={() => { setEditImgUrl(''); setEditImgPrev(''); if(editFileRef.current) editFileRef.current.value='' }} style={{ position:'absolute', top:2, right:2, background:'rgba(0,0,0,.6)', border:'none', color:'#fff', borderRadius:'50%', width:16, height:16, cursor:'pointer', fontSize:8, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => editFileRef.current?.click()} style={{ width:'100%', padding:'4px', background:'transparent', border:'1px dashed #2a3f55', borderRadius:6, color:'#94a3b8', fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>📷 Imagen</button>
                    )}
                    <input ref={editFileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={async e => { const f=e.target.files[0]; if(!f)return; setEditImgPrev(URL.createObjectURL(f)); await uploadImg(f,setEditImgUrl,setEditImgPrev,setEditUploading) }} />
                  </div>
                  <div style={{ display:'flex', gap:3 }}>
                    <button onClick={saveEdit} disabled={editUploading} style={{ flex:1, padding:'4px', background:'rgba(37,211,102,.15)', border:'1px solid rgba(37,211,102,.3)', color:'#25d366', borderRadius:6, fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>✓ Guardar</button>
                    <button onClick={() => { setEditingIdx(null); setEditText(''); setEditImgUrl(''); setEditImgPrev('') }} style={{ flex:1, padding:'4px', background:'transparent', border:'1px solid #2a3f55', color:'#94a3b8', borderRadius:6, fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
                  </div>
                </div>
              ) : (
                <div style={{ background:'rgba(255,255,255,.02)', border:'1px solid #111c2a', borderRadius:8, overflow:'hidden', transition:'background .1s', display:'flex', alignItems:'stretch' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.04)'}
                  onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.02)'}
                >
                  {/* Imagen izquierda */}
                  {reply.imageUrl && (
                    <div style={{ width:90, flexShrink:0 }}>
                      <img src={reply.imageUrl} style={{ width:90, height:'100%', minHeight:72, objectFit:'cover', display:'block' }} alt="" onError={e => e.currentTarget.style.display='none'} />
                    </div>
                  )}
                  {/* Texto + botones derecha */}
                  <div style={{ flex:1, padding:'7px 8px', display:'flex', flexDirection:'column', justifyContent:'space-between', gap:4, minWidth:0 }}>
                    <span style={{ fontSize:12, color:'#94a3b8', lineHeight:1.4, overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical' }}>
                      {reply.text}
                    </span>
                    <div style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                      <button onClick={() => handleSendQuick(idx)} disabled={sending===idx||!windowOpen} title="Enviar" style={{ background:'rgba(37,211,102,.12)', border:'1px solid rgba(37,211,102,.2)', color:'#25d366', borderRadius:5, padding:'3px 8px', fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>{sending===idx?'⏳':'▶ Enviar'}</button>
                      <button onClick={() => startEdit(idx)} style={{ background:'transparent', border:'1px solid #1e2d3d', color:'#64748b', borderRadius:5, padding:'3px 6px', fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>✏️</button>
                      <button onClick={() => deleteReply(idx)} style={{ background:'transparent', border:'1px solid #1e2d3d', color:'#64748b', borderRadius:5, padding:'3px 6px', fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>🗑</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
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
          <div style={{ marginBottom:5 }}>
            {newImgPrev ? (
              <div style={{ position:'relative' }}>
                <img src={newImgPrev} style={{ width:'100%', height:52, objectFit:'cover', borderRadius:5 }} alt="" />
                {newUploading && <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.5)', borderRadius:5, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#fff' }}>Subiendo...</div>}
                <button onClick={() => { setNewImgUrl(''); setNewImgPrev(''); if(newFileRef.current) newFileRef.current.value='' }} style={{ position:'absolute', top:2, right:2, background:'rgba(0,0,0,.6)', border:'none', color:'#fff', borderRadius:'50%', width:16, height:16, cursor:'pointer', fontSize:8, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
              </div>
            ) : (
              <button onClick={() => newFileRef.current?.click()} style={{ width:'100%', padding:'4px', background:'transparent', border:'1px dashed #475569', borderRadius:6, color:'#ffffff', fontSize:10, cursor:'pointer', fontFamily:'inherit' }}>📷 Imagen (opcional)</button>
            )}
            <input ref={newFileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={async e => { const f=e.target.files[0]; if(!f)return; setNewImgPrev(URL.createObjectURL(f)); await uploadImg(f,setNewImgUrl,setNewImgPrev,setNewUploading) }} />
          </div>
            <button onClick={addReply} disabled={!newText.trim()||newUploading} style={{ width:'100%', padding:'6px', background:newText.trim()&&!newUploading?'rgba(37,211,102,.1)':'transparent', border:`1px solid ${newText.trim()&&!newUploading?'rgba(37,211,102,.3)':'#475569'}`, color:newText.trim()&&!newUploading?'#25d366':'#ffffff', borderRadius:7, fontSize:11, fontWeight:600, cursor:newText.trim()&&!newUploading?'pointer':'default', fontFamily:'inherit', transition:'all .15s' }}>
              {newUploading?'Subiendo...':'+ Agregar'}
            </button>
          </div>}
        </div>
      </div>

      {/* ── NOTAS DEL VENDEDOR ── */}
      <div style={{ flexShrink:0, borderTop:'1px solid #111c2a', background:'#0a1019' }}>
        <div
          onClick={() => setNotasOpen(o => !o)}
          style={{ padding:'10px 12px 6px', cursor:'pointer', userSelect:'none', display:'flex', alignItems:'center', gap:5 }}
        >
          <span style={{ fontSize:9, color:'#475569', transition:'transform .2s', display:'inline-block', transform: notasOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <p style={{ fontSize:10, color:'#f59e0b', fontWeight:700, letterSpacing:'.08em', margin:0, display:'flex', alignItems:'center', gap:5 }}>
            📝 NOTAS
            {notasSaved && <span style={{ fontSize:8, background:'rgba(37,211,102,.15)', color:'#25d366', borderRadius:10, padding:'1px 6px' }}>Guardado ✓</span>}
          </p>
        </div>
        {notasOpen && <><textarea
          value={notasInput}
          onChange={e => { setNotasInput(e.target.value); setNotasSaved(false) }}
          placeholder="Ej: Falta que envíe la foto del pago..."
          rows={2}
          style={{ width:'100%', background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:7, color:'#ffffff', fontSize:11, padding:'6px 8px', resize:'vertical', outline:'none', fontFamily:'inherit', whiteSpace:'pre-wrap', minHeight:46 }}
          onFocus={e => e.target.style.borderColor='#f59e0b'} onBlur={e => e.target.style.borderColor='#1e2d3d'}
        />
        <button onClick={handleSaveNotas} disabled={notasSaving}
          style={{ width:'100%', marginTop:5, padding:'6px', background: notasSaving ? '#111c2a' : 'rgba(245,158,11,.12)', border:'1px solid rgba(245,158,11,.3)', color:'#f59e0b', borderRadius:7, fontSize:11, fontWeight:700, cursor: notasSaving ? 'default' : 'pointer', fontFamily:'inherit', transition:'all .15s' }}>
          {notasSaving ? '⏳ Guardando...' : '💾 Guardar nota'}
        </button></> }
      </div>
    </div>
  )
}
