'use client'
// ============================================================
// RepublicInbox.jsx — v3 (reescritura limpia)
// Lee WhatsApp Web via extensión Chrome
// Comunicación: postMessage → wa_inbox_bridge.js → background → content.js
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchRepliesFromSheet } from '@/lib/api-client'

// ─── Republic Launcher (puerto 3098, corre en tu PC) ─────────
const LAUNCHER_URL = 'http://localhost:3098';

async function launcherCall(endpoint, method = 'GET') {
  try {
    const res = await fetch(`${LAUNCHER_URL}${endpoint}`, { method, headers: { 'Content-Type': 'application/json' } });
    return await res.json();
  } catch { return null; }
}

// ─── Republic Server URL (se actualiza automáticamente desde launcher) ────
function getServerUrl() {
  try { return localStorage.getItem('republic_server_url') || ''; }
  catch { return ''; }
}
function setServerUrl(url) {
  try { localStorage.setItem('republic_server_url', url); } catch {}
}

// ─── Panel de control del launcher ───────────────────────────
function LauncherPanel({ onConnected }) {
  const [status,    setStatus]    = useState(null);
  const [starting,  setStarting]  = useState(false);
  const [logs,      setLogs]      = useState([]);
  const [showLogs,  setShowLogs]  = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = async () => {
    const s = await launcherCall('/launcher/status');
    if (s) {
      setStatus(s);
      setLogs(s.logs || []);
      if (s.tunnelUrl) {
        setServerUrl(s.tunnelUrl);
        if (s.serverReady) onConnected();
      }
    } else {
      setStatus(null);
    }
  };

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  const handleStart = async () => {
    setStarting(true);
    await launcherCall('/launcher/start', 'POST');
    setTimeout(() => setStarting(false), 2000);
  };

  const launcherRunning = status !== null;
  const serverRunning   = status?.serverRunning;
  const serverReady     = status?.serverReady;
  const tunnelRunning   = status?.tunnelRunning;
  const tunnelUrl       = status?.tunnelUrl;

  const Dot = ({ ok }) => (
    <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background: ok ? '#4ade80' : '#ef4444', boxShadow: ok ? '0 0 6px #4ade8080' : 'none', marginRight:6, flexShrink:0 }} />
  );

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#080d14', padding:24 }}>
      <div style={{ width:'100%', maxWidth:440, background:'#0d1420', border:'1px solid #1e2d3d', borderRadius:20, overflow:'hidden' }}>

        <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #1e2d3d' }}>
          <div style={{ fontSize:11, fontWeight:800, color:'#f97316', letterSpacing:'2px', marginBottom:4 }}>⬡ REPUBLIC — PANEL DE CONTROL</div>
          <div style={{ fontSize:12, color:'#475569' }}>
            {launcherRunning ? 'Launcher detectado en localhost:3098' : 'Launcher no detectado — ejecuta INICIAR.bat'}
          </div>
        </div>

        <div style={{ padding:'16px 24px', borderBottom:'1px solid #0d1420', display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { label:'Launcher',          ok: launcherRunning, text: launcherRunning ? 'Corriendo en :3098' : 'No detectado' },
            { label:'Republic Server',   ok: serverRunning,   text: serverRunning ? (serverReady ? 'WhatsApp conectado ✅' : 'Iniciando...') : 'Apagado' },
            { label:'Tunnel Cloudflare', ok: tunnelRunning,   text: tunnelUrl ? tunnelUrl.replace('https://','') : (tunnelRunning ? 'Conectando...' : 'Apagado') },
          ].map(({ label, ok, text }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Dot ok={ok} />
              <span style={{ fontSize:11, color:'#64748b', width:140, flexShrink:0 }}>{label}</span>
              <span style={{ fontSize:11, color: ok ? '#94a3b8' : '#334155', fontFamily:'monospace' }}>{text}</span>
            </div>
          ))}
        </div>

        <div style={{ padding:'16px 24px', display:'flex', flexDirection:'column', gap:10 }}>
          {!launcherRunning ? (
            <div style={{ background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:12, padding:'14px 16px' }}>
              <div style={{ fontSize:11, color:'#f97316', fontWeight:700, marginBottom:8 }}>📋 Para activar REPUBLIC:</div>
              <div style={{ fontSize:12, color:'#64748b', lineHeight:1.8 }}>
                1. Ve a la carpeta <span style={{color:'#e2e8f0', fontFamily:'monospace'}}>republic-server</span> en tu PC<br/>
                2. Doble clic en <span style={{color:'#4ade80', fontFamily:'monospace'}}>INICIAR.bat</span><br/>
                3. Esta pantalla se actualiza sola
              </div>
            </div>
          ) : (
            <>
              {(!serverRunning || !tunnelRunning) && (
                <button
                  onClick={handleStart}
                  disabled={starting}
                  style={{ width:'100%', padding:'12px', borderRadius:10, border:'none', background: starting ? '#1e2d3d' : 'linear-gradient(135deg,#f97316,#ea580c)', color:'#fff', fontSize:13, fontWeight:700, cursor: starting ? 'default' : 'pointer' }}
                >
                  {starting ? '⏳ Iniciando...' : '▶ Iniciar Servidor + Tunnel'}
                </button>
              )}
              {serverReady && tunnelUrl && (
                <button
                  onClick={onConnected}
                  style={{ width:'100%', padding:'12px', borderRadius:10, border:'1px solid #4ade8040', background:'#052e16', color:'#4ade80', fontSize:13, fontWeight:700, cursor:'pointer' }}
                >
                  ✅ Conectado — Abrir REPUBLIC
                </button>
              )}
            </>
          )}

          {launcherRunning && (
            <button onClick={() => setShowLogs(v => !v)} style={{ width:'100%', padding:'8px', borderRadius:8, border:'1px solid #1e2d3d', background:'transparent', color:'#475569', fontSize:11, cursor:'pointer' }}>
              {showLogs ? '▲ Ocultar logs' : '▼ Ver logs del servidor'}
            </button>
          )}

          {showLogs && logs.length > 0 && (
            <div style={{ background:'#060b11', border:'1px solid #1e2d3d', borderRadius:8, padding:12, maxHeight:160, overflowY:'auto' }}>
              {logs.map((l, i) => (
                <div key={i} style={{ fontSize:10, fontFamily:'monospace', color: l.includes('✅') ? '#4ade80' : l.includes('ERR') ? '#f87171' : '#475569', marginBottom:2 }}>{l}</div>
              ))}
            </div>
          )}

          {serverRunning && !serverReady && (
            <a href="http://localhost:3099/qr" target="_blank" rel="noreferrer"
              style={{ display:'block', textAlign:'center', padding:'10px', borderRadius:8, background:'#111c2a', border:'1px solid #1e2d3d', color:'#60a5fa', fontSize:12, textDecoration:'none' }}>
              📷 Escanear QR de WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

async function serverCall(endpoint, method = 'GET', body = null) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`${getServerUrl()}${endpoint}`, opts);
    return await res.json();
  } catch (e) {
    throw new Error('No se puede conectar al servidor REPUBLIC. ¿Está corriendo?');
  }
}

