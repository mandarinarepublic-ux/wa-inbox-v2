'use client'
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { fmtTime } from '@/lib/utils'
import { estadoVentana } from '@/lib/social-ventana'
import RightPanel from '@/components/RightPanel'

// La caja de texto del compositor arranca en UNA línea y crece sola — MISMO patrón
// que el compositor de WhatsApp en components/App.jsx (líneas ~26-34), pero con sus
// propios números: acá el textarea usa fontSize 16 (no 14, para que el celular no
// haga zoom automático al enfocar el campo, cosa que ya traía este archivo antes de
// este cambio). 16 × lineHeight 1.5 = 24px por línea, más 10px de aire arriba y abajo
// (24 + 10×2 = 44, la misma zona táctil mínima de siempre). Tope: 6 líneas.
const CAJA_LINEA     = 24
const CAJA_AIRE      = 10
const CAJA_ALTO_MIN  = 44                                      // zona táctil, no se negocia
const CAJA_ALTO_MAX  = CAJA_LINEA * 6 + CAJA_AIRE * 2          // 164px ≈ 6 líneas

// ── CONFIG ──────────────────────────────────────────────────────────────────
// Los datos ya NO se leen de la hoja SOCIAL de Google Sheets: vienen de Supabase
// vía /api/social/lista (entrantes los ingesta Make → /api/social/ingest).

// ── HELPERS ──────────────────────────────────────────────────────────────────
const CHANNEL_META = {
  FB: { label: 'Facebook', color: '#1877F2', bg: 'rgba(24,119,242,.12)', icon: '📘' },
  IG: { label: 'Instagram', color: '#E1306C', bg: 'rgba(225,48,108,.12)', icon: '📸' },
}

// Vocabulario de bandeja (Eje 1) — el mismo de WhatsApp, en minúsculas, con los
// mismos iconos y colores de components/App.jsx (leídos de ahí, sin tocar ese
// archivo). 'venta' y 'soporte' NO aparecen en Comentarios: la venta y el lead se
// siguen en el DM, que es donde ocurren de verdad.
const STATUS_META = {
  pendiente: { icon:'🔴', label:'Pendiente', filterLabel:'🔴 Pendientes', color:'#f87171' },
  atendido:  { icon:'🟢', label:'Atendido',  filterLabel:'🟢 Atendidos',  color:'#4ade80' },
  venta:     { icon:'💰', label:'Venta',     filterLabel:'💰 Ventas',     color:'#10b981' },
  soporte:   { icon:'🎧', label:'Soporte',   filterLabel:'🎧 Soporte',    color:'#a78bfa' },
  archivado: { icon:'⚫', label:'Archivado', filterLabel:'⚫ Archivados', color:'#64748b' },
}
const FILTROS_MENSAJES    = ['pendiente', 'atendido', 'venta', 'soporte', 'archivado']
const FILTROS_COMENTARIOS = ['pendiente', 'atendido', 'archivado']

// Eje 2 (temperatura del lead): 100% manual, nada la cambia sola. Solo tiene
// sentido en Mensajes — un comentario público no es un lead que se "enfríe", el
// lead vive en el DM (ver restricciones.md).
const TEMPERATURAS = [
  { key:'caliente', icon:'🔥', label:'Caliente', color:'#f97316' },
  { key:'tibio',    icon:'🌤️', label:'Tibio',    color:'#fbbf24' },
  { key:'frio',     icon:'❄️', label:'Frío',     color:'#38bdf8' },
]
const TEMP_META = Object.fromEntries(TEMPERATURAS.map(t => [t.key, t]))

// Las dos bandejas: DÓNDE ESTÁS PARADO, no una etiqueta que hay que leer en cada
// fila. Un DM es privado y un comentario es público — confundirlos ya le costó al
// dueño escribir datos de entrega a la vista de cualquiera.
const BANDEJAS = [
  { key:'mensajes',    icon:'✉️', label:'Mensajes',    sub:'Privado — DM',  color:'#25d366' },
  { key:'comentarios', icon:'💬', label:'Comentarios', sub:'Público',       color:'#f59e0b' },
]

// Canal — selector ORTOGONAL a la bandeja y al filtro de estado (ver canalFiltro).
const CANALES = [
  { key:'todos', icon:'🌐', label:'Ambos' },
  { key:'FB',    icon:'📘', label:'FB' },
  { key:'IG',    icon:'📸', label:'IG' },
]

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

// ── EMOJI PICKER (COPIA DELIBERADA de components/App.jsx, líneas ~52-100) ────
// Es una COPIA, no algo compartido con App.jsx. Decisión del dueño: "al final
// es algo que no va a cambiar y es poco usado" — una lista de emojis estática
// tiene una deriva ~0, y compartirla obligaría a sacarla de App.jsx (que corre
// el WhatsApp de producción) para ganar nada. Si agregas o cambias un emoji,
// hazlo TAMBIÉN en App.jsx: quedan dos listas a propósito, no una por olvido.
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

// ── COMPONENTES ──────────────────────────────────────────────────────────────

function ChannelBadge({ channel }) {
  const meta = CHANNEL_META[channel] || CHANNEL_META.FB
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'1px 6px', borderRadius:5, fontSize:10, fontWeight:700, background: meta.bg, color: meta.color }}>
      {meta.icon} {channel}
    </span>
  )
}

// PÚBLICO/PRIVADO ya NO es un badge por fila: ahora es la bandeja en la que estás
// parado (ver BANDEJAS más abajo). Leer un badge en cada fila era exactamente el
// punto de error que el dueño reportó.

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pendiente
  return (
    <span style={{ padding:'1px 6px', borderRadius:5, fontSize:9, fontWeight:700, background: `${meta.color}26`, color: meta.color }}>
      {meta.icon} {meta.label}
    </span>
  )
}

