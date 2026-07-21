'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { fetchRows, fetchLista, fetchHilo, buscarEnMensajes, fetchContacts, sendReply, updateContact, updateTemperatura, isDemo, sendInteractiveButtons, toggleIAMode, sendVideo, sendImageFile } from '@/lib/api-client'
import { buildConvs, fmtDate, parseDate } from '@/lib/utils'
import { Spinner, Avatar, ContactRow, MessageBubble, Toast } from '@/components/Components'
import RightPanel from '@/components/RightPanel'
import SetupModal from '@/components/SetupModal'
import GuideModal from '@/components/GuideModal'
import RepublicInbox from '@/components/RepublicInbox'
import SocialInbox from '@/components/SocialInbox'
import Contactos, { PlantillaModal } from '@/components/Contactos'
import Automatizaciones from '@/components/Automatizaciones'
import { actualizarNoLeidos, pedirPermisoNotif, notificar } from '@/lib/notif'

// ── Dos ejes de estado ────────────────────────────────────────────
// Eje 1 (bandeja): pendiente / atendido / soporte / archivado — casi todo automático.
// Eje 2 (temperatura del lead): caliente / tibio / frio — 100% MANUAL, nada la cambia sola.
const TEMPERATURAS = [
  { key:'caliente', icon:'🔥', label:'Caliente', color:'#f97316' },
  { key:'tibio',    icon:'🌤️', label:'Tibio',    color:'#fbbf24' },
  { key:'frio',     icon:'❄️', label:'Frío',     color:'#38bdf8' },
]
const TEMP_META = Object.fromEntries(TEMPERATURAS.map(t => [t.key, t]))

// La ventana de 24h de Meta arranca en el ÚLTIMO mensaje del cliente. A partir de ahí,
// un lead 🔥 caliente que se acerca a las 24h de silencio se resalta con ⏰ (hay que
// cerrarlo antes de que Meta bloquee el mensaje gratis). Umbral por defecto: 20h.
const VENTANA_MS = 24 * 60 * 60 * 1000
const ALERTA_CALIENTE_MS = 20 * 60 * 60 * 1000

// Al RESPONDER, la bandeja pasa a 'atendido' salvo que sea un carril deliberado (soporte).
// La TEMPERATURA (Eje 2) nunca se toca al responder: es otro campo.
const estadoAlResponder = (actual) => (actual === 'soporte' ? 'soporte' : 'atendido')

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

// ── EMOJI PICKER ──────────────────────────────────────────────────
const EMOJI_CATS = [
  { label:'😊', title:'Expresiones', emojis:['😊','😄','😂','🤣','😍','🥰','😘','😎','🤩','😜','😅','😭','😢','😡','🤔','🙏','👍','👎','❤️','🔥','💯','✅','⭐','🎉','🎊','💪','👏','🙌','💰','💸','🤝','😏','🫶','😋','🤑'] },
  { label:'👕', title:'Ropa', emojis:['👕','👔','🧥','🧣','🧤','👗','👖','👟','👠','👜','🛍️','📦','🚚','💳','🏷️','📸','✂️','🎨','🖼️','📐','🧵','🪡','👒','🎒','💎','🪄','🎭','🎪'] },
  { label:'✍️', title:'Negocio', emojis:['✍️','📝','📋','📌','📍','🔍','🔎','💡','⚡','🌟','💫','✨','🎯','📊','📈','📉','🗓️','⏰','🔔','📣','📲','💬','🗣️','📞','📧','🤖','🏆','🥇','💼','🔐'] },
  { label:'🌎', title:'Lugares', emojis:['🌎','🇪🇨','🏠','🏪','📍','🗺️','✈️','🚗','🛵','🚴','🌤️','☀️','🌙','🌈','🌊','🌺','🌸','🍀','🎋','🏔️','🌴','🏖️','🌆','🏡','🛒'] },
]