// ─── Google Sheet REPUBLIC ────────────────────────────────────────
const SHEET_ID       = '1hShfG4CR-yhk2sSD_VXMAAU8O4VLFmxJO1Rj6ToBDgw'
const MAKE_CONTACTOS = 'https://hook.us2.make.com/0p7ay5gjohav0g9ujnph7iz0n04kjqhr'

// ─── Estados ─────────────────────────────────────────────────────
const ESTADOS       = ['PENDIENTE', 'VENTAPROCESO', 'ATENDIDO', 'ARCHIVADO']
const ESTADO_LABELS = {
  PENDIENTE:    'PENDIENTES',
  VENTAPROCESO: 'EN PROCESO',
  ATENDIDO:     'ATENDIDOS',
  ARCHIVADO:    'ARCHIVADOS',
}
const ESTADO_COLORS = {
  PENDIENTE:    '#f87171',
  VENTAPROCESO: '#f59e0b',
  ATENDIDO:     '#4ade80',
  ARCHIVADO:    '#6b7280',
}

// ─── Cache de módulo (sobrevive re-mounts de StrictMode) ──────────
const CACHE = { chats: [], contacts: [], quickReplies: [], bridgeOk: false }

// ─── Bridge: postMessage → wa_inbox_bridge.js ────────────────────
// Cada llamada registra su propio listener one-shot
function bridgeCall(type, extra = {}) {
  return new Promise((resolve, reject) => {
    const msgId = `${Date.now()}_${Math.random().toString(36).slice(2)}`

    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error('Timeout — ¿WhatsApp Web está abierto en Chrome?'))
    }, 8000)

    function handler(e) {
      if (e.source !== window)                    return
      if (e.data?.type   !== 'REPUBLIC_RESULT')   return
      if (e.data?.msgId  !== msgId)               return
      clearTimeout(timer)
      window.removeEventListener('message', handler)
      const r = e.data.response
      if (r?.error) reject(new Error(r.error))
      else          resolve(r)
    }

    window.addEventListener('message', handler)
    window.postMessage({ type: 'REPUBLIC_CMD', msgId, payload: { type, ...extra } }, '*')
  })
}

// ─── Fetch Google Sheet (público, sin API key) ────────────────────
async function sheetFetch(tabName) {
  try {
    const url  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`
    const res  = await fetch(url)
    const text = await res.text()
    const json = JSON.parse(text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)[1])
    return (json.table.rows || []).map(r => r.c.map(c => c?.v ?? c?.f ?? ''))
  } catch { return [] }
}

async function loadContactos() {
  const rows = await sheetFetch('CONTACTOS')
  return rows.filter(r => r[0]).map(r => ({
    telefono:  String(r[0] || ''),
    nombre:    r[1] || '',
    alias:     r[2] || '',
    estado:    r[3] || 'PENDIENTE',
  }))
}

// Respuestas rápidas vienen de la misma Sheet que MANDI via api.js

// ─── Análisis Claude ──────────────────────────────────────────────
async function analyzeChat(messages, contactName) {
  const transcript = messages
    .map(m => `[${m.time || '?'}] ${m.sender}: ${m.text}`)
    .join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Eres experto en ventas conversacionales para Mandarina Republic, tienda de ropa urbana/anime en Ecuador.

Analiza esta conversación de WhatsApp con "${contactName}":
---
${transcript}
---

Responde SOLO en JSON con estas 3 claves (sin markdown, sin backticks):
{
  "resumen": "Qué quería el cliente y cómo terminó (máx 2 oraciones)",
  "razon_no_venta": "Por qué no se cerró la venta. Si sí se vendió: 'Venta concretada ✅'",
  "sugerencias": "2-3 acciones concretas para la próxima vez"
}`
      }]
    })
  })
  const data = await res.json()
  const text = data.content?.[0]?.text || '{}'
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()) }
  catch { return { resumen: text, razon_no_venta: '', sugerencias: '' } }
}