// "Hace 3 s" en vez de "Sync 18:42:07": un reloj absoluto no le dice al vendedor si
// lo que tiene en pantalla es de recién o de hace rato.
function haceCuanto(desde, ahora = Date.now()) {
  const s = Math.max(0, Math.round((ahora - desde) / 1000))
  if (s < 60) return `Hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `Hace ${m} min`
  return `Hace ${Math.round(m / 60)} h`
}

// Vive aparte a propósito: así el tic de cada segundo repinta SOLO esta línea. Si el
// reloj fuera estado de SocialInbox, se repintarían también el hilo y el panel de la
// derecha —y volverían a correr sus efectos— una vez por segundo.
function SyncLabel({ lastSync, refrescando }) {
  const [, repintar] = useState(0)
  useEffect(() => {
    if (refrescando || !lastSync) return
    const t = setInterval(() => repintar(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [lastSync, refrescando])
  // #334155 sobre este fondo casi no se lee: era la única señal de que el botón había
  // hecho algo, y por eso el dueño lo daba por muerto.
  return (
    <span style={{ fontSize:10, fontWeight:600, color: refrescando ? '#25d366' : '#94a3b8' }}>
      {refrescando ? 'Actualizando…' : lastSync ? haceCuanto(lastSync.getTime()) : '—'}
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

// `filtroActivo` oculta el chip que solo repite el filtro activo: si estás
// mirando 🔴 Pendientes, las 20 filas dicen "Pendiente" — es ruido, y es EXACTO
// el patrón "hay que leer una etiqueta para saber algo" que el dueño reportó.
// Cada fila termina mostrando solo el eje que el filtro NO está fijando.
function ConvRow({ conv, isActive, onClick, filtroActivo }) {
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
          <span style={{ fontSize:9, color:'#334155', flexShrink:0 }}>{fmtTime(conv.last_time)}</span>
        </div>
        <div style={{ display:'flex', gap:4, marginBottom:3, alignItems:'center', flexWrap:'wrap' }}>
          <ChannelBadge channel={conv.canal} />
          {conv.status !== filtroActivo && <StatusBadge status={conv.status} />}
          {conv.temperatura && TEMP_META[conv.temperatura] && conv.temperatura !== filtroActivo && (
            <span title={`Lead ${TEMP_META[conv.temperatura].label}`} style={{ fontSize:11 }}>{TEMP_META[conv.temperatura].icon}</span>
          )}
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

// Solo http(s): la URL viene del payload de Meta, y un esquema raro (javascript:)
// en un enlace que el vendedor va a clickear no tiene por qué llegar a la pantalla.
const urlSegura = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '')

function MsgBubble({ msg, channel }) {
  const isUser = msg.from === 'user'
  const isMandi = msg.from === 'mandi'
  const meta = CHANNEL_META[channel] || CHANNEL_META.FB
  const imagen = urlSegura(msg.image)
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
        {imagen && (
          <a href={imagen} target="_blank" rel="noreferrer">
            <img src={imagen} alt="" style={{ maxWidth:'100%', borderRadius:8, marginBottom: msg.text ? 6 : 0, display:'block' }} />
          </a>
        )}
        {msg.text && <div>{msg.text}</div>}
        {msg.time && (
          <div style={{ fontSize:9, opacity:.5, marginTop:4, textAlign:'right' }}
               title={new Date(msg.time).toLocaleString('es-EC', { timeZone:'America/Guayaquil', dateStyle:'full', timeStyle:'short' })}>
            {fmtTime(msg.time)}
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
  // Bandeja = DÓNDE ESTÁS PARADO (mensajes privados o comentarios públicos), no una
  // etiqueta por fila. filter = el estado/temperatura dentro de esa bandeja, igual
  // que en App.jsx (un solo filtro activo, sin opción "Todas").
  const [bandeja, setBandeja]   = useState('mensajes')
  const [filter, setFilter]     = useState('pendiente')
  // Canal (FB/IG/Ambos) — ORTOGONAL al filtro de estado, no un chip más que
  // compita con él: así se puede ver "solo Instagram Y solo pendientes" a la
  // vez, algo que el viejo chip 💬/✉️ mezclado con el resto no permitía.
  const [canalFiltro, setCanalFiltro] = useState('todos') // 'todos' | 'FB' | 'IG'
  const [loading, setLoading]   = useState(true)
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [refrescando, setRefrescando] = useState(false)
  const [modoRespuesta, setModoRespuesta] = useState('privado') // comentarios: 'privado' | 'publico'
  const [isMobile, setIsMobile] = useState(false)
  const [mediaInfo, setMediaInfo] = useState(null) // publicación/anuncio que comentó el cliente
  const [subiendo, setSubiendo] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const fileRef = useRef(null)
  const textareaRef = useRef(null)
  const bottomRef = useRef(null)

  // La caja crece con lo que se escribe (ver CAJA_LINEA arriba). Vacía SIEMPRE mide
  // una línea: se fuerza en vez de medir porque Chrome suma el placeholder al
  // scrollHeight, y si algún día se alarga (el texto es dinámico: "Facebook" vs
  // "Instagram") no queremos que la caja vacía dependa de cuál de los dos es más largo.
  const ajustarAlto = useCallback((ta) => {
    if (!ta) return
    ta.style.height = 'auto'   // sin esto solo crecería, nunca volvería a achicarse
    ta.style.height = ta.value
      ? Math.min(ta.scrollHeight, CAJA_ALTO_MAX) + 'px'
      : CAJA_ALTO_MIN + 'px'
  }, [])

  // Ref de función, no useRef+efecto: el compositor entero se DESMONTA al cerrar el
  // chat (mostrarChat / selectedConv nulo, ver el JSX de abajo) y se vuelve a montar
  // al abrir otro — o el mismo, si el vendedor entra y sale del mismo hilo en el
  // celular. Un efecto por dependencias no vuelve a dispararse si `input` (el
  // borrador) no cambió, así que la caja aparecería en su alto mínimo con el
  // borrador largo adentro y scroll interno hasta tocar una tecla. Midiendo en
  // cuanto el <textarea> entra al DOM se cubren los dos casos.
  const setTaRef = useCallback((node) => { textareaRef.current = node; ajustarAlto(node) }, [ajustarAlto])

  // Recalcular cuando cambia el texto —incluido el que entra por código: emojis,
  // "copiar al input" del panel derecho, y el setInput('') al enviar, que devuelve
  // la caja a una línea— y al cambiar de conversación (`selected`), porque el
  // borrador de la conversación nueva puede ser de otro largo que el de la anterior.
  useLayoutEffect(() => { ajustarAlto(textareaRef.current) }, [input, selected, ajustarAlto])

  // Recalcular también al cambiar el ANCHO disponible: el mismo texto se re-parte en
  // más o menos líneas al rotar el celular. Mismo arreglo que en App.jsx.
  useEffect(() => {
    const alRedimensionar = () => ajustarAlto(textareaRef.current)
    window.addEventListener('resize', alRedimensionar)
    return () => window.removeEventListener('resize', alRedimensionar)
  }, [ajustarAlto])
  const pollRef   = useRef(null)
  const mediaCacheRef = useRef({}) // cache por media id → info de la publicación
  const backGuardRef = useRef(false) // móvil: entrada de historial empujada al abrir un chat
  // El poll de 8 s no puede pisar un cambio de estado/temperatura recién hecho —
  // mismo problema y mismo arreglo que `localStatusRef`/`localTempRef` en
  // components/App.jsx: un override local con vencimiento por conversación.
  const localEstadoRef = useRef({}) // { [convKey]: { estado, expiresAt } }
  const localTempRef   = useRef({}) // { [convKey]: { temperatura, expiresAt } }

  // El tipo entra en la llave: un comentario y un DM del mismo cliente son DOS
  // hilos (uno público, uno privado) y no pueden colapsar en una sola fila.
  const convKey = (c) => `${c.canal}__${c.tipo || 'DM'}__${c.sender_id}`

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/lista')
      const data = await res.json()
      if (Array.isArray(data)) {
        // Reaplicar los overrides locales vigentes ANTES de pintar: si el vendedor
        // acaba de marcar 🔥 Caliente o cambió de bandeja, la base puede no haber
        // terminado de guardar cuando este poll llega, y sin esto el valor viejo
        // "vuelve" a los 8 s.
        const now = Date.now()
        const conData = data.map(c => {
          const key = convKey(c)
          let fila = c
          const eo = localEstadoRef.current[key]
          if (eo && eo.expiresAt > now) fila = { ...fila, status: eo.estado }
          const to = localTempRef.current[key]
          if (to && to.expiresAt > now) fila = { ...fila, temperatura: to.temperatura }
          return fila
        })
        setConvs(conData)
        setLastSync(new Date())
      }
    } catch (e) {
      console.error('SocialInbox load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // El poll de 8 s ya trae todo solo; este botón sirve para cuando el vendedor acaba
  // de mandar algo y quiere confirmar YA que entró, sin esperar. Antes era imposible
  // notar que hiciera algo (misma carga silenciosa, y de señal un reloj gris casi
  // ilegible), así que el dueño lo daba por muerto. Ahora se ve trabajando y no se
  // puede disparar dos veces a la vez.
  const refrescar = useCallback(async () => {
    if (refrescando) return
    setRefrescando(true)
    // Mínimo visible: la carga puede tardar 200 ms y el "Actualizando…" pasaría como
    // un parpadeo — otra vez sin señal de que algo ocurrió.
    try { await Promise.all([load(), new Promise(r => setTimeout(r, 450))]) }
    finally { setRefrescando(false) }
  }, [load, refrescando])

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

  const selectedConv = convs.find(c => convKey(c) === selected) || null
  // CÓMO se responde. Meta pone dos relojes distintos y hay que respetarlos:
  //   · respuesta PRIVADA a un comentario → solo dentro de 7 días, y una sola vez
  //   · respuesta PÚBLICA a un comentario → sin límite de tiempo
  // Si el comentario ya venció, se contesta por DM (que tiene su propia ventana de
  // 24 h). Antes se intentaba siempre la privada y Meta devolvía un inútil
  // "An unknown error has occurred".
  const SIETE_DIAS = 7 * 24 * 3600 * 1000
  const ultimoDelCliente = selectedConv ? [...selectedConv.messages].reverse().find(m => m.from === 'user') : null
  const hayComentario = ultimoDelCliente?.tipo === 'COMENTARIO'
  const comentarioVigente = hayComentario && ultimoDelCliente.time &&
    (Date.now() - new Date(ultimoDelCliente.time).getTime()) < SIETE_DIAS
  // El selector privado/público solo tiene sentido si hay un comentario al que responder.
  const respondeComentario = hayComentario
  // Camino real del envío: al comentario si es público (siempre se puede) o si la
  // ventana privada sigue abierta. Si no, DM.
  const iraAlComentario = hayComentario && (modoRespuesta === 'publico' || comentarioVigente)
  // Ventana de 24 h de Meta para el DM, contada desde el ÚLTIMO MENSAJE DEL
  // CLIENTE (no desde el último saliente: si no, el vendedor cree que tiene
  // tiempo cuando ya se cerró).
  const ventana = estadoVentana(ultimoDelCliente?.time)
  const windowOpen = ventana.abierta

  // RightPanel habla el idioma de WhatsApp (telefono/nombre/msgs con direccion+timestamp).
  // Se traduce acá para no tocarlo — su interfaz no sabe nada de FB/IG. El prefijo del
  // canal en "telefono" evita que un sender_id de IG choque con uno de FB o de WhatsApp.
  const convParaPanel = selectedConv ? {
    telefono: `${selectedConv.canal}:${selectedConv.sender_id}`,
    nombre: selectedConv.nombre,
    // msgs:[] en un COMENTARIO es inofensivo por DOS razones distintas, no una: el
    // contador de 24h vive en el header FIJO de RightPanel (fuera de toda pestaña) y
    // con una lista vacía no encuentra ENTRANTE, así que no pinta el reloj; el
    // transcript de `crearPedido` (botón CREAR PEDIDO) sí está detrás de la pestaña
    // 'ventas', que SOCIAL nunca monta (ver `pestanas` más abajo). Si algún día se
    // habilita 'ventas' en SOCIAL, revisar ese transcript.
    msgs: selectedConv.tipo === 'COMENTARIO' ? [] : selectedConv.messages.map(m => ({
      direccion: m.from === 'user' ? 'ENTRANTE' : 'SALIENTE',
      timestamp: m.time,
      mensaje: m.text,
    })),
  } : null

  // Un envío suelto (texto O imagen) para las acciones del panel único. Dentro de la
  // ventana de 24 h no hay turnos: se pueden encadenar varios sin esperar al cliente.
  // Mismo criterio de ruteo que `handleSend`: `iraAlComentario` (no `selectedConv.tipo`
  // a secas) — un comentario con más de 7 días y modo privado ya NO va al endpoint de
  // comentario (Meta solo permite una respuesta privada, y venció), cae a DM normal.
  // Mandar tipo:'COMENTARIO' en ese caso hace que el servidor rechace con el inútil
  // "An unknown error has occurred" que ya se había arreglado para el compositor de texto.
  const enviarSocial = useCallback(async ({ texto, imagen }) => {
    if (!selectedConv) return
    const res = await fetch('/api/social/saliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_id: selectedConv.sender_id,
        canal: selectedConv.canal,
        tipo: iraAlComentario ? 'COMENTARIO' : 'DM',
        comment_id: iraAlComentario ? (ultimoDelCliente?.id || '') : '',
        modo: iraAlComentario ? modoRespuesta : 'privado',
        message: texto || '',
        imagen: imagen || '',
      }),
    })
    // /api/social/saliente ya valida (foto en comentario, LINKPAGO en público, etc.)
    // con mensajes entendibles: no se repiten esas reglas acá, solo se propaga el error.
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }, [selectedConv, iraAlComentario, ultimoDelCliente, modoRespuesta])

  // Respuesta rápida del panel: el texto y luego cada foto, en orden (Meta no admite
  // texto + adjunto en un mismo mensaje). Las fotos se descartan solo cuando el envío
  // va DE VERDAD al hilo público — el mismo criterio con el que `enviarSocial` elige
  // la ruta. Mirar `selectedConv.tipo` descartaba las fotos también en un comentario
  // vencido, que ya sale por DM privado: al cliente no se le podía mandar una foto sin
  // ninguna razón técnica que lo justificara.
  const onQuickReply = useCallback(async (reply, onProgress) => {
    const imgs = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? reply.imageUrl : reply[`imageUrl${i + 1}`]
    ).filter(Boolean)
    const soloTexto = iraAlComentario
    const aMandar = soloTexto ? [] : imgs
    const total = (reply.text ? 1 : 0) + aMandar.length
    let hechas = 0
    try {
      if (reply.text) { await enviarSocial({ texto: reply.text }); onProgress?.(++hechas, total) }
      for (const url of aMandar) { await enviarSocial({ imagen: url }); onProgress?.(++hechas, total) }
      if (soloTexto && imgs.length) {
        // Ahora este aviso solo aparece cuando el envío fue de verdad al hilo público,
        // que es donde "responde en privado" es cierto: si ya iba por DM, las fotos
        // salieron.
        alert('Es un comentario público: se mandó solo el texto. Responde en privado para poder mandar las fotos.')
      }
    } catch (e) {
      alert('❌ No se pudo enviar: ' + e.message)
    }
    load()
  }, [selectedConv, iraAlComentario, enviarSocial, load])

  // `RightPanel` acepta esta prop pero hoy no la invoca en ningún lado (tampoco en
  // WhatsApp: App.jsx la pasa igual, sin que nada la dispare todavía). Se deja cableada
  // por paridad de interfaz -es parte del panel único- y para que, si algún día se
  // agrega ahí un botón que la use, funcione en los tres canales sin otro parche.
  const onSendImage = useCallback(async (imageUrl) => {
    try { await enviarSocial({ imagen: imageUrl }) }
    catch (e) { alert('❌ No se pudo enviar la foto: ' + e.message) }
    load()
  }, [enviarSocial, load])

  // Producto del catálogo (pestaña Tienda, nunca en un hilo de comentario). RightPanel
  // manda (p, modo): 'foto' solo la imagen, 'info' primero título+precio y luego la
  // imagen. p.image/p.title/p.price son los mismos campos que usa handleSendProducto
  // en App.jsx (vienen de /api/tienda) — no "imagen/titulo/precio".
  const onSendProducto = useCallback(async (p, modo = 'foto') => {
    try {
      if (modo === 'info') {
        const detalle = [p.title, p.price ? `$${p.price}` : ''].filter(Boolean).join(' — ')
        if (detalle) await enviarSocial({ texto: detalle })
      }
      if (p.image) await enviarSocial({ imagen: p.image })
    } catch (e) { alert('❌ No se pudo enviar el producto: ' + e.message) }
    load()
  }, [enviarSocial, load])

  const onSendText = useCallback(async (texto, copiarAlInput) => {
    if (copiarAlInput) { setInput(texto); return }
    try { await enviarSocial({ texto }) }
    catch (e) { alert('❌ No se pudo enviar: ' + e.message) }
    load()
  }, [enviarSocial, load])

  // Foto suelta desde el computador (botón 📎 del compositor, solo en hilos privados).
  // Sube al bucket propio (inbox-media) y manda la URL. Meta la busca sola: en FB/IG
  // no hace falta subir la imagen a Meta primero, como sí exige WhatsApp.
  const onElegirFoto = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir la misma foto
    if (!file) return
    setSubiendo(true)
    try {
      const fd = new FormData()
      fd.append('file', file, file.name || 'imagen.jpg')
      const res = await fetch('/api/upload-foto', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!data.url) throw new Error(data.error || 'No se pudo subir la foto')
      await enviarSocial({ imagen: data.url })
      load()
    } catch (err) {
      alert('❌ ' + err.message)
    } finally {
      setSubiendo(false)
    }
  }, [enviarSocial, load])

  // Inserta el emoji en la POSICIÓN DEL CURSOR, no al final: si el vendedor
  // escribió "hola  cómo estás" con el cursor en medio, el emoji va ahí. Después
  // devuelve el foco al textarea con el cursor justo DESPUÉS del emoji insertado,
  // para poder seguir escribiendo sin tener que volver a tocar el campo.
  const insertarEmoji = (emoji) => {
    const ta = textareaRef.current
    if (!ta) { setInput(prev => prev + emoji); return }
    const inicio = ta.selectionStart ?? input.length
    const fin    = ta.selectionEnd ?? input.length
    setInput(input.slice(0, inicio) + emoji + input.slice(fin))
    // Después de re-renderizar el textarea con el valor nuevo (React es
    // controlado): recién ahí existe la posición nueva a la que mover el cursor.
    requestAnimationFrame(() => {
      ta.focus()
      const pos = inicio + emoji.length
      ta.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selected, convs])

  // Cambiar de conversación vuelve SIEMPRE a 'privado'. El modo es del hilo, no del
  // vendedor: si se quedara pegado, contestar un comentario en 🌎 Público dejaría el
  // siguiente hilo en público y lo que se mande ahí —el compositor y las respuestas
  // rápidas, que son las mismas de WhatsApp y piden nombre, cédula y dirección— se
  // publicaría a la vista de todos. Privado es el lado seguro.
  useEffect(() => {
    setModoRespuesta('privado')
  }, [selected])

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
    if (isMobile && !backGuardRef.current) {
      window.history.pushState({ social: 'chat' }, '')
      backGuardRef.current = true
    }
  }

  const goBack = () => {
    // Volver SIEMPRE a la lista de forma directa (no depender de popstate, que en
    // algunos webviews de celular no dispara). Si empujamos una entrada de historial
    // al abrir el chat, la consumimos para dejar el historial limpio.
    setSelected(null)
    if (backGuardRef.current) {
      backGuardRef.current = false
      try { window.history.back() } catch {}
    }
  }

  // Cambiar de filtro CIERRA el chat abierto: si no, el chat seleccionado puede
  // quedar en pantalla aunque ya no pertenezca al filtro nuevo (p.ej. tenías un
  // 🔴 Pendiente abierto y saltas a ⚫ Archivados). Mismo bug y mismo arreglo que
  // `cambiarFiltro` en components/App.jsx (commit da39001).
  const cambiarFiltro = (f) => {
    setFilter(f)
    setSelected(null)
  }

  // Mismo motivo que cambiarFiltro: aunque el canal es ortogonal al estado, si no
  // cierra el chat abierto uno de otro canal puede quedar en pantalla sin
  // pertenecer ya a lo que se está mirando.
  const cambiarCanal = (c) => {
    setCanalFiltro(c)
    setSelected(null)
  }

  // La bandeja separa PRIVADO de PÚBLICO por `tipo` (no una etiqueta a leer). Un
  // comentario y un DM del mismo cliente son dos hilos distintos (ver convKey).
  // El canal (FB/IG/Ambos) es un segundo recorte, independiente del estado: por
  // eso se aplica acá y no como una opción más de `filter`.
  const porBandeja = convs
    .filter(c => (bandeja === 'comentarios' ? c.tipo === 'COMENTARIO' : c.tipo !== 'COMENTARIO'))
    .filter(c => (canalFiltro === 'todos' ? true : c.canal === canalFiltro))
  const esTemp = (key) => TEMP_META[key] !== undefined
  // Un solo filtro activo a la vez (estado O temperatura), igual que en App.jsx —
  // sin opción "Todas": entrar a una bandeja arranca en 🔴 Pendientes, que es lo
  // que hay que atender.
  const filtered = porBandeja.filter(c => (esTemp(filter) ? c.temperatura === filter : c.status === filter))
  // Contadores para los chips de filtro, calculados sobre la bandeja actual (no
  // sobre TODAS las conversaciones): un comentario archivado no debe sumar al
  // contador de Archivados de Mensajes, ni al revés.
  const counts = {
    pendiente: porBandeja.filter(c => c.status === 'pendiente').length,
    atendido:  porBandeja.filter(c => c.status === 'atendido').length,
    venta:     porBandeja.filter(c => c.status === 'venta').length,
    soporte:   porBandeja.filter(c => c.status === 'soporte').length,
    archivado: porBandeja.filter(c => c.status === 'archivado').length,
    caliente:  porBandeja.filter(c => c.temperatura === 'caliente').length,
    tibio:     porBandeja.filter(c => c.temperatura === 'tibio').length,
    frio:      porBandeja.filter(c => c.temperatura === 'frio').length,
  }

  const handleSend = async () => {
    if (!input.trim() || !selectedConv || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    try {
      // Si lo último del cliente fue un COMENTARIO se responde al comentario (privado
      // por defecto, o público si el vendedor lo eligió). Si fue un DM, se contesta
      // el DM normal por PSID/IGSID.
      const res = await fetch('/api/social/saliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: selectedConv.sender_id,
          message: text,
          canal: selectedConv.canal,
          tipo: iraAlComentario ? 'COMENTARIO' : 'DM',
          comment_id: iraAlComentario ? (ultimoDelCliente?.id || '') : '',
          modo: iraAlComentario ? modoRespuesta : 'privado',
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        console.error('Send error:', data.error || res.status)
        setInput(text) // devolver el texto para reintentar
        alert('❌ No se pudo enviar: ' + (data.error || `HTTP ${res.status}`))
        return
      }
      // Optimistic update: agrega el saliente y marca 'atendido' (como en el server).
      // Vocabulario en minúsculas: en MAYÚSCULAS no calzaba con STATUS_META ni con
      // el filtro activo, y la fila se veía "sin bandeja" hasta el próximo poll.
      localEstadoRef.current[selected] = { estado: 'atendido', expiresAt: Date.now() + 15000 }
      setConvs(prev => prev.map(c =>
        convKey(c) === selected
          ? { ...c, status: 'atendido', messages: [...c.messages, { id: Date.now(), from: 'mandi', text, time: new Date().toISOString() }] }
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
    const { canal, sender_id, tipo } = selectedConv
    const key = selected
    const anterior = selectedConv.status
    // Override con vencimiento: sin esto el poll de 8s puede pisar este cambio con
    // el valor viejo si la base todavía no terminó de guardar (ver `load`).
    localEstadoRef.current[key] = { estado: nuevo, expiresAt: Date.now() + 15000 }
    // El update optimista toca UNA sola fila (convKey incluye el tipo), así que el
    // servidor tiene que filtrar por tipo también: si no, archivar un comentario
    // archivaba además el DM del cliente y la pantalla mentía hasta el próximo poll.
    setConvs(prev => prev.map(c => convKey(c) === selected ? { ...c, status: nuevo } : c))
    try {
      const res = await fetch('/api/social/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canal, sender_id, tipo: tipo || 'DM', estado: nuevo }),
      })
      // fetch solo rechaza por error de RED: un 400/500 llega aquí como respuesta
      // "normal" y sin este chequeo el fallo pasaba en silencio — la pantalla se
      // quedaba mostrando el cambio los 15s que dura el override y DESPUÉS el poll
      // lo devolvía al valor viejo sin avisar. Justo el síntoma "los botones no
      // funcionan" que esta tarea vino a arreglar.
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      console.error('Estado error:', e)
      delete localEstadoRef.current[key]
      setConvs(prev => prev.map(c => convKey(c) === selected ? { ...c, status: anterior } : c))
      alert('❌ No se pudo cambiar el estado — reintenta')
    }
  }

  // Eje 2 (temperatura): 100% manual. Clic de nuevo sobre la misma = quitarla
  // (toggle), igual que `changeTemperatura` en App.jsx. Solo se llama desde
  // Mensajes — el botón ni se pinta en Comentarios (ver cabecera del chat).
  const cambiarTemperatura = async (temp) => {
    if (!selectedConv) return
    const { canal, sender_id, tipo } = selectedConv
    const actual = selectedConv.temperatura || ''
    const nueva = actual === temp ? '' : temp
    const key = selected
    localTempRef.current[key] = { temperatura: nueva, expiresAt: Date.now() + 15000 }
    setConvs(prev => prev.map(c => convKey(c) === selected ? { ...c, temperatura: nueva } : c))
    try {
      // `temperatura: ''` es un valor válido ("sin clasificar"): /api/social/estado
      // ya distingue "no vino el campo" de "vino vacío", así que este POST sí quita
      // la marca en vez de rebotar con 400.
      const res = await fetch('/api/social/estado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canal, sender_id, tipo: tipo || 'DM', temperatura: nueva }),
      })
      // Mismo motivo que en cambiarEstado: un 400/500 no lanza por sí solo.
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      console.error('Temperatura error:', e)
      delete localTempRef.current[key]
      setConvs(prev => prev.map(c => convKey(c) === selected ? { ...c, temperatura: actual } : c))
      alert('❌ No se pudo cambiar la temperatura — reintenta')
    }
  }

  // Cambiar de bandeja cierra el chat abierto (mismo bug y mismo arreglo que
  // `cambiarFiltro`, arriba) y vuelve al filtro por defecto: si no, "💰 Ventas"
  // seguiría activo al entrar a Comentarios, una bandeja donde ese filtro no existe.
  const cambiarBandeja = (b) => {
    setBandeja(b)
    setFilter('pendiente')
    setSelected(null)
  }

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
          {/* Bandejas: DÓNDE ESTÁS PARADO, no una etiqueta por fila. Mismo peso visual
              que el selector MANDI/REPUBLIC/SOCIAL de App.jsx, a escala del sidebar. */}
          <div style={{ display:'flex', gap:4, marginBottom:8, borderRadius:9, overflow:'hidden', border:'1px solid #162030' }}>
            {BANDEJAS.map(({ key, icon, label, sub, color }) => (
              <button key={key} onClick={() => cambiarBandeja(key)} style={{
                flex:1, padding:'6px 4px', border:'none', cursor:'pointer', minWidth:0,
                background: bandeja===key ? `${color}18` : 'transparent',
                borderBottom: `2px solid ${bandeja===key ? color : 'transparent'}`,
                fontFamily:'Outfit,sans-serif', transition:'all .2s',
              }}>
                <div style={{ fontSize:11, fontWeight:800, color: bandeja===key ? color : '#334155', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {icon} {label}
                </div>
                <div style={{ fontSize:8, color: bandeja===key ? color+'a0' : '#2a3f55', whiteSpace:'nowrap' }}>{sub}</div>
              </button>
            ))}
          </div>

          {/* Canal (FB/IG/Ambos) — ORTOGONAL a la bandeja y al filtro de estado: se
              puede combinar "solo Instagram" CON "solo pendientes" a la vez, algo
              que un chip más en la fila de estado no permitía (competía por el
              mismo filtro en vez de cruzarse con él). */}
          <div style={{ display:'flex', gap:3, marginBottom:8 }}>
            {CANALES.map(({ key, icon, label }) => {
              const active = canalFiltro === key
              return (
                <button key={key} onClick={() => cambiarCanal(key)} style={{
                  flex:1, padding:'3px 4px', fontSize:9, fontWeight:700, borderRadius:6, cursor:'pointer',
                  background: active ? 'rgba(148,163,184,.15)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(148,163,184,.45)' : '#1a2d40'}`,
                  color: active ? '#cbd5e1' : '#334155',
                  fontFamily:'Outfit,sans-serif', transition:'all .15s',
                }}>{icon} {label}</button>
              )
            })}
          </div>

          {/* Franja fija (no un badge por fila): TODO lo que se ve en esta bandeja es
              público. Reemplaza al viejo badge 💬 PÚBLICO por fila — ver restricciones. */}
          {bandeja === 'comentarios' && (
            <div style={{ marginBottom:8, padding:'6px 9px', background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.3)', borderRadius:8, color:'#f59e0b', fontSize:10, fontWeight:700, textAlign:'center', lineHeight:1.4 }}>
              ⚠️ Público — sin fotos, catálogo, links de pago ni datos de entrega acá
            </div>
          )}

          {/* Fila 1 — BANDEJA de estado (Eje 1) */}
          <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
            {(bandeja === 'comentarios' ? FILTROS_COMENTARIOS : FILTROS_MENSAJES).map(key => {
              const meta = STATUS_META[key]
              const active = filter === key
              return (
                <button key={key} onClick={() => cambiarFiltro(key)} style={{
                  padding:'3px 7px', fontSize:9, fontWeight:700, borderRadius:6, cursor:'pointer',
                  background: active ? `${meta.color}22` : 'transparent',
                  border: `1px solid ${active ? meta.color+'60' : '#1a2d40'}`,
                  color: active ? meta.color : '#334155',
                  fontFamily:'Outfit,sans-serif', transition:'all .15s',
                }}>
                  {meta.filterLabel}
                  {counts[key] > 0 && <span style={{ marginLeft:3, background: active ? meta.color : '#1a2d40', color: active ? '#080d14' : '#475569', borderRadius:10, padding:'0 4px', fontSize:8, fontWeight:800 }}>{counts[key]}</span>}
                </button>
              )
            })}
          </div>

          {/* Fila 2 — TEMPERATURA del lead (Eje 2, manual). Solo en Mensajes: en un
              comentario el lead y su temperatura se siguen en el DM. */}
          {bandeja === 'mensajes' && (
            <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginTop:5 }}>
              {TEMPERATURAS.map(({ key, icon, label, color }) => {
                const active = filter === key
                return (
                  <button key={key} onClick={() => cambiarFiltro(key)} style={{
                    padding:'3px 7px', fontSize:9, fontWeight:700, borderRadius:6, cursor:'pointer',
                    background: active ? `${color}22` : 'transparent',
                    border: `1px solid ${active ? color+'60' : '#1a2d40'}`,
                    color: active ? color : '#334155',
                    fontFamily:'Outfit,sans-serif', transition:'all .15s',
                  }}>
                    {icon} {label}
                    {counts[key] > 0 && <span style={{ marginLeft:3, background: active ? color : '#1a2d40', color: active ? '#080d14' : '#475569', borderRadius:10, padding:'0 4px', fontSize:8, fontWeight:800 }}>{counts[key]}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Lista */}
        <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
          {loading ? (
            <div style={{ padding:28, textAlign:'center', color:'#2a3f55', fontSize:12 }}>Cargando...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:28, textAlign:'center', color:'#2a3f55', fontSize:12 }}>Sin conversaciones</div>
          ) : filtered.map(conv => (
            <ConvRow key={convKey(conv)} conv={conv} isActive={selected === convKey(conv)}
              onClick={() => openConv(conv)} filtroActivo={filter} />
          ))}
        </div>

        {/* Footer sync — flexWrap por el celular: la fila del pie es angosta y el texto
            crece a "Actualizando…"; sin wrap se desbordaría en vez de bajar el botón. */}
        <div style={{ padding:'7px 14px', borderTop:'1px solid #162030', display:'flex', flexWrap:'wrap', gap:8, justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <SyncLabel lastSync={lastSync} refrescando={refrescando} />
          <button onClick={refrescar} disabled={refrescando} title="Actualizar ahora" style={{
            background:'rgba(37,211,102,.1)', border:'1px solid rgba(37,211,102,.25)', color:'#25d366',
            borderRadius:7, width:28, height:28, flexShrink:0, fontSize:14,
            cursor: refrescando ? 'default' : 'pointer', opacity: refrescando ? .45 : 1,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>{refrescando ? '⏳' : '↻'}</button>
        </div>
      </div>
      )}

      {/* ── CHAT ── */}
      {mostrarChat && (selectedConv ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, minHeight:0, overflow:'hidden', background:'#080d14' }}>
          {/* Header chat — flexWrap: en Mensajes son 5 botones de estado + separador +
              3 de temperatura (8 en total); ya no caben junto al nombre en ~360px, y
              sin envolver la fila se desborda y el propio input de abajo queda
              descuadrado (mismo tipo de bug que ya pasó una vez en este inbox). */}
          <div style={{ padding:'8px 14px', background:'#0a0f1a', borderBottom:'1px solid #111c2a', display:'flex', alignItems:'center', gap:10, rowGap:6, flexWrap:'wrap', flexShrink:0 }}>
            {isMobile && (
              <button onClick={goBack} title="Volver" style={{ flexShrink:0, width:34, height:34, borderRadius:9, background:'#111c2a', border:'1px solid #1e2d3d', color:'#94a3b8', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>‹</button>
            )}
            <SocialAvatar name={selectedConv.nombre} channel={selectedConv.canal} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', rowGap:2 }}>
                <span style={{ fontSize:14, fontWeight:800, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>{selectedConv.nombre}</span>
                <ChannelBadge channel={selectedConv.canal} />
                {/* La ventana de 24 h es una regla de DM. En un comentario no significa
                    nada -la respuesta pública nunca caduca- y pintar "Cerrada" ahí le
                    mentía al vendedor que sí podía contestar. */}
                {selectedConv.tipo === 'COMENTARIO' ? (
                  <span style={{ fontSize:10, fontWeight:700, color:'#25d366', flexShrink:0 }}>
                    🌎 La respuesta pública no caduca
                  </span>
                ) : (
                  <span style={{ fontSize:10, fontWeight:700, color: ventana.abierta ? '#25d366' : '#f87171', flexShrink:0 }}>
                    {ventana.etiqueta}
                  </span>
                )}
              </div>
              <div style={{ fontSize:10, color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{CHANNEL_META[selectedConv.canal]?.label} · {selectedConv.sender_id}</div>
              {/* Aviso fijo (no solo un badge chiquito): un comentario es público y
                  pedir ahí una dirección o teléfono expone al cliente ante cualquiera. */}
              {selectedConv.tipo === 'COMENTARIO' && (
                <div style={{ fontSize:10, color:'#f59e0b', fontWeight:700 }}>
                  ⚠️ Comentario público — no pidas datos de entrega acá
                </div>
              )}
              <PautaBadge conv={selectedConv} />
            </div>
            {/* Botones de estado (Eje 1) + temperatura (Eje 2) — mismos iconos y
                colores que la cabecera del chat de WhatsApp en App.jsx, PERO leídos
                de la MISMA lista que los filtros (FILTROS_MENSAJES/COMENTARIOS): si
                la cabecera tuviera su propio array literal podía volver a divergir,
                que fue justo el bug de la ronda anterior (Soporte quedaba disponible
                en un comentario aunque el filtro de Comentarios no lo incluye — el
                chat se volvía invisible sin forma de sacarlo desde la UI). 'venta' SÍ
                se marca a mano acá (a diferencia de WhatsApp, donde es automática por
                pedido): SOCIAL no tiene flujo de pedidos, así que manual es el único
                camino para que el filtro 💰 Ventas deje de estar muerto. */}
            <div style={{ display:'flex', gap:4, flexShrink:0, flexWrap:'wrap', justifyContent:'flex-end' }}>
              {(selectedConv.tipo === 'COMENTARIO' ? FILTROS_COMENTARIOS : FILTROS_MENSAJES).map(s => {
                const meta = STATUS_META[s]
                const isActive = selectedConv.status === s
                return (
                  <button key={s} title={meta.label} onClick={() => cambiarEstado(s)} style={{
                    padding:'3px 6px', fontSize:11, fontWeight:700, borderRadius:5, cursor:'pointer',
                    background: isActive ? `${meta.color}22` : 'transparent',
                    border: `1px solid ${isActive ? meta.color + '60' : '#1a2d40'}`,
                    color: isActive ? meta.color : '#334155',
                    fontFamily:'Outfit,sans-serif',
                  }}>{meta.icon}</button>
                )
              })}
              {/* Separador entre los dos ejes (igual que App.jsx:1292): con hasta 8
                  botones seguidos, sin esta línea no se ve dónde termina la bandeja
                  de estado y empieza la temperatura. */}
              {selectedConv.tipo !== 'COMENTARIO' && (
                <span style={{ width:1, alignSelf:'stretch', background:'#1e2d3d', margin:'2px 2px', flexShrink:0 }} />
              )}
              {/* La temperatura solo tiene sentido en Mensajes: en un comentario el
                  lead y su temperatura se siguen en el DM (restricciones.md). */}
              {selectedConv.tipo !== 'COMENTARIO' && TEMPERATURAS.map(({ key, icon, label, color }) => {
                const on = selectedConv.temperatura === key
                return (
                  <button key={key} title={on ? `${label} — clic para quitar` : `Marcar ${label}`} onClick={() => cambiarTemperatura(key)} style={{
                    padding:'3px 6px', fontSize:11, fontWeight:700, borderRadius:5, cursor:'pointer',
                    background: on ? `${color}22` : 'transparent',
                    border: `1px solid ${on ? color + '60' : '#1a2d40'}`,
                    color: on ? color : '#334155',
                    fontFamily:'Outfit,sans-serif',
                  }}>{icon}</button>
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

          {/* Input — position:relative: el panel de emojis se ancla a ESTE
              contenedor (bottom:100%) para abrirse hacia arriba, encima del
              compositor, y así nunca tapa el textarea ni en pantalla chica. */}
          <div style={{ padding:'10px 16px 14px', background:'#0a0f1a', borderTop:'1px solid #111c2a', flexShrink:0, position:'relative' }}>
            {/* Ventana cerrada y no es un comentario (que tiene su propio camino público
                sin límite de tiempo): avisar ANTES de escribir, no dejar que Meta rebote
                el mensaje después de que el vendedor ya lo redactó entero. */}
            {!windowOpen && selectedConv.tipo !== 'COMENTARIO' ? (
              <div style={{ padding:'12px 16px', background:'#1a1116', border:'1px solid #3a1f28',
                            borderRadius:12, color:'#f87171', fontSize:12, lineHeight:1.5 }}>
                🔒 <b>Pasaron más de 24 h desde el último mensaje del cliente.</b><br />
                Meta ya no deja responder por aquí, y en Facebook e Instagram no hay plantillas
                para reabrir la conversación. Toca esperar a que el cliente escriba de nuevo.
              </div>
            ) : (
            <>
            {/* Comentario: elegir si la respuesta es privada (abre el DM) o pública
                (queda colgada del comentario, la ve todo el mundo). Meta permite UNA
                sola respuesta privada por comentario. */}
            {respondeComentario && (
              // flexWrap: en celular (~360px) la etiqueta + los dos botones no caben en
              // una sola línea; sin wrap la fila se desbordaba y descuadraba el input y
              // el botón de enviar que van debajo. En móvil además se oculta la etiqueta
              // (el aviso de "Comentario público" de la cabecera ya da ese contexto) y
              // se usan etiquetas cortas para que quepan sin desbordar.
              <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:6, marginBottom:8 }}>
                {!isMobile && <span style={{ fontSize:10, color:'#475569' }}>Responder al comentario:</span>}
                {[
                  { id:'privado', label: isMobile ? '🔒 Privado' : '🔒 En privado (DM)' },
                  { id:'publico', label: isMobile ? '🌎 Público' : '🌎 En público' },
                ].map(m => (
                  <button key={m.id} onClick={() => setModoRespuesta(m.id)} style={{
                    padding:'3px 9px', fontSize:10, fontWeight:700, borderRadius:6, cursor:'pointer',
                    background: modoRespuesta === m.id ? 'rgba(37,211,102,.15)' : 'transparent',
                    border: `1px solid ${modoRespuesta === m.id ? 'rgba(37,211,102,.4)' : '#1a2d40'}`,
                    color: modoRespuesta === m.id ? '#25d366' : '#334155',
                    fontFamily:'Outfit,sans-serif',
                  }}>{m.label}</button>
                ))}
              </div>
            )}
            {/* Las respuestas rápidas (con fotos, botones, etc.) ahora viven en el panel
                único de la derecha (pestaña ⚡ Respuestas) — no se duplican acá. */}
            {/* Fila de escritura: la caja se lleva casi todo el ancho y solo el ➤ la
                acompaña — MISMO patrón que WhatsApp (App.jsx). Antes 📎 y 😊 iban acá
                mismo, al lado de la caja, y entre los dos se comían ~100px por la
                derecha: con la caja angosta una frase normal se partía en muchas
                líneas y el hilo de mensajes "saltaba" para seguir al cursor. */}
            <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
              {/* El aire de arriba y abajo lo pone el propio textarea (padding +
                  box-sizing:border-box), no este contenedor: así la zona táctil de
                  44px es el textarea entero. Mismo ajuste que en App.jsx. */}
              <div style={{ flex:1, minWidth:0, background:'#111c2a', border:'1px solid #1e2d3d', borderRadius:13, padding:'0 13px' }}>
                <textarea
                  ref={setTaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !isMobile) { e.preventDefault(); handleSend() } }}
                  placeholder={`Responder por ${CHANNEL_META[selectedConv.canal]?.label}...`}
                  rows={1}
                  style={{
                    width:'100%', background:'transparent', border:'none', outline:'none',
                    color:'#e2e8f0', fontSize:16, resize:'none', lineHeight:1.5,
                    display:'block', boxSizing:'border-box', padding:`${CAJA_AIRE}px 0`,
                    minHeight:CAJA_ALTO_MIN, maxHeight:CAJA_ALTO_MAX, overflowY:'auto',
                    fontFamily:'Outfit,sans-serif',
                  }}
                />
              </div>
              <button onClick={handleSend} disabled={!input.trim() || sending} style={{
                width:42, height:42, flexShrink:0, borderRadius:11, border:'none', cursor: input.trim() ? 'pointer' : 'default',
                background: input.trim() ? `linear-gradient(135deg,${CHANNEL_META[selectedConv.canal]?.color},${CHANNEL_META[selectedConv.canal]?.color}aa)` : '#111c2a',
                color:'#fff', fontSize:17, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s',
              }}>{sending ? '⏳' : '➤'}</button>
            </div>

            {/* Fila de herramientas, debajo de la caja y pegada a la izquierda. El ➤
                de enviar NO baja acá: se queda al costado derecho de la caja, que es
                donde la mano ya lo busca (igual que en WhatsApp). */}
            <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:8, flexWrap:'wrap' }}>
              {/* Se oculta (no se deshabilita) cuando el envío va al hilo público (una
                  foto ahí no se puede) o a la respuesta privada del comentario (Meta
                  solo acepta texto por ese endpoint). Es `iraAlComentario`, no el tipo
                  del hilo: un comentario vencido sale por DM normal, y ahí la foto sí
                  va. Esta condición NO se toca — es la regla del encargo. */}
              {!iraAlComentario && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" onChange={onElegirFoto} style={{ display:'none' }} />
                  <button onClick={() => fileRef.current?.click()} disabled={subiendo} title="Mandar una foto" style={{
                    width:42, height:42, flexShrink:0, borderRadius:11, background:'#111c2a',
                    border:'1px solid #1e2d3d', color:'#64748b', fontSize:17, cursor:'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}>{subiendo ? '⏳' : '📎'}</button>
                </>
              )}
              {/* Emoji: disponible en las DOS bandejas (Mensajes y Comentarios) y en
                  cualquier modo de respuesta — a diferencia de la foto, un emoji es
                  texto plano y un comentario público admite texto sin problema. */}
              <button onClick={() => setShowEmoji(p => !p)} title="Emojis" style={{
                width:42, height:42, flexShrink:0, borderRadius:11, fontSize:20, cursor:'pointer',
                background: showEmoji ? 'rgba(245,158,11,.15)' : '#111c2a',
                border: `1px solid ${showEmoji ? 'rgba(245,158,11,.4)' : '#1e2d3d'}`,
                display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s',
              }}>😊</button>
              {/* Ancla al contenedor del compositor (position:relative, más arriba),
                  no a este botón: por eso sigue abriendo hacia arriba y por encima de
                  TODA la barra (caja + fila de iconos) aunque el botón bajó de fila. */}
              {showEmoji && (
                <EmojiPicker onSelect={insertarEmoji} onClose={() => setShowEmoji(false)} />
              )}
            </div>
            <div style={{ fontSize:9, color:'#2a3f55', marginTop:4, textAlign:'right' }}>
              {isMobile ? 'Toca ➤ para enviar' : 'Enter · Shift+Enter nueva línea'}
            </div>
            </>
            )}
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

      {/* ── PANEL ÚNICO (Respuestas/Tienda) — solo escritorio y con chat abierto.
          En móvil este panel tapa toda la pantalla (son 340px fijos), por eso no se
          monta ahí: la conversación y el input tienen que seguir viéndose enteros. */}
      {!isMobile && selectedConv && (
        // flexDirection:'column' — igual que `.right-col` en App.jsx: sin esto la fila
        // (dirección por defecto de flex) no estira la raíz del panel a los 340px del
        // wrapper y el layout interno de RightPanel (header fijo + contenido con scroll
        // propio) queda roto.
        <div style={{ width: 340, flexShrink: 0, borderLeft: '1px solid #162030', display: 'flex', flexDirection: 'column' }}>
          <RightPanel
            activeConv={convParaPanel}
            contactInfo={null}
            // El botón "Enviar" del panel se apaga solo con windowOpen=false: eso es
            // correcto para un DM (ventana de 24h de Meta), pero un COMENTARIO siempre
            // tiene un camino válido (público sin límite, o privado dentro de 7 días con
            // fallback a público) — nunca "se cierra" como un DM. Sin este `true` fijo,
            // un comentario de ayer dejaría el botón apagado aunque Meta sí lo aceptara.
            windowOpen={selectedConv.tipo === 'COMENTARIO' ? true : windowOpen}
            pestanas={selectedConv.tipo === 'COMENTARIO' ? ['respuestas'] : ['respuestas', 'tienda']}
            onQuickReply={onQuickReply}
            onSendText={onSendText}
            onSendImage={onSendImage}
            onSendProducto={onSendProducto}
            onUpdateContact={() => {}}
          />
        </div>
      )}
    </div>
  )
}
