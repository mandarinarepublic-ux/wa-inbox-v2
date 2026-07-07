'use client'
import { useState, useRef, useEffect } from 'react'
import { Avatar } from '@/components/Components'
import { fetchRepliesFromSheet, writeReply, saveNotes } from '@/lib/api-client'

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

      {/* SUGERENCIA IA eliminada — respuestas rápidas suben para optimizar espacio */}

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
