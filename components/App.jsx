'use client'
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { fetchInboxSync, fetchHilo, buscarEnMensajes, sendReply, updateContact, updateTemperatura, isDemo, sendInteractiveButtons, toggleIAMode, sendVideo, sendImageFile, precacheMedia, setCanalActivo, getCanalActivo } from '@/lib/api-client'
import { buildConvs, fmtDate, parseDate } from '@/lib/utils'
import { Spinner, Avatar, ContactRow, MessageBubble, Toast } from '@/components/Components'
import RightPanel from '@/components/RightPanel'
import SetupModal from '@/components/SetupModal'
import GuideModal from '@/components/GuideModal'
import { CANALES, CANAL_GENERAL, CANAL_POR_DEFECTO, colorDeCanal, canalDePhoneId } from '@/lib/canales'
import SocialInbox from '@/components/SocialInbox'
import Contactos, { PlantillaModal } from '@/components/Contactos'
import Automatizaciones from '@/components/Automatizaciones'
import PushToggle from '@/components/PushToggle'
import AvisoSesion from '@/components/AvisoSesion'
import { actualizarNoLeidos, notificar } from '@/lib/notif'
import { hayQueConfirmarDescarte, AVISO_DESCARTAR_PEDIDO, anchoPanelPedido, anchoPanelMinimo, bytesDeDataUrl, MAX_HOJA_BYTES } from '@/lib/pedido-manual'
import { decidirArrastre } from '@/lib/arrastre'

// ── Ancho del panel derecho: UNA sola fuente ──────────────────────
// Lo usan el asa de arrastre, la restauración de localStorage y el ensanchado
// automático del PEDIDO MANUAL. Tienen que salir del mismo lado: cuando el
// máximo del asa (antes 680, a mano) era MENOR que el ancho al que se abría el
// formulario (antes 720, a mano), el primer arrastre devolvía el panel de un
// salto hacia atrás. Eso es lo que se sentía como que el asa "se queda
// aplastada".
const ANCHO_MIN = 280
const ANCHO_MAX = 680

// Con el formulario abierto el panel mide lo que mide el formulario, ni más ni
// menos: si sobra, el vacío se reparte a los lados y el panel le roba pantalla
// al chat para nada. Y el PISO sube, porque por debajo de cierto ancho el CRM se
// pasa solo a su diseño de celular. Los dos números se DERIVAN de `ESCALA_PEDIDO`
// (ver lib/pedido-manual.js): si alguien toca la escala, se mueven con ella.
const ANCHO_PEDIDO     = anchoPanelPedido()   // hoy 560 → 800 px internos
const ANCHO_MIN_PEDIDO = anchoPanelMinimo()   // hoy 538 → 769 px internos, justo sobre el corte

// ── Dos ejes de estado ────────────────────────────────────────────
// Eje 1 (bandeja): pendiente / atendido / soporte / archivado — casi todo automático.
// Eje 2 (temperatura del lead): caliente / tibio / frio — 100% MANUAL, nada la cambia sola.
const TEMPERATURAS = [
  { key:'caliente', icon:'🔥', label:'Caliente', color:'#f97316' },
  { key:'tibio',    icon:'🌤️', label:'Tibio',    color:'#fbbf24' },
  { key:'frio',     icon:'❄️', label:'Frío',     color:'#38bdf8' },
]
const TEMP_META = Object.fromEntries(TEMPERATURAS.map(t => [t.key, t]))

// La caja de texto arranca en UNA línea y se estira sola. Los números salen de
// fontSize 14 × lineHeight 1.5 = 21px por línea, más 11px de aire arriba y abajo
// (lo que centra esa única línea dentro de los 44px de zona táctil del celular).
// El tope son 6 líneas: el dueño escribe desde el teléfono y con 5 volvía a
// aparecer scroll dentro de la caja, que es justo lo que se quería sacar.
const CAJA_LINEA     = 21
const CAJA_AIRE      = 11
const CAJA_ALTO_MIN  = 44                                      // zona táctil, no se negocia
const CAJA_ALTO_MAX  = CAJA_LINEA * 6 + CAJA_AIRE * 2          // 148px ≈ 6 líneas

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

/**
 * Un `data:image/jpeg;base64,…` convertido en el mismo tipo de archivo que
 * entrega el 📎 de adjuntar, para que pueda seguir el camino de fotos de
 * siempre sin ningún trato especial.
 *
 * Nada de `fetch(dataUrl)`, que sería lo corto: acá el dato viene de otro
 * dominio por `postMessage` y pasarlo por la red —aunque sea "la red" de un
 * data URL— es darle a un string ajeno un camino que no necesita. `atob` no
 * sale del proceso, y si el base64 viene roto tira acá, antes de tocar nada.
 */