// ════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════
export default function RepublicInbox({ active = false }) {
  // REPUBLIC solo funciona en PC (requiere extensión Chrome + servidor local)
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  )

  if (isMobile) {
    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#080d14', color:'#f0f0f0', padding:24, textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>💻</div>
        <div style={{ fontSize:16, fontWeight:700, color:'#f97316', marginBottom:8 }}>REPUBLIC — Solo disponible en PC</div>
        <div style={{ fontSize:13, color:'#334155', lineHeight:1.6, maxWidth:280 }}>
          Esta línea requiere el servidor REPUBLIC corriendo en tu computador.<br/><br/>
          Para atender desde el celular usa <strong style={{color:'#25d366'}}>MANDI</strong>.
        </div>
      </div>
    )
  }

  const [bridgeOk,     setBridgeOk]     = useState(CACHE.bridgeOk)
  const [showLauncher,  setShowLauncher]  = useState(!CACHE.bridgeOk)
  const [chatList,     setChatList]     = useState(CACHE.chats)
  const [contacts,     setContacts]     = useState(CACHE.contacts)
  const [quickReplies, setQuickReplies] = useState(CACHE.quickReplies)
  const [activeChat,   setActiveChat]   = useState(null)
  const [conversation, setConversation] = useState([])
  const [loadingConv,  setLoadingConv]  = useState(false)
  const [replyText,    setReplyText]    = useState('')
  const [sending,      setSending]      = useState(false)
  const [showQR,       setShowQR]       = useState(false)
  const [analysis,     setAnalysis]     = useState(null)
  const [analyzing,    setAnalyzing]    = useState(false)
  const [msgLimit,     setMsgLimit]     = useState(50)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [searchQuery,  setSearchQuery]  = useState('')
  const [filterEstado, setFilterEstado] = useState('ALL')
  const [toast,        setToast]        = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  const messagesEnd = useRef(null)
  const pollRef     = useRef(null)
  const loadedRef   = useRef(false) // evitar doble carga en StrictMode

  // ── Toast ──────────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Cargar chats desde WA Web ──────────────────────────────────
  const fetchChats = useCallback(async () => {
    try {
      const res = await serverCall('/chats')
      if (res?.ok && res?.chats?.length) {
        CACHE.chats    = res.chats
        CACHE.bridgeOk = true
        setChatList(res.chats)
        setBridgeOk(true)
      }
    } catch (e) {
      console.warn('[REPUBLIC] fetchChats:', e.message)
    }
  }, [])

  // ── Init cuando active cambia a true ──────────────────────────
  useEffect(() => {
    if (!active) return
    if (loadedRef.current) return // ya cargó — evitar doble en StrictMode
    loadedRef.current = true

    // 1. Ping al servidor REPUBLIC
    serverCall('/status').then(res => {
      if (res?.ok) {
        CACHE.bridgeOk = true
        setBridgeOk(true)
        // 2. Cargar chats
        return serverCall('/chats')
      }
    }).then(res => {
      if (res?.ok && res?.chats?.length) {
        CACHE.chats = res.chats
        setChatList(res.chats)
      }
    }).catch(e => {
      console.warn('[REPUBLIC] init server:', e.message)
      setBridgeOk(false)
    })

    // 3. Cargar Sheet data
    loadContactos().then(data => {
      if (data.length) { CACHE.contacts = data; setContacts(data) }
    })
    fetchRepliesFromSheet().then(data => {
      // Mapear campos de MANDI (text/imageUrl) a REPUBLIC (texto/imagenUrl)
      const mapped = data.map(r => ({ ...r, texto: r.text, imagenUrl: r.imageUrl }))
      if (mapped.length) { CACHE.quickReplies = mapped; setQuickReplies(mapped) }
    }).catch(() => {})

    // Cleanup: reset flag para que la próxima activación recargue
    return () => { loadedRef.current = false }
  }, [active])

  // ── Poll de conversación cada 8s ──────────────────────────────
  useEffect(() => {
    if (!activeChat || !bridgeOk) return
    const poll = async () => {
      try {
        const chatId2 = activeChat?.chatId || activeChat?.id || activeChat?.telefono || ''
        const res = await serverCall('/messages?id=' + chatId2 + '&limit=' + msgLimit)
        if (res?.ok && res?.messages?.length) setConversation(res.messages)
      } catch {}
    }
    pollRef.current = setInterval(poll, 8000)
    return () => clearInterval(pollRef.current)
  }, [activeChat, bridgeOk])

  // ── Auto scroll ────────────────────────────────────────────────
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation])

  // ── Abrir chat ─────────────────────────────────────────────────
  const openChat = useCallback(async (contact) => {
    setActiveChat(contact)
    setConversation([])
    setAnalysis(null)
    setMsgLimit(50)
    setLoadingConv(true)
    try {
      const name = contact.alias || contact.nombre || contact.name || contact.telefono
      // Usar chatId si está disponible (soporta @lid y @c.us)
      const chatId = contact.chatId || contact.id || contact.telefono || contact.phone || ''
      const res = await serverCall('/messages?id=' + chatId + '&limit=' + msgLimit)
      if (res?.ok && res?.messages) setConversation(res.messages)
    } catch (e) { showToast('❌ ' + e.message, 'error') }
    finally { setLoadingConv(false) }
  }, [showToast])

  // ── Enviar respuesta ───────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!replyText.trim() || !bridgeOk) return
    setSending(true)
    try {
      const chatIdS = activeChat?.chatId || activeChat?.id || activeChat?.telefono || ''
      const res = await serverCall('/send/text', 'POST', {
        telefono: chatIdS,
        mensaje: replyText.trim()
      })
      if (res?.ok) {
        setReplyText('')
        showToast('✅ Enviado', 'success')
        setTimeout(async () => {
          const chatIdR = activeChat?.chatId || activeChat?.id || activeChat?.telefono || ''
          const conv = await serverCall('/messages?id=' + chatIdR).catch(() => null)
          if (conv?.ok && conv?.messages) setConversation(conv.messages)
        }, 1500)
      } else showToast('❌ ' + (res?.error || 'Error'), 'error')
    } catch (e) { showToast('❌ ' + e.message, 'error') }
    finally { setSending(false) }
  }, [replyText, bridgeOk, showToast])

  // ── Cambiar estado contacto ────────────────────────────────────
  const changeEstado = useCallback(async (contact, nuevoEstado) => {
    try {
      await fetch(MAKE_CONTACTOS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Telefono: contact.telefono || contact.name,
          Estado:   nuevoEstado,
          Alias:    contact.alias || contact.nombre || contact.name,
        })
      })
      setActiveChat(prev => prev ? { ...prev, estado: nuevoEstado } : prev)
      showToast(`Estado → ${nuevoEstado}`, 'success')
      loadContactos().then(data => { CACHE.contacts = data; setContacts(data) })
    } catch { showToast('❌ Error al cambiar estado', 'error') }
  }, [showToast])

  // ── Análisis Claude ────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!conversation.length || !activeChat) return
    setAnalyzing(true)
    setAnalysis(null)
    try {
      const name   = activeChat.alias || activeChat.nombre || activeChat.name || 'Cliente'
      const result = await analyzeChat(conversation, name)
      setAnalysis(result)
      showToast('✅ Análisis listo', 'success')
    } catch (e) { showToast('❌ ' + e.message, 'error') }
    finally { setAnalyzing(false) }
  }, [conversation, activeChat, showToast])

  // ── Combinar chats WA + contactos Sheet ───────────────────────
  const contactMap = Object.fromEntries(contacts.map(c => [c.telefono, c]))
  const mergedList = chatList.map(chat => ({
    ...chat,
    ...(contactMap[chat.name] || {}),
    estado: contactMap[chat.name]?.estado || 'PENDIENTE',
  }))

  const filteredList = mergedList.filter(c => {
    // Filtro por estado
    if (filterEstado !== 'ALL') {
      if ((c.estado || 'PENDIENTE').toUpperCase() !== filterEstado) return false
    }
    // Filtro por búsqueda
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return (c.nombre || '').toLowerCase().includes(q) ||
             (c.alias || '').toLowerCase().includes(q) ||
             (c.telefono || '').includes(q) ||
             (c.name || '').toLowerCase().includes(q)
    }
    return true
  })

  const byEstado = {
    PENDIENTE:    filteredList.filter(c => (c.estado || 'PENDIENTE').toUpperCase() === 'PENDIENTE'),
    VENTAPROCESO: filteredList.filter(c => (c.estado || '').toUpperCase() === 'VENTAPROCESO'),
    ATENDIDO:     filteredList.filter(c => (c.estado || '').toUpperCase() === 'ATENDIDO'),
    ARCHIVADO:    filteredList.filter(c => (c.estado || '').toUpperCase() === 'ARCHIVADO'),
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════

  // Si el launcher no está listo → mostrar panel de control
  if (showLauncher) {
    return (
      <LauncherPanel
        onConnected={() => {
          setShowLauncher(false);
          setBridgeOk(true);
          CACHE.bridgeOk = true;
          fetchChats();
        }}
      />
    );
  }

  return (
    <div style={{ display:'flex', width:'100%', height:'100%', background:'#080d14', color:'#f0f0f0', fontFamily:'Outfit,sans-serif', position:'relative', overflow:'hidden' }}>

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position:'fixed', top:24, left:'50%', transform:'translateX(-50%)',
          background: toast.type==='success' ? '#052e16' : toast.type==='error' ? '#2d0a0a' : '#1a1a1a',
          border:`1px solid ${toast.type==='success'?'#4ade8040':toast.type==='error'?'#f8717140':'#2a2a2a'}`,
          color: toast.type==='success' ? '#4ade80' : toast.type==='error' ? '#f87171' : '#f0f0f0',
          padding:'10px 20px', borderRadius:20, fontSize:13, fontWeight:500,
          zIndex:9999, whiteSpace:'nowrap', boxShadow:'0 4px 20px #00000080',
        }}>{toast.msg}</div>
      )}

      {/* ── SIDEBAR CONTACTOS ── */}
      <div style={{ width:270, flexShrink:0, borderRight:'1px solid #162030', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'14px 12px 10px', borderBottom:'1px solid #162030', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:10, fontWeight:800, color:'#f97316', letterSpacing:'2px' }}>REPUBLIC</div>
              <div style={{ fontSize:11, color:'#334155', marginTop:2 }}>{mergedList.length} chats</div>
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              {/* dot de estado bridge */}
              <div title={bridgeOk ? 'Bridge OK' : 'Sin conexión'} style={{
                width:8, height:8, borderRadius:'50%',
                background: bridgeOk ? '#4ade80' : '#ef4444',
                boxShadow: bridgeOk ? '0 0 6px #4ade8080' : 'none',
                cursor:'pointer',
              }} onClick={fetchChats} />
              {/* reload */}
              <button onClick={fetchChats} title="Recargar chats" style={{ background:'transparent', border:'none', color:'#334155', fontSize:14, cursor:'pointer', padding:'2px 4px' }}>🔄</button>
              {/* settings */}
              <button onClick={() => setShowSettings(true)} style={{ background:'transparent', border:'none', color:'#334155', fontSize:14, cursor:'pointer', padding:'2px 4px' }}>⚙️</button>
            </div>
          </div>
        </div>

        {/* Buscador */}
        <div style={{ padding:'8px 10px 4px', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:10, padding:'7px 12px' }}>
            <span style={{ color:'#334155', fontSize:13 }}>🔍</span>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar contacto..."
              style={{ flex:1, background:'transparent', border:'none', outline:'none', color:'#e2e8f0', fontSize:12, fontFamily:'Outfit,sans-serif' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ background:'transparent', border:'none', color:'#334155', cursor:'pointer', fontSize:13, padding:0 }}>✕</button>
            )}
          </div>
        </div>

        {/* Tabs de filtro */}
        <div style={{ display:'flex', gap:4, padding:'4px 8px 6px', flexShrink:0 }}>
          {[
            { key:'ALL',          label:'Todos',     color:'#60a5fa' },
            { key:'PENDIENTE',    label:'🔴',        color:'#f87171' },
            { key:'VENTAPROCESO', label:'🟡',        color:'#f59e0b' },
            { key:'ATENDIDO',     label:'🟢',        color:'#4ade80' },
            { key:'ARCHIVADO',    label:'⚫',        color:'#94a3b8' },
          ].map(({ key, label, color }) => (
            <button key={key} onClick={() => setFilterEstado(key)}
              style={{
                flex:1, padding:'4px 2px', borderRadius:6, cursor:'pointer',
                fontFamily:'Outfit,sans-serif', fontWeight:700, fontSize:9,
                border: `1px solid ${filterEstado===key ? color : '#1e2d3d'}`,
                background: filterEstado===key ? color+'20' : 'transparent',
                color: filterEstado===key ? color : '#334155',
                transition:'all .15s', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              }}
            >{label}</button>
          ))}
        </div>

        {/* Lista por estado */}
        <div style={{ flex:1, overflowY:'auto', padding:'4px 8px' }}>
          {mergedList.length === 0 && (
            <div style={{ textAlign:'center', paddingTop:60, color:'#1e2d3d', fontSize:12 }}>
              {bridgeOk ? 'Sin chats detectados' : 'Conectando con WhatsApp Web...'}
            </div>
          )}

          {ESTADOS.map(estado => {
            const lista = byEstado[estado]
            if (!lista?.length) return null
            const color = ESTADO_COLORS[estado]
            return (
              <div key={estado} style={{ marginBottom:8 }}>
                <div style={{ fontSize:9, fontWeight:800, color, letterSpacing:'1.5px', padding:'8px 4px 5px', borderBottom:`1px solid ${color}20`, marginBottom:5 }}>
                  {ESTADO_LABELS[estado] || estado} ({lista.length})
                </div>
                {lista.map(chat => {
                  const name    = chat.alias || chat.nombre || chat.name || chat.telefono || ''
                  const isActive = activeChat?.name === chat.name || activeChat?.telefono === chat.telefono
                  return (
                    <div key={chat.id || chat.name} onClick={() => openChat(chat)} style={{
                      padding:'10px 10px', borderRadius:8, cursor:'pointer', marginBottom:3,
                      background: isActive ? '#111c2a' : 'transparent',
                      border:`1px solid ${isActive ? '#1e2d3d' : 'transparent'}`,
                      transition:'all .15s',
                    }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        {/* Avatar */}
                        <div style={{
                          width:36, height:36, borderRadius:'50%', flexShrink:0,
                          background:`${color}20`, border:`2px solid ${color}40`,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:14, fontWeight:700, color,
                        }}>
                          {name[0]?.toUpperCase() || '?'}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'#e2e8f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                            {name}
                          </div>
                          <div style={{ fontSize:11, color:'#334155', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                            {chat.lastMsg || chat.telefono || ''}
                          </div>
                        </div>
                        {chat.unread > 0 && (
                          <div style={{ background:'#f97316', color:'#fff', borderRadius:10, padding:'2px 6px', fontSize:10, fontWeight:700, flexShrink:0 }}>
                            {chat.unread}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── ÁREA DE CHAT ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minWidth:0 }}>
      {/* Chat principal */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        {activeChat ? (
          <>
            {/* Header chat */}
            <div style={{ padding:'10px 14px', borderBottom:'1px solid #162030', display:'flex', alignItems:'center', gap:10, flexShrink:0, flexWrap:'wrap' }}>
              {/* Avatar + nombre */}
              <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
                <div style={{ width:36, height:36, borderRadius:'50%', background:'#f9731620', border:'2px solid #f9731640', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, color:'#f97316', flexShrink:0 }}>
                  {(activeChat.alias || activeChat.nombre || activeChat.name || '?')[0].toUpperCase()}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {activeChat.alias || activeChat.nombre || activeChat.name || activeChat.telefono}
                  </div>
                  <div style={{ fontSize:10, color:'#334155' }}>
                    {activeChat.telefono || activeChat.name}
                  </div>
                </div>
              </div>

              {/* Controles - botones estilo MANDI */}
              <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0, flexWrap:'wrap' }}>
                {[
                  { s:'PENDIENTE',     icon:'🔴', label:'Pendiente',  color:'#f87171' },
                  { s:'VENTAPROCESO',  icon:'🟡', label:'En proceso', color:'#f59e0b' },
                  { s:'ATENDIDO',      icon:'🟢', label:'Atendido',   color:'#4ade80' },
                  { s:'ARCHIVADO',     icon:'⚫', label:'Archivar',   color:'#94a3b8' },
                ].map(({ s, icon, label, color }) => {
                  const isActive = (activeChat.estado || 'PENDIENTE').toUpperCase() === s
                  return (
                    <button key={s} onClick={() => changeEstado(activeChat, s)} title={label}
                      style={{
                        padding:'4px 8px', borderRadius:7, cursor:'pointer',
                        fontFamily:'Outfit,sans-serif', fontWeight: isActive ? 800 : 600,
                        border: `${isActive ? 2 : 1}px solid ${isActive ? color : '#1e2d3d'}`,
                        background: isActive ? color+'22' : 'transparent',
                        color: isActive ? color : '#475569',
                        fontSize:10, transition:'all .15s',
                        boxShadow: isActive ? `0 0 8px ${color}44` : 'none',
                        whiteSpace:'nowrap',
                      }}
                    >{icon} {label}</button>
                  )
                })}

                <button
                  onClick={handleAnalyze}
                  disabled={analyzing || !conversation.length}
                  title="Analizar conversación con Claude"
                  style={{
                    display:'flex', alignItems:'center', gap:4,
                    padding:'5px 10px', borderRadius:7, border:'none',
                    background: analyzing || !conversation.length ? '#1a2535' : 'linear-gradient(135deg,#7c3aed,#6d28d9)',
                    color: analyzing || !conversation.length ? '#334155' : '#fff',
                    fontSize:11, fontWeight:700, cursor: analyzing ? 'default' : 'pointer', whiteSpace:'nowrap',
                  }}
                >
                  {analyzing ? '⏳' : '🤖'} {analyzing ? 'Analizando...' : 'Analizar'}
                </button>
              </div>
            </div>

            {/* Mensajes */}
            <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
              {/* Botón cargar más mensajes */}
              {!loadingConv && conversation.length > 0 && (
                <div style={{ textAlign:'center', marginBottom:12 }}>
                  <button
                    onClick={async () => {
                      setLoadingMore(true)
                      const newLimit = msgLimit + 50
                      setMsgLimit(newLimit)
                      const chatId = activeChat?.chatId || activeChat?.id || activeChat?.telefono || ''
                      const res = await serverCall('/messages?id=' + chatId + '&limit=' + newLimit).catch(() => null)
                      if (res?.ok && res?.messages) setConversation(res.messages)
                      setLoadingMore(false)
                    }}
                    disabled={loadingMore}
                    style={{
                      padding:'5px 16px', borderRadius:20,
                      background:'#111c2a', border:'1px solid #1e2d3d',
                      color:'#475569', fontSize:11, cursor:'pointer',
                    }}
                  >
                    {loadingMore ? '⏳ Cargando...' : '⬆️ Cargar más mensajes'}
                  </button>
                </div>
              )}

              {loadingConv ? (
                <div style={{ textAlign:'center', paddingTop:60, color:'#334155' }}>Abriendo chat...</div>
              ) : conversation.length === 0 ? (
                <div style={{ textAlign:'center', paddingTop:60, color:'#1e2d3d', fontSize:13 }}>
                  La conversación se carga desde WhatsApp Web
                </div>
              ) : (
                conversation.map((msg, i) => {
                  const isOut = msg.direction === 'saliente'
                  return (
                    <div key={i} style={{ display:'flex', justifyContent: isOut ? 'flex-end' : 'flex-start', marginBottom:6 }}>
                      <div style={{
                        maxWidth:'72%', padding: msg.mediaUrl && msg.tipo === 'image' ? '4px' : '8px 12px',
                        fontSize:13, lineHeight:1.5,
                        borderRadius: isOut ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                        background: isOut ? 'linear-gradient(135deg,#f97316,#ea580c)' : '#0d1828',
                        color: isOut ? '#fff' : '#e2e8f0',
                        border: isOut ? 'none' : '1px solid #162030',
                        overflow: 'hidden',
                      }}>
                        {/* Mensaje citado */}
                        {msg.quotedMsg && (
                          <div style={{
                            borderLeft: '3px solid #f9731660',
                            background: '#ffffff08',
                            borderRadius: '0 6px 6px 0',
                            padding: '4px 8px',
                            marginBottom: 6,
                            fontSize: 11,
                          }}>
                            <div style={{ color: '#f97316', fontWeight: 700, fontSize: 10, marginBottom: 2 }}>
                              {msg.quotedMsg.sender}
                            </div>
                            <div style={{ color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {msg.quotedMsg.text || (msg.quotedMsg.tipo === 'image' ? '🖼️ Imagen' : '📎 Media')}
                            </div>
                          </div>
                        )}
                        {/* Imagen o Sticker o GIF */}
                        {msg.mediaUrl && (msg.tipo === 'image' || msg.tipo === 'gif') ? (
                          <div>
                            <img
                              src={msg.mediaUrl}
                              alt={msg.tipo === 'gif' ? 'gif' : 'imagen'}
                              style={{ maxWidth:'100%', maxHeight:260, borderRadius:10, display:'block' }}
                              onError={e => { e.target.style.display='none'; e.target.nextSibling && (e.target.nextSibling.style.display='block') }}
                            />
                            <span style={{ display:'none', padding:'6px 8px' }}>{msg.text}</span>
                            {msg.text && !['🖼️ Imagen','🎞️ GIF','🎭 Sticker'].includes(msg.text) && (
                              <div style={{ padding:'4px 8px 6px', fontSize:13 }}>{msg.text}</div>
                            )}
                          </div>
                        ) : msg.mediaUrl && msg.tipo === 'audio' ? (
                          <div style={{ padding:'4px 8px' }}>
                            <audio controls style={{ maxWidth:220, height:36 }}>
                              <source src={msg.mediaUrl} type={msg.mimetype || 'audio/ogg'} />
                            </audio>
                          </div>
                        ) : msg.mediaUrl && msg.tipo === 'video' ? (
                          <div>
                            <video controls style={{ maxWidth:'100%', maxHeight:200, borderRadius:10 }}>
                              <source src={msg.mediaUrl} type={msg.mimetype || 'video/mp4'} />
                            </video>
                          </div>
                        ) : (
                          <span>{msg.text}</span>
                        )}
                        <div style={{ fontSize:9, color: isOut ? '#ffffff60' : '#334155', marginTop:4, textAlign:'right', padding: msg.mediaUrl ? '0 8px 4px' : 0 }}>
                          {msg.time}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEnd} />
            </div>

            {/* Input de respuesta */}
            <div style={{ padding:'12px 16px', borderTop:'1px solid #162030', flexShrink:0 }}>
              {/* Respuestas rápidas */}
              {showQR && quickReplies.length > 0 && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
                  {quickReplies.map(qr => (
                    <button key={qr.id} onClick={() => { setReplyText(qr.texto); setShowQR(false) }}
                      style={{ padding:'5px 12px', borderRadius:20, background:'#111c2a', border:'1px solid #1e2d3d', color:'#94a3b8', fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                      {qr.imagenUrl && <img src={qr.imagenUrl} alt="" style={{ width:18, height:18, borderRadius:3, objectFit:'cover' }} />}
                      {qr.texto.substring(0, 40)}{qr.texto.length > 40 ? '...' : ''}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
                <button onClick={() => setShowQR(!showQR)} title="Respuestas rápidas"
                  style={{ padding:'10px 12px', borderRadius:8, background: showQR ? '#f97316' : '#111c2a', border:'1px solid #1e2d3d', color: showQR ? '#fff' : '#475569', fontSize:16, cursor:'pointer', flexShrink:0 }}>
                  ⚡
                </button>
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault(); handleSend()
                    }
                    // Enter solo = salto de línea (comportamiento por defecto)
                  }}
                  placeholder="Escribe tu respuesta... (Ctrl+Enter para enviar)"
                  rows={3}
                  style={{
                    flex:1, padding:'10px 14px',
                    background:'#0d1420', border:'1px solid #1e2d3d',
                    borderRadius:10, color:'#f1f5f9', fontSize:13,
                    resize:'none', outline:'none',
                    fontFamily:'Outfit,sans-serif', lineHeight:1.5,
                    minHeight:70, maxHeight:140, overflowY:'auto',
                    scrollbarWidth:'thin',
                    scrollbarColor:'#1e2d3d #0d1420',
                  }}
                />
                <button onClick={handleSend} disabled={!replyText.trim() || sending || !bridgeOk}
                  style={{ padding:'10px 18px', borderRadius:8, border:'none', flexShrink:0, fontSize:13, fontWeight:700, cursor:'pointer', transition:'all .2s',
                    background: replyText.trim() && !sending && bridgeOk ? 'linear-gradient(135deg,#f97316,#ea580c)' : '#111c2a',
                    color: replyText.trim() && !sending && bridgeOk ? '#fff' : '#334155',
                  }}>
                  {sending ? '⏳' : '➤'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#1e2d3d', padding:24, textAlign:'center' }}>
            {bridgeOk ? (
              <>
                <div style={{ fontSize:48, marginBottom:16 }}>💬</div>
                <div style={{ fontSize:15, fontWeight:700, color:'#334155' }}>Selecciona un contacto</div>
                <div style={{ fontSize:12, color:'#1e2d3d', marginTop:6 }}>{mergedList.length} chats disponibles</div>
              </>
            ) : (
              <>
                <div style={{ fontSize:48, marginBottom:16 }}>🖥️</div>
                <div style={{ fontSize:15, fontWeight:700, color:'#f97316', marginBottom:8 }}>Servidor REPUBLIC no detectado</div>
                <div style={{ fontSize:12, color:'#334155', lineHeight:1.7, maxWidth:300, marginBottom:20 }}>
                  Esta línea requiere el servidor corriendo en tu PC.<br/>
                  <strong style={{color:'#e2e8f0'}}>republic-server → INICIAR.bat</strong>
                </div>
                <button
                  onClick={() => { loadedRef.current = false; setBridgeOk(false); }}
                  style={{ padding:'8px 20px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#f97316,#ea580c)', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', marginBottom:10 }}
                >🔄 Reintentar conexión</button>
                <button
                  onClick={() => setShowSettings(true)}
                  style={{ padding:'6px 16px', borderRadius:8, border:'1px solid #1e2d3d', background:'transparent', color:'#475569', fontSize:12, cursor:'pointer' }}
                >⚙️ Cambiar URL del servidor</button>
              </>
            )}
          </div>
        )}
      </div>

      </div>{/* fin chat principal */}

      {/* ── PANEL DERECHO: RESPUESTAS RÁPIDAS ── */}
      {activeChat && (
        <div style={{
          width:240, flexShrink:0,
          borderLeft:'1px solid #162030',
          display:'flex', flexDirection:'column',
          overflow:'hidden', background:'#0a0f1a',
        }}>
          <div style={{ padding:'10px 12px 6px', borderBottom:'1px solid #162030', flexShrink:0 }}>
            <p style={{ fontSize:10, color:'#f97316', fontWeight:700, letterSpacing:'.08em', margin:0 }}>
              ⚡ RESPUESTAS RÁPIDAS
            </p>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'8px 10px', display:'flex', flexDirection:'column', gap:5 }}>
            {quickReplies.map((reply, idx) => (
              <div key={reply.id || idx}
                style={{ background:'rgba(255,255,255,.02)', border:'1px solid #162030', borderRadius:8, overflow:'hidden', cursor:'pointer', transition:'background .1s' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(249,115,22,.06)'}
                onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.02)'}
              >
                {reply.imageUrl && (
                  <img src={reply.imageUrl} style={{ width:'100%', height:50, objectFit:'cover', display:'block' }} alt=""
                    onError={e => e.currentTarget.style.display='none'} />
                )}
                <div style={{ padding:'5px 7px', display:'flex', alignItems:'flex-start', gap:4 }}>
                  <span style={{ flex:1, fontSize:11, color:'#94a3b8', lineHeight:1.35,
                    overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box',
                    WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                    {reply.imageUrl && '🖼 '}{reply.text}
                  </span>
                  <div style={{ display:'flex', gap:2, flexShrink:0 }}>
                    {/* Enviar solo texto */}
                    <button
                      onClick={async () => {
                        setReplyText(reply.text || reply.texto || '')
                      }}
                      title="Copiar al input"
                      style={{ background:'rgba(249,115,22,.12)', border:'1px solid rgba(249,115,22,.2)', color:'#f97316', borderRadius:5, width:20, height:20, cursor:'pointer', fontSize:9, display:'flex', alignItems:'center', justifyContent:'center' }}
                    >✏️</button>
                    {/* Enviar directo */}
                    <button
                      onClick={async () => {
                        const chatId = activeChat?.chatId || activeChat?.id || activeChat?.telefono || ''
                        const SERVER = getServerUrl()
                        const texto = reply.text || reply.texto || ''
                        const imagen = reply.imageUrl || reply.imagenUrl || ''
                        if (imagen) {
                          // Con imagen: enviar imagen con caption (sin texto separado)
                          await fetch(SERVER + '/send/image', {
                            method:'POST', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify({ telefono: chatId, imagenUrl: imagen, caption: texto })
                          }).catch(() => null)
                        } else if (texto) {
                          // Solo texto
                          await fetch(SERVER + '/send/text', {
                            method:'POST', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify({ telefono: chatId, mensaje: texto })
                          }).catch(() => null)
                        }
                        showToast('✅ Respuesta enviada', 'success')
                      }}
                      title="Enviar"
                      style={{ background:'rgba(37,211,102,.12)', border:'1px solid rgba(37,211,102,.2)', color:'#25d366', borderRadius:5, width:20, height:20, cursor:'pointer', fontSize:9, display:'flex', alignItems:'center', justifyContent:'center' }}
                    >➤</button>
                  </div>
                </div>
              </div>
            ))}
            {quickReplies.length === 0 && (
              <div style={{ textAlign:'center', padding:'20px 0', color:'#1e2d3d', fontSize:11 }}>
                Sin respuestas rápidas.<br/>Agrégalas en MANDI.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PANEL ANÁLISIS CLAUDE ── */}
      {analysis && (
        <div style={{ width:290, flexShrink:0, borderLeft:'1px solid #162030', display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #162030', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ fontSize:10, fontWeight:800, color:'#7c3aed', letterSpacing:'1.5px' }}>🤖 ANÁLISIS CLAUDE</div>
            <button onClick={() => setAnalysis(null)} style={{ background:'transparent', border:'none', color:'#334155', fontSize:16, cursor:'pointer' }}>✕</button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:16 }}>
            {[
              { label:'📋 Resumen',        value: analysis.resumen,        color:'#60a5fa', bg:'#1e3a5f20' },
              { label:'❓ ¿Por qué no vendí?', value: analysis.razon_no_venta, color:'#f87171', bg:'#2d0a0a20' },
              { label:'💡 Sugerencias',    value: analysis.sugerencias,    color:'#4ade80', bg:'#052e1620' },
            ].map(({ label, value, color, bg }) => value && (
              <div key={label} style={{ marginBottom:16 }}>
                <div style={{ fontSize:9, fontWeight:800, color, letterSpacing:'1.5px', marginBottom:8 }}>{label}</div>
                <div style={{ background:bg, border:`1px solid ${color}20`, borderRadius:10, padding:12, fontSize:12, lineHeight:1.6, color: color === '#60a5fa' ? '#93c5fd' : color === '#f87171' ? '#fca5a5' : '#86efac' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SETTINGS MODAL ── */}
      {showSettings && (
        <div style={{ position:'fixed', inset:0, background:'#000000c0', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div style={{ background:'#0d1420', border:'1px solid #1e2d3d', borderRadius:16, padding:28, width:380 }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#e2e8f0', marginBottom:4 }}>🔗 REPUBLIC Bridge</div>
            <div style={{ fontSize:12, color:'#475569', marginBottom:16 }}>
              El servidor REPUBLIC debe estar corriendo en tu PC
            </div>

            <div style={{ background:'#111c2a', borderRadius:8, padding:'12px 14px', marginBottom:12, fontSize:12, lineHeight:1.8, color:'#475569' }}>
              <div style={{ color:'#f97316', fontWeight:700, marginBottom:6 }}>📋 Cómo iniciarlo:</div>
              <div>1. Abre CMD en la carpeta <span style={{color:'#e2e8f0', fontFamily:'monospace'}}>republic-server</span></div>
              <div>2. Ejecuta: <span style={{color:'#4ade80', fontFamily:'monospace'}}>node server.js</span></div>
              <div>3. Escanea el QR con WhatsApp Business</div>
              <div>4. Recarga esta página</div>
            </div>

            <a href="http://localhost:3099/status" target="_blank" style={{ display:'block', padding:'10px', borderRadius:8, background:'#0d1420', border:'1px solid #1e2d3d', color:'#60a5fa', fontSize:12, textAlign:'center', textDecoration:'none', marginBottom:8 }}>
              🔍 Verificar estado del servidor
            </a>

            <button
              onClick={() => { setShowSettings(false); fetchChats(); }}
              style={{ width:'100%', padding:'10px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#f97316,#ea580c)', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}
            >
              Reconectar
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