function EmojiPicker({ onSelect, onClose }) {
  const [cat,    setCat]    = useState(0)
  const [search, setSearch] = useState('')
  const allEmojis = EMOJI_CATS.flatMap(c => c.emojis)
  const displayed = search.trim() ? allEmojis.filter(e => e.includes(search)) : EMOJI_CATS[cat].emojis
  return (
    <div style={{ position:'absolute', bottom:'100%', left:0, right:0, marginBottom:8, background:'#0d1828', border:'1px solid rgba(245,158,11,.25)', borderRadius:14, zIndex:60, overflow:'hidden', boxShadow:'0 8px 32px rgba(0,0,0,.6)' }}>
      {/* Búsqueda */}
      <div style={{ padding:'8px 10px 6px', borderBottom:'1px solid #111c2a', display:'flex', gap:6, alignItems:'center' }}>
        <span style={{ fontSize:13, color:'#475569' }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar emoji..."
          autoFocus
          style={{ flex:1, background:'transparent', border:'none', outline:'none', color:'#e2e8f0', fontSize:12, fontFamily:'Outfit,sans-serif' }} />
        <button onClick={onClose} style={{ background:'transparent', border:'none', color:'#475569', cursor:'pointer', fontSize:15, padding:0, lineHeight:1 }}>✕</button>
      </div>
      {/* Tabs */}
      {!search.trim() && (
        <div style={{ display:'flex', borderBottom:'1px solid #111c2a' }}>
          {EMOJI_CATS.map((c,i) => (
            <button key={i} onClick={() => setCat(i)} title={c.title}
              style={{ flex:1, padding:'7px 0', background: cat===i ? 'rgba(245,158,11,.1)' : 'transparent', border:'none', borderBottom: cat===i ? '2px solid #f59e0b' : '2px solid transparent', cursor:'pointer', fontSize:18, transition:'all .15s' }}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {/* Grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gap:1, padding:'8px', maxHeight:190, overflowY:'auto' }}>
        {displayed.map((emoji, i) => (
          <button key={i} onClick={() => onSelect(emoji)}
            style={{ background:'transparent', border:'none', borderRadius:7, cursor:'pointer', fontSize:22, padding:'5px 2px', lineHeight:1, transition:'background .1s' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.08)'}
            onMouseLeave={e => e.currentTarget.style.background='transparent'}
          >{emoji}</button>
        ))}
        {displayed.length === 0 && (
          <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'20px 0', color:'#334155', fontSize:12 }}>Sin resultados</div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  // ── Selector de línea: MANDI (API) | REPUBLIC (WA Web) ──────
  const [linea, setLinea] = useState('MANDI') // 'MANDI' | 'REPUBLIC'

  const [convs,        setConvs]        = useState([])
  const [contacts,     setContacts]     = useState({}) // telefono → {alias, estado}
  const [active,       setActive]       = useState(null)
  const [input,        setInput]        = useState('')
  const [sending,      setSending]      = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [lastSync,     setLastSync]     = useState(null)
  const [search,       setSearch]       = useState('')
  const [showSetup,    setShowSetup]    = useState(false)
  const [showGuide,    setShowGuide]    = useState(false)
  const [toast,        setToast]        = useState(null)
  const [showSidebar,  setShowSidebar]  = useState(true)
  const [showRight,    setShowRight]    = useState(false)
  const [showTplModal, setShowTplModal] = useState(false) // plantilla desde el chat (fuera de 24h)
  const [tplToast,     setTplToast]     = useState(null)
  const [imgFiles,     setImgFiles]     = useState([]) // array de { file, preview }
  const [imgUploading, setImgUploading] = useState(false)
  const [imgProgress,  setImgProgress]  = useState(0)
  const [imgResult,    setImgResult]    = useState(null)
  const [isVideo,      setIsVideo]      = useState(false)
  const [filter,       setFilter]       = useState('pendiente')
  const [searchMode,   setSearchMode]   = useState('contacto') // 'contacto' | 'mensaje'
  const [msgHits,      setMsgHits]      = useState(null)        // búsqueda por mensaje (server-side): mensajes que casan en TODO el historial
  // Ancho del panel derecho (notas / respuestas rápidas), redimensionable con el mouse
  const [rightWidth,   setRightWidth]   = useState(340)
  const rightWidthRef  = useRef(340)
  const resizingRef    = useRef(false)

  // ── Estado botones interactivos ───────────────────────────────
  const [showBtnPanel, setShowBtnPanel] = useState(false)
  const [btnTexts,     setBtnTexts]     = useState(['', '', ''])
  const [sendingBtns,  setSendingBtns]  = useState(false)
  const [showEmoji,    setShowEmoji]    = useState(false)

  // ── Estado toggle IA ──────────────────────────────────────────
  const [togglingIA,   setTogglingIA]   = useState(false)
  const localIARef = useRef({})

  const endRef     = useRef(null)
  const pollRef    = useRef(null)
  const fileRef    = useRef(null)
  const msgsRef    = useRef(null)
  const autoScroll = useRef(true)
  const prevMsgLen = useRef(0)

  const [refreshKey, setRefreshKey] = useState(0)
  const localStatusRef = useRef({}) // { telefono: { estado, expiresAt } }
  const localTempRef   = useRef({}) // { telefono: { temperatura, expiresAt } } — override optimista Eje 2
  const alertadosRef   = useRef(new Set()) // claves `${tel}:${ultimoEntranteAt}` ya avisadas (1 alerta/ventana)

  // Mensajes optimistas pendientes (por teléfono) hasta que Make los registre en la hoja
  const pendingRef = useRef({})
  const hilosRef   = useRef({})   // telefono → historial completo ya descargado (carga por chat)
  const activeRef  = useRef(null) // teléfono del chat abierto (para no borrar su hilo del cache)
  const backGuardRef = useRef(false) // móvil: entrada de historial empujada al abrir un chat (el "atrás" del celu vuelve a la lista en vez de salir de la app)

  // ── Cargar datos ──────────────────────────────────────────────
  const load = useCallback(async () => {
    const [lista, rows, ctList] = await Promise.all([fetchLista(), fetchRows(), fetchContacts()])
    // Combinamos 3 fuentes (buildConvs deduplica por id de mensaje):
    //  · lista → ÚLTIMO msg de CADA conversación sobre TODO el historial → aparecen
    //            también los chats viejos que la ventana de 3000 ocultaba (el bug de
    //            "no aparece el cliente / se borraron los mensajes").
    //  · rows  → ventana reciente: mantiene el hilo abierto al día y da los no leídos.
    //  · hilos → historiales completos ya descargados al abrir cada chat.
    // null = ERROR (no "vacío"): conservamos lo previo para no parpadear a blanco.
    if (Array.isArray(lista) || Array.isArray(rows)) {
      const hilos = Object.values(hilosRef.current).flat()
      const convsData = buildConvs([...(lista || []), ...(rows || []), ...hilos])
      // Conservar los mensajes optimistas que Make aún no registró en la hoja, para
      // que no "desaparezcan" entre el envío y el logueo (sensación de "no se envió").
      const pend = pendingRef.current
      Object.keys(pend).forEach(tel => {
        const conv = convsData.find(c => c.telefono === tel)
        const enHoja = (p) => (conv?.msgs || []).some(
          m => m.direccion === 'SALIENTE' && String(m.mensaje).trim() === String(p.mensaje).trim()
        )
        pend[tel] = pend[tel].filter(p => {
          const ts = Number(String(p.id).replace('tmp_', '')) || 0
          return !enHoja(p) && (Date.now() - ts < 90000) // dropear cuando se confirma o tras 90s
        })
        if (!pend[tel].length) { delete pend[tel]; return }
        if (conv) {
          conv.msgs = [...conv.msgs, ...pend[tel]]
          conv.last = pend[tel][pend[tel].length - 1]
        } else {
          convsData.unshift({ telefono: tel, nombre: pend[tel][0].nombre, msgs: [...pend[tel]], last: pend[tel][pend[tel].length - 1], unread: 0 })
        }
      })
      setConvs(convsData)
    }
    if (Array.isArray(ctList) && ctList.length > 0) {
      const ctMap = {}
      ctList.forEach(c => { ctMap[c.telefono] = c })
      // Respetar cambios locales recientes (evitar que el polling los pise)
      const now = Date.now()
      Object.entries(localStatusRef.current).forEach(([tel, override]) => {
        if (override.expiresAt > now && ctMap[tel]) {
          ctMap[tel] = { ...ctMap[tel], estado: override.estado }
        }
      })
      // Igual para la temperatura (Eje 2): que el poll no pise un cambio recién hecho.
      Object.entries(localTempRef.current).forEach(([tel, override]) => {
        if (override.expiresAt > now && ctMap[tel]) {
          ctMap[tel] = { ...ctMap[tel], temperatura: override.temperatura }
        }
      })
      setContacts(ctMap)
    }
    setLastSync(new Date())
    setLoading(false)
  }, [])

  const manualRefresh = async () => {
    setRefreshKey(k => k + 1)
    await load()
  }

  useEffect(() => {
    // Polling inteligente: solo mientras la pestaña esté VISIBLE. Una pestaña en
    // segundo plano dejaba de leer datos útiles pero seguía golpeando la cuota de
    // Sheets cada 8s. Al volver a la pestaña, refrescamos al instante.
    const start = () => {
      if (pollRef.current) return
      pollRef.current = setInterval(load, 8000)
    }
    const stop = () => { clearInterval(pollRef.current); pollRef.current = null }
    const onVisibility = () => {
      if (document.hidden) stop()
      else { load(); start() }
    }
    load()
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [load])

  // ── Scroll inteligente ────────────────────────────────────────
  useEffect(() => {
    const activeConv = convs.find(c => c.telefono === active)
    if (!activeConv) return
    const newLen = activeConv.msgs.length
    const hadNewMsg = newLen > prevMsgLen.current
    prevMsgLen.current = newLen
    if (autoScroll.current || hadNewMsg) {
      endRef.current?.scrollIntoView({ behavior: hadNewMsg ? 'smooth' : 'instant' })
    }
  }, [active, convs])

  const handleMsgsScroll = () => {
    const el = msgsRef.current
    if (!el) return
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  // ── Panel derecho redimensionable ─────────────────────────────
  useEffect(() => { rightWidthRef.current = rightWidth }, [rightWidth])
  useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem('mandi_right_width') || '', 10)
      if (v >= 280 && v <= 680) setRightWidth(v)
    } catch {}
    const clamp = (w) => Math.min(680, Math.max(280, w))
    const onMove = (e) => {
      if (!resizingRef.current) return
      const x = e.touches ? e.touches[0].clientX : e.clientX
      setRightWidth(clamp(window.innerWidth - x)) // panel pegado al borde derecho
    }
    const onUp = () => {
      if (!resizingRef.current) return
      resizingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try { localStorage.setItem('mandi_right_width', String(rightWidthRef.current)) } catch {}
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [])

  const startResize = (e) => {
    resizingRef.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  // ── Aviso de mensajes nuevos (pestaña del navegador + ícono) ──
  // No usa el contador "unread" (que estaba siempre en 0).
  // En su lugar cuenta los mensajes ENTRANTES y avisa de los que
  // llegan mientras NO estás mirando la app.
  const vistosRef         = useRef(null)
  const totalEntrantesRef = useRef(0)

  useEffect(() => {
    const total = convs.reduce(
      (s, c) => s + (c.msgs?.filter(m => m.direccion === 'ENTRANTE').length || 0), 0
    )
    totalEntrantesRef.current = total
    if (vistosRef.current === null) vistosRef.current = total // primera carga: todo visto
    if (document.visibilityState === 'visible') {
      vistosRef.current = total
      actualizarNoLeidos(0)
    } else {
      actualizarNoLeidos(Math.max(0, total - vistosRef.current))
    }
  }, [convs])

  useEffect(() => {
    const alVolver = () => {
      vistosRef.current = totalEntrantesRef.current
      actualizarNoLeidos(0)
    }
    const onVis = () => { if (document.visibilityState === 'visible') alVolver() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', alVolver)
    }
  }, [])

  // Historial completo del chat, bajo demanda. La lista lateral solo trae el último
  // mensaje de cada conversación; sin esto un chat viejo se vería con una sola burbuja
  // (el síntoma de "se borraron los mensajes"). Cachea los últimos 5 hilos y se
  // re-inyectan en cada poll (load) para que no se pierdan entre refrescos.
  const cargarHilo = useCallback(async (telefono) => {
    if (!telefono) return
    const msgs = await fetchHilo(telefono)
    if (!Array.isArray(msgs) || !msgs.length) return
    hilosRef.current[telefono] = msgs
    const abiertos = Object.keys(hilosRef.current)
    if (abiertos.length > 5) {
      abiertos.slice(0, abiertos.length - 5)
        .filter(t => t !== activeRef.current)
        .forEach(t => { delete hilosRef.current[t] })
    }
    setConvs(prev => prev.map(c => {
      if (c.telefono !== telefono) return c
      const merged = buildConvs([...c.msgs, ...msgs])[0]
      return merged ? { ...c, msgs: merged.msgs, last: merged.last } : c
    }))
  }, [])

  const openConv = (telefono) => {
    setActive(telefono)
    activeRef.current = telefono
    setShowSidebar(false)
    // En móvil, empujamos una entrada de historial: así el botón "atrás" del celular
    // vuelve a la lista de chats en vez de salir de la app. Una sola entrada mientras
    // estemos navegando chats (backGuardRef evita duplicar al saltar de chat en chat).
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches && !backGuardRef.current) {
      window.history.pushState({ inbox: 'chat' }, '')
      backGuardRef.current = true
    }
    autoScroll.current = true
    prevMsgLen.current = 0
    setConvs(prev => prev.map(c => c.telefono === telefono ? { ...c, unread: 0 } : c))
    cargarHilo(telefono)
  }

  // Desde la pestaña CONTACTOS: salta a la conversación en MANDI. El teléfono del
  // directorio puede venir en otro formato → matcheamos por últimos 9 dígitos.
  const abrirChatDesdeContactos = (telefono) => {
    const t9 = String(telefono).replace(/\D/g, '').slice(-9)
    const conv = convs.find(c => String(c.telefono).replace(/\D/g, '').slice(-9) === t9)
    setLinea('MANDI')
    openConv(conv ? conv.telefono : telefono)
  }

  // ── Alerta de leads 🔥 calientes cerca del cierre de la ventana de 24h ──
  // Pide permiso una vez y dispara una notificación del navegador por lead y por ventana.
  useEffect(() => { pedirPermisoNotif() }, [])
  useEffect(() => {
    const now = Date.now()
    Object.entries(contacts).forEach(([tel, c]) => {
      if ((c?.temperatura || '') !== 'caliente') return
      const ent = c?.ultimoEntranteAt ? new Date(c.ultimoEntranteAt).getTime() : 0
      if (!ent) return
      const ms = now - ent
      if (ms < ALERTA_CALIENTE_MS || ms >= VENTANA_MS) return
      const key = `${tel}:${ent}` // 1 alerta por ventana (mismo entrante = misma ventana)
      if (alertadosRef.current.has(key)) return
      alertadosRef.current.add(key)
      const nombre = c.alias || (convs.find(x => x.telefono === tel)?.nombre) || tel
      const horas  = Math.max(0, Math.ceil((VENTANA_MS - ms) / 3600000))
      notificar('🔥 Lead caliente por enfriarse', `${nombre}: se cierra la ventana de 24h en ~${horas}h. Escríbele ya.`, `caliente-${key}`)
    })
  }, [contacts, convs])

  // ── Derived state ─────────────────────────────────────────────
  const activeConv  = convs.find(c => c.telefono === active) || null
  const totalUnread = convs.reduce((s, c) => s + c.unread, 0)
  // Botón "atrás" del celular: si abrimos un chat empujamos una entrada de historial
  // (en openConv), y acá la consumimos para VOLVER A LA LISTA en vez de salir de la app.
  // Solo actúa si nosotros empujamos la entrada (backGuardRef), así en desktop el back
  // sigue navegando normal.
  useEffect(() => {
    const onPop = () => {
      if (backGuardRef.current) {
        backGuardRef.current = false
        setShowSidebar(true)   // muestra la lista de chats (no sale de la app)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Búsqueda por mensaje: server-side sobre TODO el historial (antes solo miraba lo
  // cargado en el navegador). Debounce 350ms; en modo 'contacto' o con <2 chars se limpia.
  useEffect(() => {
    const term = search.trim()
    if (searchMode !== 'mensaje' || term.length < 2) { setMsgHits(null); return }
    let vivo = true
    const t = setTimeout(async () => {
      const hits = await buscarEnMensajes(term)
      if (vivo) setMsgHits(Array.isArray(hits) ? hits : [])
    }, 350)
    return () => { vivo = false; clearTimeout(t) }
  }, [search, searchMode])

  const demo        = isDemo()

  // "Venta" = tiene un PEDIDO CREADO (idVenta en col H, lo setea CREAR PEDIDO).
  const hasVenta  = (tel) => String(contacts[tel]?.idVenta || '').trim() !== ''
  // El estado de flujo (pendiente/atendido/…) es INDEPENDIENTE de tener venta.
  // Así un cliente con venta que vuelve a escribir aparece en PENDIENTE (para atenderlo)
  // y a la vez sigue en la pestaña 💰 Ventas (que filtra por idVenta, ver abajo).
  const getStatus = (tel) => contacts[tel]?.estado || 'pendiente'
  // Eje 2: temperatura del lead ('' = sin clasificar).
  const getTemp = (tel) => contacts[tel]?.temperatura || ''

  // Ventana de 24h: ms transcurridos desde el último mensaje del cliente.
  const silencioMs = (tel) => {
    const t = contacts[tel]?.ultimoEntranteAt
    return t ? (Date.now() - new Date(t).getTime()) : Infinity
  }
  // 🔥 caliente que se acerca al cierre de la ventana (entre el umbral y las 24h) → ⏰.
  const alertaVentana = (tel) => {
    if (getTemp(tel) !== 'caliente') return false
    const ms = silencioMs(tel)
    return ms >= ALERTA_CALIENTE_MS && ms < VENTANA_MS
  }
  // Horas que faltan para cerrar la ventana de 24h (para el texto del aviso).
  const horasParaCierre = (tel) => Math.max(0, Math.ceil((VENTANA_MS - silencioMs(tel)) / 3600000))

  // Búsqueda tolerante de teléfono: ignora espacios/guiones y el prefijo de país.
  // Ecuador: 0987498489 (local) == 593987498489 (internacional) == +593 98 749 8489.
  const soloDigitos = (s) => String(s || '').replace(/\D/g, '')
  const telLocal    = (s) => soloDigitos(s).replace(/^593/, '').replace(/^0+/, '') // núcleo sin país ni 0
  const phoneMatch  = (telefono, query) => {
    const p = soloDigitos(telefono), q = soloDigitos(query)
    if (!q) return false
    if (p.includes(q)) return true                       // coincidencia directa / parcial
    const pl = telLocal(p), ql = telLocal(q)
    return ql.length >= 7 && pl.endsWith(ql)              // mismo número con/ sin país o 0
  }

  const q = search.trim().toLowerCase()
  const isSearching = q.length > 0
  const searchingMsgs = isSearching && searchMode === 'mensaje'

  const tel9 = (t) => String(t || '').replace(/\D/g, '').slice(-9)
  // Índice de la búsqueda por mensaje (server-side, TODO el historial): últimos 9
  // dígitos → mensaje que casa (el primero = más reciente, buscarEnMensajes viene desc).
  const msgHitMap = {}
  ;(msgHits || []).forEach(m => {
    const k = tel9(m.telefono)
    if (k && !msgHitMap[k]) msgHitMap[k] = m
  })

  // Fragmento del mensaje que casa (modo Mensajes). Usa primero el hit del servidor
  // (todo el historial) y cae al mensaje ya cargado si hiciera falta.
  const matchSnippet = (c) => {
    const hit = msgHitMap[tel9(c.telefono)]
    const m = hit || [...(c.msgs || [])].reverse().find(m => (m.mensaje || '').toLowerCase().includes(q))
    if (!m) return ''
    const t = String(m.mensaje || '')
    const i = t.toLowerCase().indexOf(q)
    if (i < 0) return t.slice(0, 70) + (t.length > 70 ? '…' : '')
    const start = Math.max(0, i - 28)
    const end   = i + q.length + 42
    return (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '')
  }

  const searched = !isSearching ? convs
    : searchingMsgs
      ? convs.filter(c => msgHitMap[tel9(c.telefono)])   // matches sobre TODO el historial (server-side)
      : convs.filter(c => {
          const alias = (contacts[c.telefono]?.alias || '').toLowerCase()
          return c.nombre.toLowerCase().includes(q) ||
                 alias.includes(q) ||
                 phoneMatch(c.telefono, search)
        })
  // Pestaña "Ventas" = tiene un PEDIDO CREADO (idVenta) y NO está archivado. La venta
  // ya NO es un estado de bandeja: se maneja aparte con el pedido. Un contacto con venta
  // puede a la vez estar en 🔴 Pendiente (si te escribió) y en 💰 Ventas.
  const esVentaActiva = (tel) => hasVenta(tel) && getStatus(tel) !== 'archivado'
  // Filtros: bandeja (estado), temperatura (Eje 2), o venta (idVenta). Un solo filtro
  // activo a la vez. Al BUSCAR mostramos TODOS los resultados sin importar el filtro.
  const esTemp = (key) => TEMP_META[key] !== undefined
  const filtered = isSearching
    ? searched
    : searched.filter(c =>
        filter === 'venta' ? esVentaActiva(c.telefono)
        : esTemp(filter)   ? getTemp(c.telefono) === filter
        :                    getStatus(c.telefono) === filter
      )
  const counts = {
    pendiente:  searched.filter(c => getStatus(c.telefono) === 'pendiente').length,
    atendido:   searched.filter(c => getStatus(c.telefono) === 'atendido').length,
    soporte:    searched.filter(c => getStatus(c.telefono) === 'soporte').length,
    archivado:  searched.filter(c => getStatus(c.telefono) === 'archivado').length,
    venta:      searched.filter(c => esVentaActiva(c.telefono)).length,
    // Temperaturas (Eje 2)
    caliente:   searched.filter(c => getTemp(c.telefono) === 'caliente').length,
    tibio:      searched.filter(c => getTemp(c.telefono) === 'tibio').length,
    frio:       searched.filter(c => getTemp(c.telefono) === 'frio').length,
    // Calientes que se acercan a las 24h → para el aviso ⏰.
    alerta:     searched.filter(c => alertaVentana(c.telefono)).length,
  }

  const lastMsg      = activeConv?.last
  const lastIncoming = activeConv ? [...activeConv.msgs].reverse().find(m => m.direccion === 'ENTRANTE') : null
  const windowOpen = lastIncoming
    ? (Date.now() - parseDate(lastIncoming.timestamp).getTime()) < 24 * 60 * 60 * 1000
    : false

  // ── Cambiar estado de BANDEJA (Eje 1) ─────────────────────────
  const changeStatus = async (telefono, status) => {
    // Clic en la misma bandeja = sin efecto (también evita el doble-clic sin bloquear
    // un clic legítimo a OTRA bandeja, que antes se tragaba un guard de 3s).
    const estadoActual = contacts[telefono]?.estado || 'pendiente'
    if (estadoActual === status) return

    // Override local para que el polling (8s) no pise el cambio mientras se guarda.
    localStatusRef.current[telefono] = { estado: status, expiresAt: Date.now() + 15000 }
    // Optimista: se ve al instante.
    setContacts(prev => ({ ...prev, [telefono]: { ...(prev[telefono] || {}), estado: status } }))

    const conv = convs.find(c => c.telefono === telefono)
    const res = await updateContact(telefono, conv?.nombre || '', status, contacts[telefono]?.alias || '', true)
    // Si el guardado falló: avisar y revertir (no dejar un estado fantasma que el poll
    // deshace solo en silencio a los 15s).
    if (res && res.ok === false) {
      delete localStatusRef.current[telefono]
      setContacts(prev => ({ ...prev, [telefono]: { ...(prev[telefono] || {}), estado: estadoActual } }))
      setToast({ ok: false, msg: '✗ No se pudo cambiar el estado — reintenta' })
      setTimeout(() => setToast(null), 4000)
    }
  }

  // ── Cambiar TEMPERATURA del lead (Eje 2) — 100% manual ────────
  // Clic en la temperatura activa la QUITA (toggle). Nada más la toca.
  const changeTemperatura = async (telefono, temp) => {
    const actual = contacts[telefono]?.temperatura || ''
    const nueva  = actual === temp ? '' : temp
    localTempRef.current[telefono] = { temperatura: nueva, expiresAt: Date.now() + 15000 }
    setContacts(prev => ({ ...prev, [telefono]: { ...(prev[telefono] || {}), temperatura: nueva } }))
    const res = await updateTemperatura(telefono, nueva)
    if (res && res.ok === false) {
      delete localTempRef.current[telefono]
      setContacts(prev => ({ ...prev, [telefono]: { ...(prev[telefono] || {}), temperatura: actual } }))
      setToast({ ok: false, msg: '✗ No se pudo cambiar la temperatura — reintenta' })
      setTimeout(() => setToast(null), 4000)
    }
  }

  // ── Actualizar alias/contacto ─────────────────────────────────
  const handleUpdateContact = async ({ alias }) => {
    if (!activeConv) return
    const tel = activeConv.telefono
    const currentStatus = contacts[tel]?.estado || 'pendiente'
    setContacts(prev => ({ ...prev, [tel]: { ...(prev[tel] || {}), alias } }))
    await updateContact(tel, activeConv.nombre, currentStatus, alias)
  }

  // ── Enviar texto ──────────────────────────────────────────────
  const handleSend = async (text) => {
    const t = (text || input).trim()
    if (!t || !activeConv || sending) return
    setInput(''); setSending(true); setToast(null); autoScroll.current = true
    const tmpMsg = {
      id: 'tmp_' + Date.now(), telefono: activeConv.telefono,
      nombre: activeConv.nombre, mensaje: t,
      direccion: 'SALIENTE', timestamp: new Date().toISOString(), estado: 'enviado',
    }
    setConvs(prev => prev.map(c =>
      c.telefono === activeConv.telefono ? { ...c, msgs: [...c.msgs, tmpMsg], last: tmpMsg } : c
    ))
    // Registrar como pendiente para que sobreviva a los polls hasta que Make lo registre
    pendingRef.current[activeConv.telefono] = [...(pendingRef.current[activeConv.telefono] || []), tmpMsg]
    // Dar tiempo a React para renderizar el tmpMsg antes de hacer el fetch
    await new Promise(r => setTimeout(r, 0))
    const [result] = await Promise.all([
      sendReply(activeConv.telefono, activeConv.nombre, t),
      changeStatus(activeConv.telefono, estadoAlResponder(currentStatus)),
    ])
    setSending(false); setToast(result)
    setTimeout(() => setToast(null), 4000)
    setTimeout(load, 4000)
  }

  // Desde RightPanel: enviar texto o copiar al input
  const handleSendText = async (text, copyToInput) => {
    if (copyToInput !== undefined) { setInput(copyToInput); return }
    await handleSend(text)
  }

  const handleKey = (e) => {
    // Ctrl+Enter o Cmd+Enter = enviar | Enter solo = salto de línea
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Enviar imagen ─────────────────────────────────────────────
  const sendImageUrl = async (imageUrl) => {
    const res = await fetch('/api/saliente', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Telefono: activeConv.telefono, Nombre: activeConv.nombre, ImagenURL: imageUrl }),
    })
    return res.ok
  }

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setImgResult(null)
    const isVid = files[0].type.startsWith('video/')
    setIsVideo(isVid)
    if (isVid) {
      setImgFiles([{ file: files[0], preview: URL.createObjectURL(files[0]) }])
    } else {
      const processed = await Promise.all(files.slice(0, 10).map(async f => ({
        file: await toJpeg(f),
        preview: await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(f) })
      })))
      setImgFiles(processed)
    }
  }

  const handleSendImage = async () => {
    if (!imgFiles.length || !activeConv) return
    setImgUploading(true); setImgResult(null); setImgProgress(0)
    try {
      let allOk = true
      let sendErr = ''
      if (isVideo) {
        const result = await sendVideo(activeConv.telefono, activeConv.nombre, imgFiles[0].file)
        allOk = result.ok
        if (!result.ok) sendErr = result.error || ''
      } else {
        for (let i = 0; i < imgFiles.length; i++) {
          // URL permanente para pintar el hilo. La guardamos en NUESTRO Supabase
          // Storage (vía /api/upload-foto), no en imgbb: imgbb respondía lento/5xx a
          // los fetch server-side y las fotos que se enviaban por link terminaban en
          // `failed`. Si falla, NO cancelamos: el envío real va por media id igual.
          let url = ''
          try {
            const fd = new FormData(); fd.append('file', imgFiles[i].file)
            const res  = await fetch('/api/upload-foto', { method:'POST', body:fd })
            const data = await res.json()
            if (res.ok && data.url) url = data.url
          } catch { /* seguimos por media id */ }

          const { ok } = await sendImageFile(activeConv.telefono, activeConv.nombre, imgFiles[i].file, url)
          if (!ok) allOk = false
          setImgProgress(i + 1)
          if (i < imgFiles.length - 1) await new Promise(r => setTimeout(r, 800))
        }
      }
      setImgResult({ ok: allOk, error: sendErr })
      await changeStatus(activeConv.telefono, estadoAlResponder(currentStatus))
      setTimeout(() => { setImgFiles([]); setImgResult(null); setIsVideo(false); setImgProgress(0); if (fileRef.current) fileRef.current.value = '' }, 1500)
      setTimeout(load, 4000)
    } catch { setImgResult({ ok: false }) }
    finally  { setImgUploading(false) }
  }

  const cancelImage = () => {
    imgFiles.forEach(f => { if (isVideo) URL.revokeObjectURL(f.preview) })
    setImgFiles([]); setImgResult(null); setIsVideo(false); setImgProgress(0)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Quick reply con imagen ────────────────────────────────────
  const handleQuickReply = async (reply) => {
    if (!activeConv) return
    const botones = (reply.botones || []).filter(Boolean).slice(0, 3)
    if (botones.length && reply.text) {
      // Respuesta rápida CON botones interactivos → mensaje + botones
      const validBtns = botones.map((t, i) => ({ id: `btn_${i + 1}`, title: t }))
      // El servidor guarda SOLO el cuerpo en `mensaje`; los botones van aparte en `botones`.
      // Así el texto optimista coincide con el guardado y la reconciliación descarta el
      // temporal (sin duplicar), mientras la burbuja pinta los botones desde `botones`.
      const tmpMsg = { id: 'tmp_' + Date.now(), telefono: activeConv.telefono, nombre: activeConv.nombre, mensaje: reply.text, botones: validBtns, direccion: 'SALIENTE', timestamp: new Date().toISOString(), estado: 'enviado' }
      setConvs(prev => prev.map(c => c.telefono === activeConv.telefono ? { ...c, msgs: [...c.msgs, tmpMsg], last: tmpMsg } : c))
      pendingRef.current[activeConv.telefono] = [ ...(pendingRef.current[activeConv.telefono] || []), tmpMsg ]
      changeStatus(activeConv.telefono, estadoAlResponder(currentStatus))
      await sendInteractiveButtons(activeConv.telefono, activeConv.nombre, reply.text, validBtns)
      setTimeout(load, 4000)
    } else if (reply.text) {
      await handleSend(reply.text)
    }
    // Envía hasta 10 imágenes de la respuesta rápida, en orden, con pausa entre cada una
    const imgs = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? reply.imageUrl : reply[`imageUrl${i + 1}`]
    ).filter(Boolean)
    for (let i = 0; i < imgs.length; i++) {
      await sendImageUrl(imgs[i])
      if (i < imgs.length - 1) await new Promise(r => setTimeout(r, 800))
    }
  }

  // ── Enviar imagen IA (Shopify) por WhatsApp ──────────────────
  const handleSendAIImage = async (imageUrl) => {
    if (!activeConv || !imageUrl) return
    const res = await fetch('/api/saliente', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Telefono: activeConv.telefono, Nombre: activeConv.nombre, ImagenURL: imageUrl }),
    })
    if (res.ok) await changeStatus(activeConv.telefono, estadoAlResponder(currentStatus))
  }

  // ── Toggle modo IA ────────────────────────────────────────────
  const getModoIA = (tel) => {
    const now = Date.now()
    const local = localIARef.current[tel]
    if (local && local.expiresAt > now) return local.modoIA
    return contacts[tel]?.modoIA !== false // default true
  }

  const handleToggleIA = async () => {
    if (!activeConv || togglingIA) return
    const tel = activeConv.telefono
    const current = getModoIA(tel)
    const next = !current
    setTogglingIA(true)
    localIARef.current[tel] = { modoIA: next, expiresAt: Date.now() + 15000 }
    setContacts(prev => ({ ...prev, [tel]: { ...(prev[tel] || {}), modoIA: next } }))
    await toggleIAMode(tel, activeConv.nombre, currentStatus, contacts[tel]?.alias || '', next)
    setTogglingIA(false)
  }

  // ── Enviar botones interactivos ───────────────────────────────
  const handleSendButtons = async () => {
    if (!activeConv || !input.trim()) return
    const validBtns = btnTexts.map((t,i) => ({ id:`btn_${i+1}`, title:t.trim() })).filter(b=>b.title)
    if (validBtns.length === 0) return
    setSendingBtns(true)
    // El servidor guarda SOLO el cuerpo en `mensaje`; los botones van aparte en `botones`
    // (columna M / campo Supabase). Con el texto igual al guardado, la reconciliación
    // descarta el temporal sin duplicar, y la burbuja pinta los botones desde `botones`.
    const tmpMsg = {
      id:'tmp_'+Date.now(), telefono:activeConv.telefono, nombre:activeConv.nombre,
      mensaje:input.trim(), botones:validBtns,
      direccion:'SALIENTE', timestamp:new Date().toISOString(), estado:'enviado',
    }
    setConvs(prev=>prev.map(c=>c.telefono===activeConv.telefono?{...c,msgs:[...c.msgs,tmpMsg],last:tmpMsg}:c))
    pendingRef.current[activeConv.telefono] = [...(pendingRef.current[activeConv.telefono] || []), tmpMsg]
    const result = await sendInteractiveButtons(activeConv.telefono, activeConv.nombre, input.trim(), validBtns)
    setSendingBtns(false)
    setToast(result)
    setTimeout(()=>setToast(null),4000)
    if (result.ok) {
      setInput(''); setBtnTexts(['','','']); setShowBtnPanel(false)
      await changeStatus(activeConv.telefono, estadoAlResponder(currentStatus))
      setTimeout(load,4000)
    }
  }

  const currentContact = activeConv ? contacts[activeConv.telefono] : null
  const currentStatus  = currentContact?.estado || 'pendiente'
  const currentStatusView = activeConv ? getStatus(activeConv.telefono) : 'pendiente'
  const displayName    = (tel) => contacts[tel]?.alias || convs.find(c=>c.telefono===tel)?.nombre || tel

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        html, body, #root { height:100%; height:100dvh; }
        body { background:#080d14; font-family:'Outfit',sans-serif; overflow:hidden; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#1e2d3d; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:#25d366; }
        @keyframes spin  { to{transform:rotate(360deg)} }
        @keyframes up    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }
        @keyframes slideR { from{transform:translateX(100%)} to{transform:translateX(0)} }
        textarea,button,input { font-family:'Outfit',sans-serif; }
        .app-shell  { display:flex; height:100%; overflow:hidden; position:relative; }
        .sidebar    { width:300px; flex-shrink:0; background:#0d1520; border-right:1px solid #162030; display:flex; flex-direction:column; height:100%; overflow:hidden; }
        .chat-col   { flex:1; display:flex; flex-direction:column; min-width:0; overflow:hidden; }
        .right-col  { width:340px; flex-shrink:0; background:#0a0f1a; border-left:1px solid #111c2a; display:flex; flex-direction:column; overflow-y:auto; }
        .msgs-scroll{ flex:1; overflow-y:auto; padding:16px 20px; }
        .input-bar  { flex-shrink:0; padding:10px 16px 14px; background:#0a0f1a; border-top:1px solid #111c2a; }
        .chat-header{ padding:8px 10px; background:#0a0f1a; border-bottom:1px solid #111c2a; display:flex; align-items:center; flex-wrap:wrap; flex-shrink:0; gap:6px; }
        .chat-header-left{ display:flex; align-items:center; gap:7px; min-width:0; flex:0 0 auto; }
        .chat-actions{ display:flex; align-items:center; gap:4px; flex-wrap:wrap; flex:1; justify-content:flex-end; }
        .msg-bubble { max-width:68%; }
        .order-btn-mob{ display:none !important; }
        .mob-ham    { display:none !important; }
        .hide-mobile{ display:inline !important; }
        .show-mobile{ display:none !important; }
        .overlay    { display:none; }
        @media (max-width:767px){
          .sidebar{ position:fixed !important; left:0; top:0; bottom:0; z-index:100; width:100% !important; max-width:100% !important; box-shadow:4px 0 32px rgba(0,0,0,.6); transform:translateX(-100%); transition:transform .25s ease; }
          .sidebar.open{ transform:translateX(0); }
          .right-col{ position:fixed !important; right:0; top:0; bottom:0; z-index:100; width:88% !important; max-width:300px; box-shadow:-4px 0 32px rgba(0,0,0,.6); animation:slideR .25s ease; }
          .desktop-right{ display:none !important; }
          .mob-ham{ display:flex !important; }
          .hide-mobile{ display:none !important; }
          .show-mobile{ display:inline !important; }
          .overlay{ display:block; position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:90; }
          .msgs-scroll{ padding:12px 14px !important; }
          .input-bar{ padding-bottom:env(safe-area-inset-bottom,12px) !important; }
          /* Header en 2 filas: info arriba, acciones en tira scrollable abajo */
          .chat-header-left{ flex:1 1 100% !important; }
          .chat-actions{ flex:1 1 100% !important; flex-wrap:nowrap !important; overflow-x:auto; justify-content:flex-start !important; padding-bottom:2px; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
          .chat-actions::-webkit-scrollbar{ display:none; }
          .msg-bubble{ max-width:86% !important; }
          .order-btn-mob{ display:flex !important; }
          /* En celular las 5 pestañas se reparten el ancho en partes iguales → entran
             todas completas sin scroll ni cortes, sea cual sea el ancho del equipo. */
          .tab-selector{ overflow-x:hidden !important; }
          .tab-selector > button{ flex:1 1 0 !important; min-width:0 !important; padding:3px 2px !important; }
          .tab-selector > button > div{ letter-spacing:0 !important; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .tab-selector > button > div:first-child{ font-size:8.5px !important; }
          .tab-selector > button > div:last-child{ font-size:7px !important; }
        }
      `}</style>

      {showSetup && <SetupModal onClose={() => { setShowSetup(false); load() }} />}
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      {(showSidebar && active) && <div className="overlay" onClick={() => setShowSidebar(false)} />}
      {showRight            && <div className="overlay" onClick={() => setShowRight(false)} />}

      <div style={{ display:'flex', flexDirection:'column', height:'100dvh', overflow:'hidden' }}>

        {/* ══════ SELECTOR MANDI | REPUBLIC ══════ */}
        <div className="tab-selector" style={{
          // 'safe center': centra las pestañas si entran, pero si NO entran (celular)
          // alinea al inicio en vez de cortar la primera (MANDI) y dejarla inalcanzable.
          display:'flex', justifyContent:'safe center', alignItems:'center',
          flexShrink:0, height:38,
          background:'#080d14', borderBottom:'1px solid #162030',
          zIndex:200, overflowX:'auto',
        }}>
          {[
            { id:'MANDI',    label:'MANDI',    icon:'📱', color:'#25d366', sub:'API' },
            { id:'REPUBLIC', label:'REPUBLIC', icon:'💬', color:'#f97316', sub:'WA Web' },
            { id:'SOCIAL',   label:'SOCIAL',   icon:'🌐', color:'#1877F2', sub:'FB · IG' },
            { id:'CONTACTOS',label:'CONTACTOS',icon:'👥', color:'#38bdf8', sub:'Directorio' },
            { id:'AUTO',     label:'AUTOS',    icon:'⚙️', color:'#f59e0b', sub:'Reglas' },
          ].map(({ id, label, icon, color, sub }) => (
            <button key={id} onClick={() => setLinea(id)} style={{
              padding:'4px 16px', border:'none', cursor:'pointer', flexShrink:0, whiteSpace:'nowrap',
              background: linea===id ? `${color}15` : 'transparent',
              borderBottom: linea===id ? `2px solid ${color}` : '2px solid transparent',
              borderTop: '2px solid transparent',
              fontFamily:'Outfit,sans-serif', transition:'all .2s', height:'100%',
            }}>
              <div style={{ fontSize:10, fontWeight:800, color: linea===id ? color : '#334155', letterSpacing:'1.5px' }}>
                {icon} {label}
              </div>
              <div style={{ fontSize:8, color: linea===id ? color+'80' : '#2a3f55', letterSpacing:'1px' }}>{sub}</div>
            </button>
          ))}
        </div>

        {/* ══════ CONTENIDO ══════ */}
        <div className="app-shell" style={{ flex:1, minHeight:0, height:0 }}>

        {/* ══════ MANDI (API) ══════ */}
        {linea === 'MANDI' && (<>
        {/* ══════ SIDEBAR ══════ */}
        <div className={`sidebar${showSidebar ? ' open' : ''}`}>
          <div style={{ padding:'14px 14px 10px', borderBottom:'1px solid #162030', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#f97316,#dc2626)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:17, fontWeight:900, color:'#fff', boxShadow:'0 4px 16px rgba(249,115,22,.3)' }}>M</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:800, color:'#e2e8f0' }}>Mandarina Inbox</div>
                  <div style={{ fontSize:10, fontWeight:700, color:demo?'#f59e0b':'#25d366', display:'flex', alignItems:'center', gap:3, marginTop:1 }}>
                    <span style={{ animation:'pulse 2s infinite', display:'inline-block', width:5, height:5, borderRadius:'50%', background:'currentColor' }} />
                    {demo ? 'Demo' : `En vivo · ${counts.pendiente} pendiente${counts.pendiente===1?'':'s'}`}
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', gap:4 }}>
                <a href="/dashboard" title="Dashboard" style={{ background:'rgba(16,185,129,.14)', border:'1px solid rgba(16,185,129,.3)', color:'#10b981', borderRadius:8, width:28, height:28, cursor:'pointer', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none' }}>📊</a>
                <button onClick={() => setShowGuide(true)} style={{ background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.2)', color:'#818cf8', borderRadius:8, width:28, height:28, cursor:'pointer', fontSize:12 }}>📖</button>
                <button onClick={() => setLinea('AUTO')} title="Mensajes de saludo (automatizaciones)" style={{ background:'rgba(245,158,11,.14)', border:'1px solid rgba(245,158,11,.35)', color:'#f59e0b', borderRadius:8, width:28, height:28, cursor:'pointer', fontSize:13 }}>👋</button>
                <button onClick={() => setShowSetup(true)} style={{ background:'rgba(255,255,255,.04)', border:'1px solid #1a2d40', color:'#64748b', borderRadius:8, width:28, height:28, cursor:'pointer', fontSize:12 }}>⚙</button>
              </div>
            </div>
            <div style={{ position:'relative', marginBottom:6 }}>
              <span style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'#2a3f55', fontSize:12, pointerEvents:'none' }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={searchMode === 'mensaje' ? 'Buscar en mensajes (ej: Hoodie)...' : 'Buscar nombre o número...'}
                style={{ width:'100%', padding:'7px 28px 7px 28px', background:'#111c2a', border:`1px solid ${searchMode==='mensaje' ? 'rgba(96,165,250,.4)' : '#1a2d40'}`, borderRadius:8, color:'#e2e8f0', fontSize:12, outline:'none' }} />
              {search && (
                <button onClick={() => setSearch('')} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'transparent', border:'none', color:'#475569', cursor:'pointer', fontSize:13, padding:0, lineHeight:1 }}>✕</button>
              )}
            </div>
            {/* Selector de tipo de búsqueda */}
            <div style={{ display:'flex', gap:4, marginBottom:10 }}>
              {[
                { key:'contacto', label:'👤 Contactos' },
                { key:'mensaje',  label:'💬 Mensajes'  },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setSearchMode(key)} style={{
                  flex:1, padding:'5px 2px', fontSize:10, fontWeight:700,
                  background: searchMode===key ? 'rgba(96,165,250,.15)' : 'transparent',
                  border: `1px solid ${searchMode===key ? 'rgba(96,165,250,.45)' : '#1a2d40'}`,
                  color: searchMode===key ? '#60a5fa' : '#475569',
                  borderRadius:7, cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
                }}>{label}</button>
              ))}
            </div>
            {/* Fila 1 — BANDEJA (estado de conversación) + Ventas */}
            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
              {[
                { key:'pendiente', label:'🔴 Pendientes', color:'#f87171' },
                { key:'atendido',  label:'🟢 Atendidos',  color:'#4ade80' },
                { key:'venta',     label:'💰 Ventas',     color:'#10b981' },
                { key:'soporte',   label:'🎧 Soporte',    color:'#a78bfa' },
                { key:'archivado', label:'⚫ Archivados', color:'#64748b' },
              ].map(({ key, label, color }) => (
                <button key={key} onClick={() => setFilter(key)} style={{
                  flex:1, padding:'5px 2px', fontSize:9, fontWeight:700,
                  background:filter===key?`${color}18`:'transparent',
                  border:`1px solid ${filter===key?color+'40':'#1a2d40'}`,
                  color:filter===key?color:'#334155',
                  borderRadius:7, cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
                }}>
                  {label}
                  {counts[key]>0 && <span style={{ marginLeft:3, background:filter===key?color:'#1a2d40', color:filter===key?'#080d14':'#475569', borderRadius:10, padding:'0 4px', fontSize:8, fontWeight:800 }}>{counts[key]}</span>}
                </button>
              ))}
            </div>
            {/* Fila 2 — TEMPERATURA del lead (Eje 2, manual) */}
            <div style={{ display:'flex', gap:4, marginTop:5 }}>
              {TEMPERATURAS.map(({ key, icon, label, color }) => (
                <button key={key} onClick={() => setFilter(key)} style={{
                  flex:1, padding:'5px 2px', fontSize:9, fontWeight:700,
                  background:filter===key?`${color}18`:'transparent',
                  border:`1px solid ${filter===key?color+'40':'#1a2d40'}`,
                  color:filter===key?color:'#334155',
                  borderRadius:7, cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
                }}>
                  {icon} {label}
                  {key==='caliente' && counts.alerta>0 && <span title={`${counts.alerta} caliente(s) cerca de cerrar la ventana de 24h`} style={{ marginLeft:3 }}>⏰</span>}
                  {counts[key]>0 && <span style={{ marginLeft:3, background:filter===key?color:'#1a2d40', color:filter===key?'#080d14':'#475569', borderRadius:10, padding:'0 4px', fontSize:8, fontWeight:800 }}>{counts[key]}</span>}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
            {loading ? (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', paddingTop:48, gap:12 }}>
                <Spinner size={24} /><span style={{ fontSize:11, color:'#2a3f55' }}>Cargando...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding:28, textAlign:'center', color:'#2a3f55', fontSize:12 }}>
                {isSearching
                  ? (searchingMsgs ? `Ningún mensaje dice "${search.trim()}"` : `Sin resultados para "${search.trim()}"`)
                  : `Sin conversaciones ${({pendiente:'pendientes',atendido:'atendidas',venta:'con venta',soporte:'en soporte',archivado:'archivadas',caliente:'🔥 calientes',tibio:'🌤️ tibias',frio:'❄️ frías'})[filter]||''}`}
              </div>
            ) : (<>
              {isSearching && (
                <div style={{ padding:'8px 16px 4px', fontSize:10, fontWeight:800, letterSpacing:'.06em', color:'#64748b' }}>
                  {filtered.length} {searchingMsgs ? (filtered.length===1?'CHAT CON':'CHATS CON') : `RESULTADO${filtered.length===1?'':'S'}`}{searchingMsgs ? ' ESE MENSAJE' : ' · TODAS LAS BANDEJAS'}
                </div>
              )}
              {filtered.map(conv => (
                <ContactRow
                  key={conv.telefono}
                  conv={{ ...conv, nombre: displayName(conv.telefono) }}
                  isActive={active===conv.telefono}
                  onClick={() => openConv(conv.telefono)}
                  search={search}
                  estado={getStatus(conv.telefono)}
                  modoIA={getModoIA(conv.telefono)}
                  temp={getTemp(conv.telefono)}
                  alerta={alertaVentana(conv.telefono)}
                  msgSnippet={searchingMsgs ? matchSnippet(conv) : null}
                />
              ))}
            </>)}
          </div>

          <div style={{ padding:'7px 14px', borderTop:'1px solid #162030', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
            <span style={{ fontSize:10, color:'#334155' }}>{lastSync?'Sync '+lastSync.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}</span>
            <button
              onClick={() => window.location.reload()}
              title="Recargar (F5)"
              style={{
                background:'rgba(37,211,102,.1)', border:'1px solid rgba(37,211,102,.25)',
                color:'#25d366', borderRadius:7, width:30, height:30,
                cursor:'pointer', fontSize:15, display:'flex', alignItems:'center', justifyContent:'center',
                transition:'all .15s',
              }}
            >↻</button>
          </div>
        </div>

        {/* ══════ CHAT ══════ */}
        {activeConv ? (
          <div className="chat-col">
            <div className="chat-header">
              <div className="chat-header-left">
                <button className="mob-ham" onClick={() => setShowSidebar(s=>!s)} style={{ background:'transparent', border:'none', color:'#25d366', cursor:'pointer', fontSize:20, padding:'0 2px', lineHeight:1, flexShrink:0 }}>☰</button>
                <Avatar name={displayName(activeConv.telefono)} phone={activeConv.telefono} size={34} />
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontWeight:800, color:'#f1f5f9', fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:160 }}>{displayName(activeConv.telefono)}</div>
                  <div style={{ fontSize:9, color:'#475569' }}>+{activeConv.telefono}</div>
                </div>
                {/* Acceso directo a Crear pedido / herramientas (solo móvil) */}
                <button onClick={() => setShowRight(true)} className="order-btn-mob" title="Crear pedido y herramientas"
                  style={{ alignItems:'center', gap:5, padding:'6px 12px', borderRadius:20, border:'1px solid rgba(16,185,129,.5)', background:'linear-gradient(135deg,#10b981,#059669)', color:'#fff', fontSize:11, fontWeight:800, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, boxShadow:'0 2px 10px rgba(16,185,129,.3)', marginLeft:'auto' }}>
                  🧾 Pedido
                </button>
              </div>
              <div className="chat-actions">
                {/* ── Eje 1: BANDEJA (estado de conversación) ── */}
                {[
                  { s:'pendiente', icon:'🔴', label:'Pendiente', shortLabel:'🔴', activeColor:'#f87171' },
                  { s:'atendido',  icon:'🟢', label:'Atendido',  shortLabel:'🟢', activeColor:'#4ade80' },
                  { s:'soporte',   icon:'🎧', label:'Soporte',   shortLabel:'🎧', activeColor:'#a78bfa' },
                  { s:'archivado', icon:'⚫', label:'Archivar',  shortLabel:'⚫', activeColor:'#94a3b8' },
                ].map(({ s, icon, label, shortLabel, activeColor }) => (
                  <button key={s} onClick={() => changeStatus(activeConv.telefono, s)} title={label} style={{
                    padding:'4px 6px', fontWeight: currentStatusView===s ? 800 : 600, flexShrink:0,
                    background: currentStatusView===s ? `${activeColor}22` : 'transparent',
                    border: `${currentStatusView===s ? 2 : 1}px solid ${currentStatusView===s ? activeColor : '#1e2d3d'}`,
                    color: currentStatusView===s ? activeColor : '#475569',
                    borderRadius:7, cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
                    boxShadow: currentStatusView===s ? `0 0 8px ${activeColor}44` : 'none',
                  }}>
                    <span className="hide-mobile" style={{ fontSize:10 }}>{icon} {label}</span>
                    <span className="show-mobile" style={{ fontSize:14 }}>{shortLabel}</span>
                  </button>
                ))}

                {/* separador entre ejes */}
                <span style={{ width:1, alignSelf:'stretch', background:'#1e2d3d', margin:'2px 2px', flexShrink:0 }} />

                {/* ── Eje 2: TEMPERATURA del lead (manual, clic de nuevo = quitar) ── */}
                {TEMPERATURAS.map(({ key, icon, label, color }) => {
                  const tempActual = getTemp(activeConv.telefono)
                  const on = tempActual === key
                  return (
                    <button key={key} onClick={() => changeTemperatura(activeConv.telefono, key)}
                      title={on ? `${label} — clic para quitar` : `Marcar ${label}`} style={{
                        padding:'4px 6px', fontWeight: on ? 800 : 600, flexShrink:0,
                        background: on ? `${color}22` : 'transparent',
                        border: `${on ? 2 : 1}px solid ${on ? color : '#1e2d3d'}`,
                        color: on ? color : '#475569',
                        borderRadius:7, cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
                        boxShadow: on ? `0 0 8px ${color}44` : 'none',
                      }}>
                      <span className="hide-mobile" style={{ fontSize:10 }}>{icon} {label}</span>
                      <span className="show-mobile" style={{ fontSize:14 }}>{icon}</span>
                    </button>
                  )
                })}

                {/* ── TOGGLE AGENTE IA ── */}
                {(() => {
                  const iaOn = getModoIA(activeConv.telefono)
                  return (
                    <button
                      onClick={handleToggleIA}
                      disabled={togglingIA}
                      title={iaOn ? 'Agente IA activo — clic para pausar' : 'Agente IA pausado — clic para activar'}
                      style={{
                        display:'flex', alignItems:'center', gap:5,
                        padding:'4px 10px', borderRadius:20, cursor:'pointer',
                        fontFamily:'inherit', fontWeight:800, fontSize:10,
                        border: `2px solid ${iaOn ? '#f59e0b' : '#1e2d3d'}`,
                        background: iaOn ? 'rgba(245,158,11,.12)' : 'rgba(255,255,255,.03)',
                        color: iaOn ? '#f59e0b' : '#334155',
                        boxShadow: iaOn ? '0 0 10px rgba(245,158,11,.25)' : 'none',
                        transition:'all .2s',
                        minWidth: 80, flexShrink:0,
                      }}
                    >
                      <span style={{
                        width:8, height:8, borderRadius:'50%', flexShrink:0,
                        background: iaOn ? '#f59e0b' : '#334155',
                        animation: iaOn ? 'pulse 2s infinite' : 'none',
                      }}/>
                      {togglingIA ? '...' : iaOn ? 'IA activa' : 'IA pausada'}
                    </button>
                  )
                })()}
              </div>
            </div>

            {/* ⏰ Alerta: lead 🔥 caliente cerca de cerrar la ventana de 24h */}
            {alertaVentana(activeConv.telefono) && (
              <div style={{ padding:'7px 14px', background:'rgba(249,115,22,.12)', borderBottom:'1px solid rgba(249,115,22,.3)', color:'#fb923c', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:8, flexWrap:'wrap' }}>
                <span>⏰ 🔥 Lead caliente — se cierra la ventana de 24h en ~{horasParaCierre(activeConv.telefono)}h. Escríbele ya para no perderla.</span>
              </div>
            )}

            <div ref={msgsRef} className="msgs-scroll" onScroll={handleMsgsScroll} style={{ background:'radial-gradient(ellipse at 20% 10%, rgba(37,211,102,.015) 0%, transparent 60%)' }}>
              {activeConv.msgs.map((msg, idx) => {
                const showDate = idx===0 || parseDate(msg.timestamp).toDateString() !== parseDate(activeConv.msgs[idx-1].timestamp).toDateString()
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div style={{ display:'flex', justifyContent:'center', margin:'12px 0 8px' }}>
                        <span style={{ background:'rgba(255,255,255,.04)', borderRadius:20, padding:'3px 14px', fontSize:11, color:'#475569' }}>{fmtDate(msg.timestamp)}</span>
                      </div>
                    )}
                    <MessageBubble msg={msg} allMsgs={activeConv.msgs} />
                  </div>
                )
              })}
              {sending && (
                <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:4 }}>
                  <div style={{ background:'#0d4f3c', borderRadius:'18px 18px 4px 18px', padding:'9px 14px', border:'1px solid rgba(37,211,102,.1)' }}>
                    <span style={{ color:'#25d366', fontSize:12, animation:'blink 1s infinite' }}>Enviando...</span>
                  </div>
                </div>
              )}
              <Toast result={toast} />
              <div ref={endRef} />
            </div>

            <div className="input-bar" style={{ position:'relative' }}>
              {!windowOpen && lastMsg && (
                <div style={{ marginBottom:8, padding:'7px 12px', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, fontSize:11, color:'#fbbf24', display:'flex', alignItems:'center', justifyContent:'center', gap:10, flexWrap:'wrap' }}>
                  <span>⚠️ Ventana de 24h cerrada — solo plantilla</span>
                  <button onClick={() => setShowTplModal(true)}
                    style={{ background:'linear-gradient(135deg,#f59e0b,#f97316)', border:'none', color:'#0b1220', fontWeight:800, fontSize:11, padding:'4px 12px', borderRadius:7, cursor:'pointer', fontFamily:'Outfit,sans-serif' }}>
                    📋 Enviar plantilla
                  </button>
                </div>
              )}
              {imgFiles.length > 0 && (
                <div style={{ marginBottom:8, padding:'8px 12px', background:'#0d1828', border:'1px solid #1a2d40', borderRadius:12 }}>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
                    {imgFiles.map((item, i) => (
                      <div key={i} style={{ position:'relative' }}>
                        {isVideo
                          ? <video src={item.preview} style={{ width:64, height:44, borderRadius:8, objectFit:'cover' }} muted />
                          : <img src={item.preview} style={{ width:44, height:44, borderRadius:8, objectFit:'cover' }} alt={`preview-${i}`} />
                        }
                        {imgUploading && imgProgress > i && (
                          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.5)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:'#25d366' }}>✓</div>
                        )}
                        {!imgUploading && !imgResult && (
                          <button onClick={() => setImgFiles(prev => prev.filter((_,j) => j!==i))}
                            style={{ position:'absolute', top:-4, right:-4, width:16, height:16, borderRadius:'50%', background:'#f87171', border:'none', color:'#fff', fontSize:9, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ fontSize:10, color:'#64748b' }}>
                      {imgUploading
                        ? `Enviando ${imgProgress}/${imgFiles.length}...`
                        : imgResult
                          ? imgResult.ok ? (isVideo ? '✓ video enviado' : `✓ ${imgFiles.length} enviada${imgFiles.length>1?'s':''}`) : `✗ ${imgResult.error || 'Error al enviar'}`
                          : isVideo ? '1 video seleccionado' : `${imgFiles.length} foto${imgFiles.length>1?'s':''} seleccionada${imgFiles.length>1?'s':''}`
                      }
                    </span>
                    {!imgResult && (
                      <div style={{ display:'flex', gap:5 }}>
                        <button onClick={handleSendImage} disabled={imgUploading||!windowOpen}
                          style={{ padding:'5px 10px', background:imgUploading?'#111c2a':'linear-gradient(135deg,#25d366,#128c7e)', border:'none', borderRadius:7, color:'#fff', fontSize:11, fontWeight:700, cursor:imgUploading?'default':'pointer', fontFamily:'inherit' }}>
                          {imgUploading?'⏳':'📤 Enviar'}
                        </button>
                        <button onClick={cancelImage} style={{ padding:'5px 8px', background:'transparent', border:'1px solid #1e2d3d', borderRadius:7, color:'#475569', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>✕</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
                <button onClick={() => fileRef.current?.click()} style={{ width:42, height:42, flexShrink:0, background:imgFiles.length?'rgba(37,211,102,.12)':'#111c2a', border:`1px solid ${imgFiles.length?'rgba(37,211,102,.3)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:17, display:'flex', alignItems:'center', justifyContent:'center', color:imgFiles.length?'#25d366':'#475569', transition:'all .15s', position:'relative' }} title="Adjuntar imagen o video">
                  📎
                  {imgFiles.length > 0 && <span style={{ position:'absolute', top:-4, right:-4, width:16, height:16, borderRadius:'50%', background:'#25d366', color:'#080d14', fontSize:8, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center' }}>{imgFiles.length}</span>}
                </button>
                <button onClick={() => setShowBtnPanel(p=>!p)} title="Botones interactivos" style={{ width:42, height:42, flexShrink:0, background:showBtnPanel?'rgba(37,211,102,.15)':'#111c2a', border:`1px solid ${showBtnPanel?'rgba(37,211,102,.4)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', color:showBtnPanel?'#25d366':'#475569', transition:'all .15s' }}>🔘</button>
                <button onClick={() => { setShowEmoji(p=>!p); setShowBtnPanel(false) }} title="Emojis" style={{ width:42, height:42, flexShrink:0, background:showEmoji?'rgba(245,158,11,.15)':'#111c2a', border:`1px solid ${showEmoji?'rgba(245,158,11,.4)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:20, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>😊</button>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display:'none' }} onChange={handleFileSelect} />

                {/* Panel de emojis */}
                {showEmoji && (
                  <EmojiPicker onSelect={(emoji) => setInput(prev => prev + emoji)} onClose={() => setShowEmoji(false)} />
                )}

                {/* Panel de botones interactivos */}
                {showBtnPanel && (
                  <div style={{ position:'absolute', bottom:'100%', left:16, right:16, marginBottom:8, padding:'10px 12px', background:'#0d1828', border:'1px solid rgba(37,211,102,.2)', borderRadius:12, zIndex:50 }}>
                    <div style={{ fontSize:10, color:'#25d366', fontWeight:700, marginBottom:7, letterSpacing:'.06em' }}>🔘 BOTONES INTERACTIVOS</div>
                    {btnTexts.map((txt,i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                        <span style={{ fontSize:10, color:'#334155', width:12, flexShrink:0 }}>{i+1}.</span>
                        <input value={txt} onChange={e => setBtnTexts(prev=>prev.map((v,j)=>j===i?e.target.value:v))}
                          placeholder={`Botón ${i+1} (máx 20 caracteres)`} maxLength={20}
                          style={{ flex:1, background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:7, padding:'6px 9px', color:'#e2e8f0', fontSize:11, outline:'none', fontFamily:'inherit' }}
                          onFocus={e=>e.target.style.borderColor='#25d366'} onBlur={e=>e.target.style.borderColor='#1e2d3d'} />
                        {txt && <span style={{ fontSize:9, color:'#334155' }}>{txt.length}/20</span>}
                      </div>
                    ))}
                    {btnTexts.some(t=>t.trim()) && !input.trim() ? (
                      <div style={{ marginTop:5, padding:'5px 9px', background:'rgba(245,158,11,.14)', border:'1px solid rgba(245,158,11,.35)', borderRadius:7, fontSize:10, color:'#f59e0b', fontWeight:600 }}>
                        ⚠️ Falta escribir el mensaje (va arriba de los botones) — luego dale a ➤
                      </div>
                    ) : (
                      <div style={{ fontSize:9, color:'#2a3f55', marginTop:3 }}>Escribe el mensaje abajo y dale a enviar · Máx 3 botones</div>
                    )}
                  </div>
                )}

                <div style={{ flex:1, background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:13, padding:'9px 13px', position:'relative' }}>
                  <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                    placeholder={getModoIA(activeConv?.telefono) ? '🤖 IA respondiendo automáticamente...' : 'Escribe un mensaje... (Ctrl+Enter para enviar)'}
                    rows={2}
                    style={{
                      width:'100%', background:'transparent', border:'none', outline:'none',
                      color:'#e2e8f0', fontSize:14, resize:'none', lineHeight:1.5,
                      minHeight:44, maxHeight:120, overflowY:'auto',
                      scrollbarWidth:'thin',
                      scrollbarColor:'#25d366 #111c2a',
                    }} />
                </div>

                <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                  {(() => {
                    // UN SOLO botón de envío: si el panel de botones está abierto y hay
                    // botones con texto → manda CON botones; si no → manda solo texto.
                    const conBotones = showBtnPanel && btnTexts.some(t => t.trim())
                    const busy = sending || sendingBtns
                    const activo = !!input.trim() && windowOpen && !busy
                    return (
                      <button
                        onClick={() => { if (conBotones) handleSendButtons(); else handleSend() }}
                        disabled={!activo}
                        title={conBotones ? 'Enviar con botones' : 'Enviar'}
                        style={{ width:42, height:42, flexShrink:0, border:'none', borderRadius:11, cursor: activo ? 'pointer' : 'default', fontSize: conBotones ? 15 : 17, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s',
                          background: activo ? (conBotones ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#25d366,#128c7e)') : '#111c2a',
                          boxShadow: activo ? (conBotones ? '0 4px 14px rgba(245,158,11,.3)' : '0 4px 14px rgba(37,211,102,.3)') : 'none' }}>
                        {busy ? '⏳' : (conBotones ? '🔘' : '➤')}
                      </button>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, position:'relative' }}>
            <button className="mob-ham" onClick={() => setShowSidebar(true)} style={{ position:'absolute', top:14, left:14, background:'rgba(37,211,102,.1)', border:'1px solid rgba(37,211,102,.2)', color:'#25d366', borderRadius:9, width:38, height:38, cursor:'pointer', fontSize:18, display:'none', alignItems:'center', justifyContent:'center' }}>☰</button>
            <div style={{ fontSize:52, opacity:.05 }}>💬</div>
            <p style={{ color:'#1e2d3d', fontSize:13, fontWeight:700 }}>{loading?'Cargando...':'Selecciona una conversación'}</p>
          </div>
        )}

        {/* ══════ RIGHT PANEL (desktop) — redimensionable ══════ */}
        {activeConv && (
          <div className="desktop-right" style={{ width: rightWidth, flexShrink:0, display:'flex', position:'relative' }}>
            {/* Asa de arrastre para ensanchar/adelgazar */}
            <div
              onMouseDown={startResize}
              onTouchStart={startResize}
              title="Arrastra para ajustar el ancho"
              style={{ width:6, flexShrink:0, cursor:'col-resize', background:'#111c2a', borderLeft:'1px solid #162030', transition:'background .15s', touchAction:'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#25d366'}
              onMouseLeave={e => e.currentTarget.style.background = '#111c2a'}
            />
            <div className="right-col" style={{ width:'auto', flex:1, borderLeft:'none' }}>
              <RightPanel
                activeConv={activeConv}
                contactInfo={currentContact}
                onQuickReply={handleQuickReply}
                onSendText={handleSendText}
                onSendImage={handleSendAIImage}
                onUpdateContact={handleUpdateContact}
                windowOpen={windowOpen}
              />
            </div>
          </div>
        )}
        {showRight && (
          <div className="right-col">
            <div style={{ display:'flex', justifyContent:'flex-end', padding:'10px 10px 0' }}>
              <button onClick={() => setShowRight(false)} style={{ background:'transparent', border:'none', color:'#475569', cursor:'pointer', fontSize:17 }}>✕</button>
            </div>
            <RightPanel
              activeConv={activeConv}
              contactInfo={currentContact}
              onQuickReply={handleQuickReply}
              onSendText={handleSendText}
              onSendImage={handleSendAIImage}
              onUpdateContact={handleUpdateContact}
              windowOpen={windowOpen}
            />
          </div>
        )}

        </>)}

        {/* ══════ REPUBLIC ══════ — siempre montado, solo se oculta */}
        <div style={{ flex:1, display: linea === 'REPUBLIC' ? 'flex' : 'none', overflow:'hidden', height:'100%' }}>
          <RepublicInbox active={linea === 'REPUBLIC'} />
        </div>

        {/* ══════ SOCIAL ══════ — FB + IG */}
        <div style={{ flex:1, display: linea === 'SOCIAL' ? 'flex' : 'none', overflow:'hidden', height:'100%' }}>
          <SocialInbox active={linea === 'SOCIAL'} />
        </div>

        {/* ══════ CONTACTOS ══════ — directorio + envío por ventana 24h */}
        <div style={{ flex:1, display: linea === 'CONTACTOS' ? 'flex' : 'none', overflow:'hidden', height:'100%' }}>
          <Contactos active={linea === 'CONTACTOS'} onOpenChat={abrirChatDesdeContactos} />
        </div>

        {/* ══════ AUTOMATIZACIONES ══════ — reglas on/off */}
        <div style={{ flex:1, display: linea === 'AUTO' ? 'flex' : 'none', overflow:'hidden', height:'100%' }}>
          <Automatizaciones active={linea === 'AUTO'} />
        </div>

        </div>{/* fin app-shell */}
      </div>{/* fin wrapper */}

      {/* Modal de plantilla desde el chat (cuando la ventana de 24h está cerrada) */}
      {showTplModal && activeConv && (
        <PlantillaModal
          telefono={activeConv.telefono}
          nombre={activeConv.nombre}
          onClose={() => setShowTplModal(false)}
          flash={(m) => { setTplToast(m); setTimeout(() => setTplToast(null), 3000) }}
        />
      )}
      {tplToast && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          background:'#0d1828', border:'1px solid #1e2d3d', color:'#e2e8f0',
          padding:'10px 18px', borderRadius:10, fontSize:13, fontWeight:700, zIndex:600,
          boxShadow:'0 8px 30px rgba(0,0,0,.5)', maxWidth:'86vw', textAlign:'center',
        }}>{tplToast}</div>
      )}
    </>
  )
}