function archivoDesdeDataUrl(dataUrl, nombre) {
  const s = String(dataUrl)
  const crudo = atob(s.slice(s.indexOf(',') + 1))
  const bytes = new Uint8Array(crudo.length)
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i)
  return new File([bytes], nombre, { type: 'image/jpeg' })
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
  // ── Selector de línea ───────────────────────────────────────
  // MANDI y REPUBLIC son DOS NÚMEROS del mismo inbox, no dos aplicaciones: usan
  // la misma vista de chat y solo cambia el canal. REPUBLIC antes leía WhatsApp
  // Web con una extensión de Chrome y un launcher en localhost:3098; ahora es
  // Cloud API como MANDI. Ver lib/canales.js.
  const [linea, setLinea] = useState('MANDI') // 'MANDI' | 'REPUBLIC' | 'SOCIAL' | 'CONTACTOS' | 'AUTO'
  // Canal por el que se va a responder AHORA MISMO. En las pestañas MANDI y
  // REPUBLIC es la pestaña misma; en GENERAL lo fija el contacto que abres.
  // Arranca en CANAL_POR_DEFECTO (nunca vacío): un envío con Canal vacío sale
  // por el número equivocado.
  const [canalArmado, setCanalArmado] = useState(CANAL_POR_DEFECTO)
  const [pendientes, setPendientes] = useState({})   // { phoneId: nº pendientes }
  // Las dos pestañas de número comparten la vista de chat de abajo.
  const esChat = linea === 'MANDI' || linea === 'REPUBLIC'

  const [convs,        setConvs]        = useState([])
  const [contacts,     setContacts]     = useState({}) // telefono → {alias, estado}
  const [active,       setActive]       = useState(null)
  const [input,        setInput]        = useState('')
  // Envíos en fila por chat: { telefono: cuántos esperan turno o están saliendo }.
  // Reemplaza al viejo booleano `sending`, que además de mostrar "Enviando..."
  // BLOQUEABA el botón — ahora se puede encolar sin esperar.
  const [colaLen,      setColaLen]      = useState({})
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
  // Solo para pintar la capa que tapa el iframe mientras se arrastra. El ref
  // sigue siendo el que manda dentro de los escuchadores.
  const [arrastrando,  setArrastrando]  = useState(false)

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
  const taRef      = useRef(null)  // caja de texto del compositor (para que crezca sola)

  // Mensaje que se está citando al responder (null = ninguno).
  const [citando, setCitando] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const localStatusRef = useRef({}) // { telefono: { estado, expiresAt } }
  const localTempRef   = useRef({}) // { telefono: { temperatura, expiresAt } } — override optimista Eje 2
  const alertadosRef   = useRef(new Set()) // claves `${tel}:${ultimoEntranteAt}` ya avisadas (1 alerta/ventana)

  // Mensajes optimistas pendientes (por teléfono) hasta que Make los registre en la hoja
  const pendingRef = useRef({})
  // Fila de salida POR CONVERSACIÓN. Como los envíos ya no bloquean la interfaz, el
  // vendedor puede disparar una respuesta rápida de 4 fotos y, encima, mandar la foto
  // de otro producto: sin fila, esa foto se colaba ENTRE las de la respuesta rápida y
  // al cliente le llegaba todo mezclado. Acá lo que se clickea primero sale primero y
  // COMPLETO antes de que empiece lo siguiente. Chats distintos no se esperan entre sí.
  const colaRef = useRef({})
  const hilosRef   = useRef({})   // telefono → historial completo ya descargado (carga por chat)
  const activeRef  = useRef(null) // teléfono del chat abierto (para no borrar su hilo del cache)
  // `load` es un useCallback con dependencias vacías: no puede leer `linea`
  // directo (quedaría congelado en el primer render) y meterlo en las
  // dependencias recrearía la función en cada cambio de pestaña, reiniciando el
  // polling. La ref le da el valor de ahora sin recrear nada.
  const lineaRef = useRef(linea)
  useEffect(() => { lineaRef.current = linea }, [linea])
  const backGuardRef = useRef(false) // móvil: entrada de historial empujada al abrir un chat (el "atrás" del celu vuelve a la lista en vez de salir de la app)

  // La caja de texto crece con lo que se escribe. Antes tenía altura fija y
  // scroll propio: al pasar de dos líneas el navegador arrastraba la vista para
  // seguir al cursor. Y como `.chat-col` tiene overflow:hidden, el que se corría
  // era ESE contenedor entero —sin barra de scroll para devolverlo—, por eso se
  // sentía como que "se movía toda la ventana" y no como un scroll de la caja.
  const ajustarAlto = useCallback((ta) => {
    if (!ta) return
    ta.style.height = 'auto'   // sin esto solo crecería, nunca volvería a achicarse
    // Vacía SIEMPRE mide una línea. Se fuerza en vez de medir porque Chrome suma el
    // placeholder al scrollHeight: si el texto de ayuda envuelve a dos líneas en el
    // celular, la caja arrancaría en dos aunque no haya nada escrito.
    ta.style.height = ta.value
      ? Math.min(ta.scrollHeight, CAJA_ALTO_MAX) + 'px'
      : CAJA_ALTO_MIN + 'px'
  }, [])

  // Ref de función: mide en cuanto el <textarea> entra al DOM. Hace falta porque
  // el compositor se desmonta al volver a la lista y el borrador NO se borra al
  // cambiar de chat ni de bandeja: al volver, `input` es el mismo, así que un
  // efecto por dependencias no dispararía y la caja aparecería en su alto mínimo
  // con el borrador largo adentro y scroll, hasta tocar una tecla.
  const setTaRef = useCallback((node) => { taRef.current = node; ajustarAlto(node) }, [ajustarAlto])

  // Recalcular cuando cambia el texto —incluido el que entra por código:
  // respuestas rápidas, emojis, copiar al input, y el setInput('') del envío, que
  // devuelve la caja a una línea— y cuando cambia el ANCHO disponible, porque el
  // mismo texto se re-parte en más o menos líneas: al arrastrar el asa del panel
  // derecho (rightWidth) o al rotar el celular (resize).
  useLayoutEffect(() => { ajustarAlto(taRef.current) }, [input, active, rightWidth, ajustarAlto])

  useEffect(() => {
    const alRedimensionar = () => ajustarAlto(taRef.current)
    window.addEventListener('resize', alRedimensionar)
    return () => window.removeEventListener('resize', alRedimensionar)
  }, [ajustarAlto])

  // ── Cargar datos ──────────────────────────────────────────────
  const load = useCallback(async () => {
    // UN request por ciclo (antes 3: lista+mensajes+contactos → /api/inbox-sync).
    // null (error) → se conservan los datos previos, no parpadea a blanco.
    const sync   = await fetchInboxSync(lineaRef.current === CANAL_GENERAL)
    const lista  = sync?.lista ?? null
    const rows   = sync?.rows ?? null
    const ctList = sync?.contactos ?? null
    // Pendientes de TODOS los canales (incluido el que no se está mirando).
    if (sync?.pendientes) setPendientes(sync.pendientes)
    // Combinamos 3 fuentes (buildConvs deduplica por id de mensaje):
    //  · lista → ÚLTIMO msg de CADA conversación sobre TODO el historial → aparecen
    //            también los chats viejos que la ventana de 3000 ocultaba (el bug de
    //            "no aparece el cliente / se borraron los mensajes").
    //  · rows  → ventana reciente: mantiene el hilo abierto al día y da los no leídos.
    //  · hilos → historiales completos ya descargados al abrir cada chat.
    // null = ERROR (no "vacío"): conservamos lo previo para no parpadear a blanco.
    if (Array.isArray(lista) || Array.isArray(rows)) {
      const hilos = Object.values(hilosRef.current).flat()
      // ORDEN IMPORTANTE: buildConvs deduplica por id y se queda con el PRIMERO que
      // ve. `lista` es la fuente más pobre (sale de una vista con menos columnas), así
      // que va al FINAL: si un mensaje viene por dos lados, gana la versión completa.
      // Con `lista` primero, el último mensaje de cada chat perdía la cita y la pauta.
      const convsData = buildConvs([...(rows || []), ...hilos, ...(lista || [])])
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
    // Polling inteligente de DOS velocidades y solo con la pestaña VISIBLE:
    //  · chat abierto (active) → 10s: la conversación se siente casi en vivo.
    //  · sin chat abierto      → 25s: solo lista/contactos, mucho más barato.
    // En segundo plano se pausa; al volver a la pestaña refresca al instante.
    const ms = active ? 10000 : 25000
    const start = () => {
      if (pollRef.current) return
      pollRef.current = setInterval(load, ms)
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
  }, [load, active])

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

  // El asistente del CRM son 4 pasos pensados para pantalla completa; en 340px
  // no se puede llenar. Se ensancha al abrirlo y se devuelve el ancho guardado
  // al cerrar. Es el punto más flojo del diseño y está aceptado a sabiendas.
  //
  // El ancho anterior va en una REF, no en estado, a propósito: hay que leerlo y
  // escribirlo dentro del mismo callback, y meter un `setRightWidth` dentro del
  // actualizador de un `useState` es un efecto secundario en un updater — React
  // los ejecuta dos veces en modo estricto y el ancho quedaría mal guardado.
  const anchoPrevioRef = useRef(null)

  // Qué panel tiene el formulario abierto. Son DOS y no un booleano suelto: el
  // panel de escritorio se pinta con `{activeConv && …}`, y `activeConv` sale de
  // un `find` sobre `convs` que se recalcula en CADA sondeo. Si un ciclo deja
  // fuera el chat activo, ese panel se desmonta y remonta, y su limpieza manda un
  // "false" mientras el cajón sigue con el formulario abierto. Con un booleano,
  // ese "false" apagaba el guard y volvíamos a descartar pedidos sin preguntar.
  const manualesRef = useRef({ escritorio: false, cajon: false })
  // Espejo en estado del mapa de arriba. El ref es el que manda en el guard
  // (hay que leerlo dentro del click, sin esperar a un render), pero un efecto no
  // puede reaccionar a un ref: esto es solo para enganchar y soltar el aviso de
  // `beforeunload` de las navegaciones duras.
  const [hayManualAbierto, setHayManualAbierto] = useState(false)

  // Qué panel está MIRANDO un pedido (VER PEDIDO, solo lectura). Va en un mapa
  // aparte del de arriba y NO entra en `hayQueConfirmarDescarte` a propósito:
  // ahí no hay nada escrito que perder, así que preguntar "¿lo descartas?" al
  // cerrarlo o al cambiar de chat sería molestar de gusto — y un aviso que
  // molesta de gusto se aprende a ignorar, que es como se pierde el que sí
  // importa. Lo ÚNICO que comparte con el formulario es el ancho del panel.
  const veresRef = useRef({ escritorio: false, cajon: false })
  // Espejo en estado de los DOS mapas: es lo que sube el piso del asa, y ese
  // piso hace falta con cualquiera de las dos vistas (el CRM se pasa a diseño de
  // celular por debajo de 768 px internos, mire uno o llene el otro). El aviso
  // de `beforeunload` NO usa este: ese sigue atado solo al formulario.
  const [hayAnchoPedido, setHayAnchoPedido] = useState(false)

  const recalcularAncho = useCallback(() => {
    setHayAnchoPedido(
      Object.values(manualesRef.current).some(Boolean) ||
      Object.values(veresRef.current).some(Boolean)
    )
  }, [])

  const anotarManuales = useCallback((mapa) => {
    manualesRef.current = mapa
    setHayManualAbierto(Object.values(mapa).some(Boolean))
    recalcularAncho()
  }, [recalcularAncho])

  const anotarVeres = useCallback((mapa) => {
    veresRef.current = mapa
    recalcularAncho()
  }, [recalcularAncho])

  // El ancho del panel, compartido por las dos vistas del CRM. Se llama DESPUÉS
  // de anotar el mapa correspondiente, porque para decidir si devolver el ancho
  // necesita ver el estado ya actualizado.
  const ajustarAnchoDelCrm = useCallback((abierto) => {
    if (abierto) {
      if (anchoPrevioRef.current === null) anchoPrevioRef.current = rightWidthRef.current
      // El ancho EXACTO del formulario, no "el que había si era mayor": si el
      // panel venía ancho, quedaba vacío a los lados y era justo la queja.
      setRightWidth(ANCHO_PEDIDO)
      return
    }
    // Si otro panel —o la otra vista— todavía tiene algo del CRM abierto, el
    // ancho se queda como está.
    if (Object.values(manualesRef.current).some(Boolean)) return
    if (Object.values(veresRef.current).some(Boolean)) return
    if (anchoPrevioRef.current !== null) {
      setRightWidth(anchoPrevioRef.current)
      anchoPrevioRef.current = null
      return
    }
    // Sin ancho guardado (lo abrió el otro panel): al menos volver al techo
    // normal, que si no el panel se queda más ancho de lo que el asa permite.
    setRightWidth(w => Math.min(ANCHO_MAX, w))
  }, [])

  const alPedidoManual = useCallback((donde, abierto) => {
    anotarManuales({ ...manualesRef.current, [donde]: abierto })
    ajustarAnchoDelCrm(abierto)
  }, [anotarManuales, ajustarAnchoDelCrm])

  // El camino de VER PEDIDO: ensancha igual y no toca `manualesRef`, o sea que
  // el guard ni se entera. Esa separación es todo el punto.
  const alVerPedido = useCallback((donde, abierto) => {
    anotarVeres({ ...veresRef.current, [donde]: abierto })
    ajustarAnchoDelCrm(abierto)
  }, [anotarVeres, ajustarAnchoDelCrm])

  // Una por instancia, y ESTABLES: `RightPanel` las tiene como dependencia de un
  // efecto, así que una función nueva en cada render lo dispararía a cada rato y
  // le pelearía el ancho al que esté arrastrando el asa.
  const alPedidoManualEscritorio = useCallback((abierto) => alPedidoManual('escritorio', abierto), [alPedidoManual])
  const alPedidoManualCajon      = useCallback((abierto) => alPedidoManual('cajon', abierto), [alPedidoManual])
  const alVerPedidoEscritorio    = useCallback((abierto) => alVerPedido('escritorio', abierto), [alVerPedido])
  const alVerPedidoCajon         = useCallback((abierto) => alVerPedido('cajon', abierto), [alVerPedido])

  /**
   * ¿Se puede soltar la conversación abierta? Decisión de Rodrigo: el asistente
   * del CRM son 4 pasos y un clic distraído en el chat de al lado no puede
   * tirarlos sin aviso. Devuelve false = quedarse donde estaba.
   *
   * Cuando el pedido se crea bien, `RightPanel` ya cerró el formulario antes de
   * esto, así que ahí no pregunta nada.
   */
  const puedoDejarLaConversacion = useCallback((destino) => {
    if (!hayQueConfirmarDescarte(manualesRef.current, activeRef.current, destino)) return true
    if (!window.confirm(AVISO_DESCARTAR_PEDIDO)) return false
    // Descartado: se limpia acá porque si el panel se DESMONTA (cerrar el chat,
    // cambiar de bandeja o de canal) no queda nadie que avise que se cerró.
    anotarManuales({ escritorio: false, cajon: false })
    return true
  }, [anotarManuales])

  // La ✕ del cajón móvil (y tocar fuera, que hace lo mismo) cierra el panel
  // derecho entero y con él el formulario. No es "cambiar de conversación", pero
  // para quien lo usa es el mismo gesto y se pierde lo mismo: pasa por el mismo
  // guard. Decisión de Rodrigo — preguntar en un caso y no en el otro se sentía
  // arbitrario.
  const cerrarCajonDerecho = useCallback(() => {
    if (!puedoDejarLaConversacion(null)) return
    setShowRight(false)
  }, [puedoDejarLaConversacion])

  // Las navegaciones DURAS —el 📊 que es un `<a href="/dashboard">` y el ↻ que
  // hace `location.reload()`, justo al pie de la lista de chats— se llevan la
  // página entera, y un `confirm` nuestro no las puede atrapar. El único que
  // llega a tiempo ahí es el aviso propio del navegador. Se engancha SOLO
  // mientras haya un formulario abierto: el resto del tiempo no molesta y no le
  // quita el bfcache a la app.
  useEffect(() => {
    if (!hayManualAbierto) return
    const alSalir = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [hayManualAbierto])

  // Los límites del asa, en una ref: el efecto de abajo se suscribe UNA vez (si
  // se volviera a montar, repetiría la restauración de localStorage y pisaría el
  // ancho), así que no puede leer el estado — los lee de acá en cada movimiento.
  //
  // Con el formulario abierto sube el PISO, no el techo: angostar de más metería
  // el ancho interno por debajo de 768 y el CRM se pasaría a su diseño de
  // celular a mitad de un pedido. Ensanchar no rompe nada (solo agrega vacío a
  // los lados), así que el techo sigue siendo el de siempre.
  const limitesRef = useRef({ min: ANCHO_MIN, max: ANCHO_MAX })
  useEffect(() => {
    limitesRef.current = hayAnchoPedido
      ? { min: ANCHO_MIN_PEDIDO, max: ANCHO_MAX }
      : { min: ANCHO_MIN,        max: ANCHO_MAX }
  }, [hayAnchoPedido])

  useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem('mandi_right_width') || '', 10)
      if (v >= ANCHO_MIN && v <= ANCHO_MAX) setRightWidth(v)
    } catch {}
    const clamp = (w) => Math.min(limitesRef.current.max, Math.max(limitesRef.current.min, w))
    const onMove = (e) => {
      const que = decidirArrastre({ arrastrando: resizingRef.current, botones: e.buttons })
      if (que === 'nada') return
      if (que === 'soltar') { onUp(); return }   // el mouseup se perdió: cortar acá
      const x = e.touches ? e.touches[0].clientX : e.clientX
      setRightWidth(clamp(window.innerWidth - x)) // panel pegado al borde derecho
    }
    const onUp = () => {
      if (!resizingRef.current) return
      resizingRef.current = false
      setArrastrando(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try { localStorage.setItem('mandi_right_width', String(rightWidthRef.current)) } catch {}
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    // Cinturones: el puntero se va de la página, la ventana pierde el foco
    // (alt+tab a mitad de arrastre) o el sistema cancela el toque. En los tres
    // casos el `mouseup`/`touchend` puede no llegar nunca.
    document.addEventListener('mouseleave', onUp)
    window.addEventListener('blur', onUp)
    window.addEventListener('touchcancel', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      document.removeEventListener('mouseleave', onUp)
      window.removeEventListener('blur', onUp)
      window.removeEventListener('touchcancel', onUp)
    }
  }, [])

  const startResize = (e) => {
    resizingRef.current = true
    setArrastrando(true)
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

  // El service worker avisa cuando llegó un push: refrescamos al instante en vez de
  // dejar el polling corriendo en segundo plano (que costaría llamadas de más). Sin
  // esto el contador de la pestaña nunca alcanzaba a subir, porque con la pestaña
  // oculta el polling está detenido y `convs` no cambia.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const onMsg = (ev) => { if (ev.data?.tipo === 'push-recibido') load() }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [load])

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

  // Cambiar de bandeja CIERRA el chat abierto: si no, al terminar de escribirle a un
  // cliente y pasar a "Pendientes" quedaba en pantalla la conversación anterior, que
  // ya no pertenece a esa bandeja. Se deja el panel del medio en blanco para elegir.
  const cambiarFiltro = (key) => {
    // Cierra el chat abierto → el PEDIDO MANUAL se perdería igual que al saltar
    // a otro cliente. Sin el formulario abierto esto no pregunta nada.
    if (!puedoDejarLaConversacion(null)) return
    setFilter(key)
    setActive(null)
    activeRef.current = null
    setCitando(null)
  }

  /**
   * Cambiar de pestaña. Si se pasa de un número al otro se limpia TODO lo que
   * pertenece a la bandeja anterior: si quedara el chat abierto o los hilos en
   * memoria, se vería una conversación del otro número y la respuesta saldría
   * por el canal equivocado.
   */
  const cambiarLinea = (id) => {
    // Salir de la pestaña de chats desmonta el panel derecho entero (`esChat`),
    // así que el formulario también se pierde acá.
    if (id !== linea && !puedoDejarLaConversacion(null)) return
    const eraChat = linea === 'MANDI' || linea === 'REPUBLIC'
    const vaAChat = id === 'MANDI' || id === 'REPUBLIC'
    if (vaAChat && eraChat && id !== linea) {
      setCanalActivo(id)        // manda a api-client: lecturas y envíos van por acá
      setCanalArmado(id)        // el estado de React no puede quedar atrás del módulo
      setActive(null); activeRef.current = null
      setCitando(null)
      setConvs([]); setContacts({})
      hilosRef.current = {}     // hilos cargados del canal anterior
      pendingRef.current = {}   // burbujas optimistas del canal anterior
      setTimeout(load, 0)       // recarga ya, sin esperar al siguiente poll
    } else if (vaAChat && !eraChat) {
      setCanalActivo(id)
      setCanalArmado(id)        // idem: MANDI/REPUBLIC mandan sobre lo armado, no al revés
    } else if (id === CANAL_GENERAL) {
      // GENERAL no tiene número propio: la columna se pide sin filtro, pero el
      // canal armado se conserva para que el chat abierto siga respondiendo por
      // donde corresponde. Si no había ninguno, queda el principal — nunca null,
      // porque un envío con Canal vacío sale por el número equivocado.
      setCanalActivo(canalArmado || CANAL_POR_DEFECTO)
    }
    setLinea(id)
  }

  /**
   * Número por el que habla este contacto.
   *
   * ⚠️ ESTE ES EL ÚNICO LUGAR donde se decide el canal de una conversación. Lo
   * usan la línea de color de la fila Y el canal que se arma al abrir el chat
   * (openConv). Tienen que salir de acá los dos: si cada uno lo calculara por su
   * lado podrían discrepar, y entonces la línea diría un número mientras la
   * respuesta sale por el otro.
   *
   * La ficha del contacto es la fuente buena —es el mismo campo `phone_id` que
   * usa el cron para responder—. El último mensaje de la fila es el respaldo
   * para una conversación tan nueva que su ficha no llegó en el último sync.
   */
  const phoneIdDe = (tel) =>
    contacts[tel]?.phoneId || convs.find(c => c.telefono === tel)?.last?.phoneId || ''

  const openConv = (telefono) => {
    // Único paso obligado para cambiar de chat: lo usan la lista, CONTACTOS y el
    // salto desde un aviso push. Con esto acá, los tres quedan cubiertos.
    if (!puedoDejarLaConversacion(telefono)) return

    // ⚠️ ORDEN CRÍTICO: armar el canal ANTES de tocar `active`. El hilo se pide
    // con CANAL_ACTIVO (fetchHilo) y el envío inyecta Canal: getCanalActivo()
    // (postSaliente). Si esto corriera después, el primer hilo se pediría por
    // el canal anterior y una respuesta rápida saldría por el número equivocado.
    // `phoneIdDe` es el MISMO helper que pinta la línea de color de la fila
    // (Tarea 2): tiene que ser el mismo, porque si el color y el canal armado se
    // calcularan por separado podrían discrepar y la fila diría un número
    // mientras la respuesta sale por otro.
    //
    // Solo pisa el canal en GENERAL. En MANDI/REPUBLIC manda la pestaña, no el
    // contacto: la agenda se pide SIN filtro de canal (getContactos(null) en
    // /api/inbox-sync) y una fila es UNA sola por teléfono con el phone_id del
    // ÚLTIMO mensaje — un cliente que escribió a los dos números puede aparecer
    // en la columna de REPUBLIC con `phoneIdDe` devolviendo MANDI. Si esto
    // corriera también en pestañas de un solo número, abrir esa fila mixta
    // podría dejar CANAL_ACTIVO apuntando al número que NO es el de la pestaña
    // encendida.
    //
    // Asignación idempotente y sin condición contra `canalArmado`: lo que
    // importa es la verdad del envío (CANAL_ACTIVO, en el módulo), no si el
    // estado de React ya "cree" que está en ese canal — `cambiarLinea` puede
    // haber movido CANAL_ACTIVO sin que canalArmado se enterara.
    if (linea === CANAL_GENERAL) {
      const canal = canalDePhoneId(phoneIdDe(telefono))
      if (canal) {
        setCanalActivo(canal)
        setCanalArmado(canal)
        // El cache de hilos NO se bota acá: `hilosRef` está indexado por
        // teléfono, y cada TELÉFONO tiene una sola entrada de cache (no una por
        // canal). Para el cliente que escribió a los dos números, en GENERAL
        // ese cache puede mezclar mensajes de ambos phone_id bajo la misma
        // clave — es una limitación conocida, no una garantía de pureza de canal.
      }
    }

    setActive(telefono)
    activeRef.current = telefono
    setShowSidebar(false)
    setCitando(null)   // la cita pertenece al chat que estabas mirando
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

  // ── Abrir un chat puntual desde un aviso push ────────────────────────────────
  // Lo pide el service worker al tocar la notificación, o viene en ?tel= cuando el
  // aviso tuvo que abrir una ventana nueva. Se guarda el pedido y se resuelve cuando
  // la conversación esté cargada.
  const pedidoRef = useRef(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const tel = new URLSearchParams(window.location.search).get('tel')
    if (tel) pedidoRef.current = tel
    if (!('serviceWorker' in navigator)) return
    const onMsg = (ev) => {
      if (ev.data?.tipo === 'abrir-chat' && ev.data.tel) pedidoRef.current = ev.data.tel
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    const pedido = pedidoRef.current
    if (!pedido || !convs.length) return
    // El formato del webhook y el canónico de la base pueden diferir → últimos 9.
    const t9 = String(pedido).replace(/\D/g, '').slice(-9)
    const conv = convs.find(c => String(c.telefono).replace(/\D/g, '').slice(-9) === t9)
    if (!conv) return          // aún no llegó en este ciclo: reintenta al siguiente
    pedidoRef.current = null
    setLinea('MANDI')
    openConv(conv.telefono)
  }, [convs])

  // ── Alerta de leads 🔥 calientes cerca del cierre de la ventana de 24h ──
  // Dispara una notificación del navegador por lead y por ventana. El permiso ya no
  // se pide acá: Chrome silencia los pedidos sin gesto del usuario, así que ahora lo
  // pide el botón 🔔 (PushToggle) dentro de su click.
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
  // Pestaña "Ventas": entra por DOS caminos, y los dos hacen falta.
  //
  //   1. Tiene un PEDIDO CREADO (`idVenta`) — automático, lo pone el pedido.
  //   2. Está marcado a mano en 💰 Venta en proceso — la etapa del embudo.
  //
  // El segundo se había perdido: el rediseño de estados en 2 ejes (18-jul, 6c7fb5a)
  // lo quitó dando por hecho que "venta = tiene pedido". Pero así se trabaja de
  // verdad acá: 🔥 Caliente → 💰 Venta en proceso → 🟢 Atendido o ⚫ Archivado
  // cuando el pedido ya se entregó. Sin el paso del medio no hay dónde poner al
  // cliente que ya dijo que sí pero cuyo pedido todavía no existe en el CRM.
  //
  // Se conservan los dos porque miden cosas distintas: uno es "hay plata
  // comprometida en el sistema", el otro es "estoy cerrando esto ahora".
  const esVentaActiva = (tel) => (hasVenta(tel) || getStatus(tel) === 'venta') && getStatus(tel) !== 'archivado'
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

  /**
   * Pone `tarea` al final de la fila de ese chat y devuelve su promesa.
   * Si la fila está vacía (el caso normal) arranca al instante: esto no agrega
   * demora, solo impide que dos envíos al MISMO cliente se pisen.
   */
  const encolar = (telefono, tarea) => {
    const anterior = colaRef.current[telefono] || Promise.resolve()
    const actual   = anterior.then(tarea)   // `anterior` nunca rechaza: se guarda ya "atrapada"
    const marca    = actual.catch(() => {}) // un envío que falla no debe trabar la fila
    colaRef.current[telefono] = marca
    setColaLen(p => ({ ...p, [telefono]: (p[telefono] || 0) + 1 }))
    marca.then(() => {
      // Limpiar cuando esta tarea era la última: si no, quedaría una promesa por contacto.
      if (colaRef.current[telefono] === marca) delete colaRef.current[telefono]
      setColaLen(p => {
        const n = (p[telefono] || 1) - 1
        const c = { ...p }
        if (n > 0) c[telefono] = n; else delete c[telefono]
        return c
      })
    })
    return actual
  }

  // ── Enviar texto ──────────────────────────────────────────────
  const handleSend = async (text) => {
    const t = (text || input).trim()
    if (!t || !activeConv) return
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const estadoDestino = estadoAlResponder(currentStatus)
    // Se toma la cita ANTES de limpiarla: si el envío espera turno en la fila, la
    // barra ya no está pero el wamid citado tiene que viajar igual.
    const citaId = citando?.id || ''
    // El input se limpia YA aunque el mensaje espere turno: el vendedor sigue
    // escribiendo el siguiente sin quedarse mirando el cursor.
    setInput(''); setToast(null); setCitando(null); autoScroll.current = true

    return encolar(telefono, async () => {
      // La burbuja optimista se pinta cuando REALMENTE le toca salir, no al hacer
      // clic: así el hilo en pantalla queda en el mismo orden en que llega al cliente.
      const tmpMsg = {
        id: 'tmp_' + Date.now(), telefono, nombre, mensaje: t,
        direccion: 'SALIENTE', timestamp: new Date().toISOString(), estado: 'enviado',
        contextoId: citaId,   // para que la burbuja optimista ya muestre la cita
      }
      setConvs(prev => prev.map(c =>
        c.telefono === telefono ? { ...c, msgs: [...c.msgs, tmpMsg], last: tmpMsg } : c
      ))
      // Registrar como pendiente para que sobreviva a los polls hasta que se registre
      pendingRef.current[telefono] = [...(pendingRef.current[telefono] || []), tmpMsg]
      // Dar tiempo a React para renderizar el tmpMsg antes de hacer el fetch
      await new Promise(r => setTimeout(r, 0))
      const [result] = await Promise.all([
        sendReply(telefono, nombre, t, citaId),
        changeStatus(telefono, estadoDestino),
      ])
      // El mensaje salió, pero Meta rechazó la cita (mensaje viejo). Se avisa en vez
      // de que el vendedor crea que respondió citando y el cliente vea un texto suelto.
      setToast(result?.citaOmitida
        ? { ok: true, msg: '✓ Enviado, pero SIN la cita: WhatsApp ya no reconoce ese mensaje' }
        : result)
      setTimeout(() => setToast(null), 4000)
      setTimeout(load, 4000)
    })
  }

  // Desde RightPanel: enviar texto o copiar al input. Va por la fila del chat, así
  // no se cuela en medio de una respuesta rápida que todavía está saliendo.
  const handleSendText = async (text, copyToInput) => {
    if (copyToInput !== undefined) { setInput(copyToInput); return }
    const t = String(text || '').trim()
    if (!t || !activeConv) return
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const estadoDestino = estadoAlResponder(currentStatus)
    return encolar(telefono, async () => {
      await enviarTextoSuelto(telefono, nombre, t)
      changeStatus(telefono, estadoDestino)
      setTimeout(load, 4000)
    })
  }

  const handleKey = (e) => {
    // Ctrl+Enter o Cmd+Enter = enviar | Enter solo = salto de línea
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Enviar imagen ─────────────────────────────────────────────
  // Recibe teléfono y nombre en vez de leerlos de `activeConv`: los envíos ya no
  // bloquean la interfaz, así que el vendedor puede cambiar de chat mientras una
  // respuesta rápida sigue saliendo — y las fotos que faltaban se irían al chat
  // equivocado si esta función mirara la conversación "actual".
  // `mediaId` (opcional) viene pre-resuelto por precacheMedia: con él, el servidor
  // no descarga ni sube nada y la foto sale en milisegundos.
  const sendImageUrl = async (telefono, nombre, imageUrl, mediaId = '') => {
    // OJO: esta función habla con /api/saliente por su cuenta, sin pasar por
    // postSaliente de lib/api-client — que es donde se inyecta el canal. Por eso
    // el `Canal` va explícito acá: sin él las fotos salían por el número
    // principal aunque estuvieras en la bandeja del otro.
    const res = await fetch('/api/saliente', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Telefono: telefono, Nombre: nombre, ImagenURL: imageUrl,
        Canal: getCanalActivo(),
        ...(mediaId ? { ImagenMediaId: mediaId } : {}),
      }),
    })
    // Si la foto no se pudo enviar (p. ej. pesa más de los 5 MB que acepta
    // WhatsApp), decirlo: antes moría en Meta y nadie se enteraba.
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setToast({ ok: false, msg: `✗ ${data?.error || 'No se pudo enviar la foto'}` })
      setTimeout(() => setToast(null), 6000)
    }
    return res.ok
  }

  // Mandar UN archivo de imagen al chat. Es el camino de fotos del inbox, tal
  // cual estaba escrito dentro del bucle de handleSendImage: primero la url
  // permanente en NUESTRO Supabase Storage (para que la burbuja del hilo tenga
  // qué pintar) y después el envío por media id. Si la subida falla NO se
  // cancela: el envío real va por media id igual.
  //
  // Se sacó a una función para poder REUSARLO desde la hoja del pedido que llega
  // del CRM (ver `handleEnviarHojaPedido`). Es el mismo código de siempre, ni
  // una línea distinta: no hay dos formas de mandar una foto en este inbox.
  const subirYEnviarFoto = async (telefono, nombre, file) => {
    let url = ''
    try {
      const fd = new FormData(); fd.append('file', file)
      const res  = await fetch('/api/upload-foto', { method:'POST', body:fd })
      const data = await res.json()
      if (res.ok && data.url) url = data.url
    } catch { /* seguimos por media id */ }
    return sendImageFile(telefono, nombre, file, url)
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
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const estadoDestino = estadoAlResponder(currentStatus)
    const archivos = imgFiles
    setImgUploading(true); setImgResult(null); setImgProgress(0)
    try {
      // Toda la tanda entra como UNA sola tarea en la fila: las fotos del computador
      // tampoco deben intercalarse con las de una respuesta rápida en curso.
      await encolar(telefono, async () => {
      let allOk = true
      let sendErr = ''
      if (isVideo) {
        const result = await sendVideo(telefono, nombre, archivos[0].file)
        allOk = result.ok
        if (!result.ok) sendErr = result.error || ''
      } else {
        for (let i = 0; i < archivos.length; i++) {
          // La url permanente en NUESTRO Storage + el envío por media id: los dos
          // pasos viven en `subirYEnviarFoto` (arriba), que es de donde salieron
          // y donde está explicado el porqué de cada uno.
          const { ok } = await subirYEnviarFoto(telefono, nombre, archivos[i].file)
          if (!ok) allOk = false
          setImgProgress(i + 1)
          if (i < archivos.length - 1) await new Promise(r => setTimeout(r, 800))
        }
      }
      setImgResult({ ok: allOk, error: sendErr })
      await changeStatus(telefono, estadoDestino)
      })
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

  // Burbuja optimista + envío de texto. Se usa DENTRO de una tarea ya encolada
  // (no encola por su cuenta), para que el texto de una respuesta rápida y sus
  // fotos cuenten como un solo bloque indivisible en la fila.
  const enviarTextoSuelto = async (telefono, nombre, texto) => {
    const tmpMsg = {
      id: 'tmp_' + Date.now(), telefono, nombre, mensaje: texto,
      direccion: 'SALIENTE', timestamp: new Date().toISOString(), estado: 'enviado',
    }
    setConvs(prev => prev.map(c => c.telefono === telefono ? { ...c, msgs: [...c.msgs, tmpMsg], last: tmpMsg } : c))
    pendingRef.current[telefono] = [...(pendingRef.current[telefono] || []), tmpMsg]
    return sendReply(telefono, nombre, texto)
  }

  // ── Quick reply con imagen ────────────────────────────────────
  // `onProgress(hechas, total)` deja que el botón muestre "2/5" sin que el panel
  // tenga que esperar a que termine todo.
  const handleQuickReply = async (reply, onProgress) => {
    if (!activeConv) return
    // Se congelan acá: el vendedor puede cambiar de chat mientras esto sale.
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const estadoDestino = estadoAlResponder(currentStatus)

    const imgs = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? reply.imageUrl : reply[`imageUrl${i + 1}`]
    ).filter(Boolean)

    const total = (reply.text ? 1 : 0) + imgs.length
    let hechas = 0
    const avanzar = () => { hechas += 1; onProgress?.(hechas, total) }

    // Arranca YA la resolución de las fotos a media id, las N en paralelo, y FUERA
    // de la fila a propósito: aunque esta respuesta rápida tenga que esperar turno,
    // sus fotos se van preparando mientras tanto y cuando le toque salir ya están
    // listas. La segunda vez esto responde de la caché y es instantáneo; antes cada
    // foto se descargaba y se subía a Meta recién en su turno.
    const idsPromesa = imgs.length ? precacheMedia(imgs) : Promise.resolve({})

    // Toda la respuesta rápida es UNA tarea: nada puede meterse entre su texto y
    // sus fotos, ni entre una foto y la siguiente.
    return encolar(telefono, async () => {
    const botones = (reply.botones || []).filter(Boolean).slice(0, 3)
    if (botones.length && reply.text) {
      // Respuesta rápida CON botones interactivos → mensaje + botones
      const validBtns = botones.map((t, i) => ({ id: `btn_${i + 1}`, title: t }))
      // El servidor guarda SOLO el cuerpo en `mensaje`; los botones van aparte en `botones`.
      // Así el texto optimista coincide con el guardado y la reconciliación descarta el
      // temporal (sin duplicar), mientras la burbuja pinta los botones desde `botones`.
      const tmpMsg = { id: 'tmp_' + Date.now(), telefono, nombre, mensaje: reply.text, botones: validBtns, direccion: 'SALIENTE', timestamp: new Date().toISOString(), estado: 'enviado' }
      setConvs(prev => prev.map(c => c.telefono === telefono ? { ...c, msgs: [...c.msgs, tmpMsg], last: tmpMsg } : c))
      pendingRef.current[telefono] = [ ...(pendingRef.current[telefono] || []), tmpMsg ]
      await sendInteractiveButtons(telefono, nombre, reply.text, validBtns)
      avanzar()
    } else if (reply.text) {
      await enviarTextoSuelto(telefono, nombre, reply.text)
      avanzar()
    }

    // Envía las imágenes en orden (WhatsApp respeta el orden de llegada). La pausa
    // era de 800 ms cuando cada envío tardaba segundos; ahora que van por media id
    // alcanza con un respiro corto.
    const ids = await idsPromesa
    for (let i = 0; i < imgs.length; i++) {
      await sendImageUrl(telefono, nombre, imgs[i], ids[imgs[i]] || '')
      avanzar()
      if (i < imgs.length - 1) await new Promise(r => setTimeout(r, 150))
    }

    changeStatus(telefono, estadoDestino)
    setTimeout(load, 4000)
    })
  }

  // ── Enviar foto de producto (Tienda: Shopify / sucursal) ─────
  // Las fotos del catálogo también tienen URL fija, así que la primera vez que se
  // manda un producto queda su media id en caché y a partir de ahí sale al toque.
  // Va por la fila: si hay una respuesta rápida saliendo, esta foto espera a que
  // termine en vez de meterse en el medio.
  const handleSendAIImage = async (imageUrl) => {
    if (!activeConv || !imageUrl) return
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const estadoDestino = estadoAlResponder(currentStatus)
    return encolar(telefono, async () => {
      const ok = await sendImageUrl(telefono, nombre, imageUrl)
      if (ok) changeStatus(telefono, estadoDestino)
    })
  }

  /**
   * Producto de la Tienda: 'foto' manda solo la imagen, 'info' manda título+precio
   * y después la imagen. Los dos mensajes van como UNA tarea de la fila — si fueran
   * dos, algo clickeado en el medio podría meterse entre el título y su foto.
   */
  const handleSendProducto = async (p, modo = 'foto') => {
    if (!activeConv || !p) return
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const estadoDestino = estadoAlResponder(currentStatus)
    return encolar(telefono, async () => {
      if (modo === 'info') {
        await enviarTextoSuelto(telefono, nombre, `${p.title}${p.price ? ` — $${p.price}` : ''}`)
      }
      const ok = await sendImageUrl(telefono, nombre, p.image)
      if (ok) changeStatus(telefono, estadoDestino)
      setTimeout(load, 4000)
    })
  }

  /**
   * La hoja del pedido, al chat del cliente, como foto.
   *
   * ⚠️ DE DÓNDE SALE LA IMAGEN: la dibuja el CRM. La pantalla del pedido abierta
   * en el panel (un iframe de `crm.apps.mandarinaec.com`) tiene un botón
   * «📤 Enviar al cliente» que arma la hoja como JPG y la manda por
   * `postMessage`. El inbox no la genera: la recibe ya hecha. Quién valida ese
   * mensaje —y por qué hay que validarlo tan en serio, siendo de otro dominio—
   * está en `leerHojaPedido` (lib/pedido-manual) y en `VerPedido`.
   *
   * De acá para abajo NO hay nada nuevo: la hoja se vuelve un archivo igual al
   * que da el 📎 y sale por `subirYEnviarFoto`, el mismo camino de todas las
   * fotos del inbox. Va por la fila del chat, así que si hay una respuesta
   * rápida saliendo, espera su turno en vez de meterse en el medio.
   *
   * Devuelve `{ ok, error }` y el panel lo pinta. Nunca `undefined` en silencio:
   * un fallo mudo deja al vendedor creyendo que el cliente ya tiene la hoja.
   */
  const handleEnviarHojaPedido = async (hoja) => {
    if (!activeConv) return { ok: false, error: 'No hay un chat abierto' }
    if (!hoja?.imagen)  return { ok: false, error: 'No llegó la imagen de la hoja' }
    // Fuera de las 24 h WhatsApp no deja mandar una foto y Meta la rechaza sin
    // decir mucho. Mejor decirlo acá, con el nombre de la causa.
    if (!windowOpen) return { ok: false, error: 'la ventana de 24 h está cerrada' }
    const peso = bytesDeDataUrl(hoja.imagen)
    if (peso > MAX_HOJA_BYTES) {
      return { ok: false, error: `la hoja pesa ${(peso / 1048576).toFixed(1)} MB y WhatsApp acepta hasta 5 MB` }
    }
    // El chat es el que está abierto, que es el mismo del pedido que se está
    // mirando: `RightPanel` cierra VER PEDIDO al cambiar de teléfono, así que
    // esta vista no puede sobrevivir a un cambio de cliente.
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const estadoDestino = estadoAlResponder(currentStatus)
    return encolar(telefono, async () => {
      let archivo
      try {
        archivo = archivoDesdeDataUrl(hoja.imagen, `pedido-${hoja.pedidoId}.jpg`)
      } catch {
        return { ok: false, error: 'la imagen llegó dañada' }
      }
      const res = await subirYEnviarFoto(telefono, nombre, archivo)
      if (res?.ok) {
        await changeStatus(telefono, estadoDestino)
        setTimeout(load, 4000)
        return { ok: true }
      }
      return { ok: false, error: res?.error || 'WhatsApp no aceptó la foto' }
    })
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
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const cuerpo   = input.trim()
    const estadoDestino = estadoAlResponder(currentStatus)
    setSendingBtns(true)
    setInput(''); setBtnTexts(['','','']); setShowBtnPanel(false)
    return encolar(telefono, async () => {
      // El servidor guarda SOLO el cuerpo en `mensaje`; los botones van aparte en `botones`
      // (columna M / campo Supabase). Con el texto igual al guardado, la reconciliación
      // descarta el temporal sin duplicar, y la burbuja pinta los botones desde `botones`.
      const tmpMsg = {
        id:'tmp_'+Date.now(), telefono, nombre,
        mensaje:cuerpo, botones:validBtns,
        direccion:'SALIENTE', timestamp:new Date().toISOString(), estado:'enviado',
      }
      setConvs(prev=>prev.map(c=>c.telefono===telefono?{...c,msgs:[...c.msgs,tmpMsg],last:tmpMsg}:c))
      pendingRef.current[telefono] = [...(pendingRef.current[telefono] || []), tmpMsg]
      const result = await sendInteractiveButtons(telefono, nombre, cuerpo, validBtns)
      setSendingBtns(false)
      setToast(result)
      setTimeout(()=>setToast(null),4000)
      if (result.ok) {
        await changeStatus(telefono, estadoDestino)
        setTimeout(load,4000)
      }
    })
  }

  const currentContact = activeConv ? contacts[activeConv.telefono] : null
  // Cuántos envíos hay saliendo o esperando turno en el chat abierto.
  const enFila = activeConv ? (colaLen[activeConv.telefono] || 0) : 0
  const currentStatus  = currentContact?.estado || 'pendiente'
  const currentStatusView = activeConv ? getStatus(activeConv.telefono) : 'pendiente'
  const displayName    = (tel) => contacts[tel]?.alias || convs.find(c=>c.telefono===tel)?.nombre || tel

  return (
    <>
      {/* Va lo primero y fuera de todo layout: es fixed y tiene que verse aunque
          la pantalla esté en cualquier pestaña o con el cajón móvil abierto. */}
      <AvisoSesion />
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
          /* Los cajones arrancan DEBAJO de la barra de pestañas (alto 38px, z-index
             200), no en top:0. Si no, la barra tapa la cabecera del sidebar (logo,
             "En vivo", botones). El env() suma el notch cuando aplica. */
          .sidebar{ position:fixed !important; left:0; top:calc(38px + env(safe-area-inset-top, 0px)); bottom:0; z-index:100; width:100% !important; max-width:100% !important; box-shadow:4px 0 32px rgba(0,0,0,.6); transform:translateX(-100%); transition:transform .25s ease; }
          .sidebar.open{ transform:translateX(0); }
          .right-col{ position:fixed !important; right:0; top:calc(38px + env(safe-area-inset-top, 0px)); bottom:0; z-index:100; width:88% !important; max-width:300px; box-shadow:-4px 0 32px rgba(0,0,0,.6); animation:slideR .25s ease; }
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
      {showRight            && <div className="overlay" onClick={cerrarCajonDerecho} />}

      {/* ⚠️ Capa transparente que TAPA EL IFRAME mientras se arrastra el asa.
          Sin esto, al pasar el puntero sobre el formulario del CRM —que es un
          iframe de otro origen— los eventos del mouse se los queda el documento
          del CRM: el panel deja de seguir al asa y, peor, si se suelta el botón
          ahí el `mouseup` no llega nunca. El arrastre se quedaba pegado y
          después mover el mouse sin apretar nada redimensionaba el panel.
          Con la capa puesta, el puntero nunca entra al iframe y el `mouseup`
          siempre cae en nuestro documento. */}
      {arrastrando && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:9999, cursor:'col-resize' }} />
      )}

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
            // Los dos primeros son NÚMEROS (canales), no aplicaciones distintas:
            // comparten la vista de chat. El contador de pendientes es lo que
            // impide que la bandeja que no estás mirando se vuelva invisible.
            ...CANALES.map(c => ({
              id: c.id, label: c.etiqueta, icon:'💬', color: c.color, sub: c.sub,
              badge: pendientes[c.phoneId] || 0, title: c.titulo,
            })),
            { id:'SOCIAL',   label:'SOCIAL',   icon:'🌐', color:'#1877F2', sub:'FB · IG' },
            { id:'CONTACTOS',label:'CONTACTOS',icon:'👥', color:'#38bdf8', sub:'Directorio' },
            { id:'AUTO',     label:'AUTOS',    icon:'⚙️', color:'#f59e0b', sub:'Reglas' },
          ].map(({ id, label, icon, color, sub, badge = 0, title }) => (
            <button key={id} onClick={() => cambiarLinea(id)} title={title || label} style={{
              padding:'4px 16px', border:'none', cursor:'pointer', flexShrink:0, whiteSpace:'nowrap',
              background: linea===id ? `${color}15` : 'transparent',
              borderBottom: linea===id ? `2px solid ${color}` : '2px solid transparent',
              borderTop: '2px solid transparent',
              fontFamily:'Outfit,sans-serif', transition:'all .2s', height:'100%',
            }}>
              <div style={{ fontSize:10, fontWeight:800, color: linea===id ? color : '#334155', letterSpacing:'1.5px', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                <span>{icon} {label}</span>
                {badge > 0 && (
                  <span style={{
                    background:'#f87171', color:'#fff', borderRadius:9, minWidth:16, height:16,
                    display:'inline-flex', alignItems:'center', justifyContent:'center',
                    fontSize:9, fontWeight:900, padding:'0 4px', letterSpacing:0,
                  }}>{badge}</span>
                )}
              </div>
              <div style={{ fontSize:8, color: linea===id ? color+'80' : '#2a3f55', letterSpacing:'1px' }}>{sub}</div>
            </button>
          ))}
        </div>

        {/* ══════ CONTENIDO ══════ */}
        <div className="app-shell" style={{ flex:1, minHeight:0, height:0 }}>

        {/* ══════ MANDI (API) ══════ */}
        {esChat && (<>
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
                {/* Por `cambiarLinea` y no por `setLinea` a pelo: salir de la
                    pestaña de chats desmonta el panel derecho y tiraría el
                    PEDIDO MANUAL en silencio. Es el mismo salto, con el guard. */}
                <button onClick={() => cambiarLinea('AUTO')} title="Mensajes de saludo (automatizaciones)" style={{ background:'rgba(245,158,11,.14)', border:'1px solid rgba(245,158,11,.35)', color:'#f59e0b', borderRadius:8, width:28, height:28, cursor:'pointer', fontSize:13 }}>👋</button>
                <PushToggle />
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
                <button key={key} onClick={() => cambiarFiltro(key)} style={{
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
                <button key={key} onClick={() => cambiarFiltro(key)} style={{
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
                  colorCanal={colorDeCanal(phoneIdDe(conv.telefono))}
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
                  { s:'venta',     icon:'💰', label:'Venta en proceso', shortLabel:'💰', activeColor:'#10b981' },
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
                    <MessageBubble msg={msg} allMsgs={activeConv.msgs} onResponder={setCitando} />
                  </div>
                )
              })}
              {enFila > 0 && (
                <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:4 }}>
                  <div style={{ background:'#0d4f3c', borderRadius:'18px 18px 4px 18px', padding:'9px 14px', border:'1px solid rgba(37,211,102,.1)' }}>
                    <span style={{ color:'#25d366', fontSize:12, animation:'blink 1s infinite' }}>
                      {enFila > 1 ? `Enviando... (${enFila} en fila)` : 'Enviando...'}
                    </span>
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
              {/* Fila de escritura: la caja se lleva casi todo el ancho y solo el ➤ la
                  acompaña. Adjuntar/botones/emojis bajaron a la fila de abajo porque
                  entre los tres se comían ~150px por la izquierda: con la caja tan
                  angosta una frase normal se partía en muchas líneas y la vista saltaba. */}
              <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
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

                {/* El aire de arriba y abajo lo pone el propio textarea (ver CAJA_AIRE), no
                    este contenedor: así la zona táctil de 44px es el textarea entero y no
                    queda un borde muerto que al tocarlo no enfoca nada. */}
                {/* ⚠️ `minWidth:0` NO es decorativo. Esta caja y el botón de enviar son
                    hermanos en una fila flex, y un hijo flex trae `min-width:auto`: no se
                    puede encoger por debajo de su contenido. Con el textarea vacío no se
                    nota, pero al CITAR un mensaje largo la barra de la cita estiraba esta
                    caja y empujaba el botón de enviar fuera de la fila, escondiéndolo a la
                    derecha bajo el panel — o sea que no se podía responder. */}
                <div style={{ flex:1, minWidth:0, background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:13, padding:'0 13px', position:'relative' }}>
                  {/* Barra de cita: qué mensaje se está respondiendo. Con ✕ para soltarlo. */}
                  {citando && (
                    <div style={{
                      display:'flex', alignItems:'center', gap:8, marginTop:8, marginBottom:8,
                      borderLeft:'3px solid #25d366', background:'rgba(0,0,0,.3)',
                      borderRadius:'0 8px 8px 0', padding:'5px 10px',
                    }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:10, fontWeight:700, color:'#25d366' }}>
                          Respondiendo a {citando.direccion === 'SALIENTE' ? 'ti' : (activeConv?.nombre || citando.telefono)}
                        </div>
                        <div style={{ fontSize:11, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {citando.mensaje || `[${citando.tipo || 'archivo'}]`}
                        </div>
                      </div>
                      <button onClick={() => setCitando(null)} title="Quitar la cita"
                        style={{ background:'transparent', border:'none', color:'#64748b', fontSize:15, cursor:'pointer', lineHeight:1, flexShrink:0 }}>✕</button>
                    </div>
                  )}
                  {/* Arranca en UNA línea (rows={1}); el alto real lo pone ajustarAlto. El
                      minHeight mantiene los 44px de zona táctil aunque la línea sea una
                      sola, y el padding la centra dentro. El scroll propio solo aparece
                      al pasarse de las 6 líneas del tope.
                      La tecla de envío NO se toca: Ctrl+Enter manda, Enter salta de línea.
                      Es deliberado, para que a nadie se le escape un mensaje a medio
                      escribir a un cliente real; por eso el placeholder sigue avisándolo,
                      pero corto: el texto largo envolvía a dos líneas en un celular de
                      360px y hacía ver la caja vacía del doble de alto. */}
                  <textarea ref={setTaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                    placeholder={getModoIA(activeConv?.telefono) ? '🤖 IA respondiendo automáticamente...' : 'Mensaje... (Ctrl+Enter envía)'}
                    rows={1}
                    style={{
                      width:'100%', background:'transparent', border:'none', outline:'none',
                      color:'#e2e8f0', fontSize:14, resize:'none', lineHeight:1.5,
                      display:'block', boxSizing:'border-box', padding:`${CAJA_AIRE}px 0`,
                      minHeight:CAJA_ALTO_MIN, maxHeight:CAJA_ALTO_MAX, overflowY:'auto',
                      scrollbarWidth:'thin',
                      scrollbarColor:'#25d366 #111c2a',
                    }} />
                </div>

                <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                  {(() => {
                    // UN SOLO botón de envío: si el panel de botones está abierto y hay
                    // botones con texto → manda CON botones; si no → manda solo texto.
                    const conBotones = showBtnPanel && btnTexts.some(t => t.trim())
                    // Ya NO se bloquea por tener envíos en curso: lo que se escriba
                    // ahora entra a la fila y sale después, en orden.
                    const busy = sendingBtns
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

              {/* Fila de herramientas, debajo de la caja y pegada a la izquierda.
                  El ➤ de enviar NO baja acá: se queda al costado derecho de la caja,
                  que es donde la mano ya lo busca. */}
              <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:8, flexWrap:'wrap' }}>
                <button onClick={() => fileRef.current?.click()} style={{ width:42, height:42, flexShrink:0, background:imgFiles.length?'rgba(37,211,102,.12)':'#111c2a', border:`1px solid ${imgFiles.length?'rgba(37,211,102,.3)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:17, display:'flex', alignItems:'center', justifyContent:'center', color:imgFiles.length?'#25d366':'#475569', transition:'all .15s', position:'relative' }} title="Adjuntar imagen o video">
                  📎
                  {imgFiles.length > 0 && <span style={{ position:'absolute', top:-4, right:-4, width:16, height:16, borderRadius:'50%', background:'#25d366', color:'#080d14', fontSize:8, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center' }}>{imgFiles.length}</span>}
                </button>
                <button onClick={() => setShowBtnPanel(p=>!p)} title="Botones interactivos" style={{ width:42, height:42, flexShrink:0, background:showBtnPanel?'rgba(37,211,102,.15)':'#111c2a', border:`1px solid ${showBtnPanel?'rgba(37,211,102,.4)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', color:showBtnPanel?'#25d366':'#475569', transition:'all .15s' }}>🔘</button>
                <button onClick={() => { setShowEmoji(p=>!p); setShowBtnPanel(false) }} title="Emojis" style={{ width:42, height:42, flexShrink:0, background:showEmoji?'rgba(245,158,11,.15)':'#111c2a', border:`1px solid ${showEmoji?'rgba(245,158,11,.4)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:20, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>😊</button>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display:'none' }} onChange={handleFileSelect} />
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
                onSendImage={handleSendAIImage} onSendProducto={handleSendProducto}
                onUpdateContact={handleUpdateContact}
                windowOpen={windowOpen}
                onPedidoManual={alPedidoManualEscritorio}
                onVerPedido={alVerPedidoEscritorio}
                onEnviarHojaPedido={handleEnviarHojaPedido}
              />
            </div>
          </div>
        )}
        {showRight && (
          <div className="right-col">
            <div style={{ display:'flex', justifyContent:'flex-end', padding:'10px 10px 0' }}>
              <button onClick={cerrarCajonDerecho} style={{ background:'transparent', border:'none', color:'#475569', cursor:'pointer', fontSize:17 }}>✕</button>
            </div>
            <RightPanel
              activeConv={activeConv}
              contactInfo={currentContact}
              onQuickReply={handleQuickReply}
              onSendText={handleSendText}
              onSendImage={handleSendAIImage} onSendProducto={handleSendProducto}
              onUpdateContact={handleUpdateContact}
              windowOpen={windowOpen}
              onPedidoManual={alPedidoManualCajon}
              onVerPedido={alVerPedidoCajon}
              onEnviarHojaPedido={handleEnviarHojaPedido}
            />
          </div>
        )}

        </>)}


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
