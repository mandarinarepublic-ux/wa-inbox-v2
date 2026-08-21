'use client'
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { fetchInboxSync, fetchHilo, buscarEnMensajes, sendReply, updateContact, updateTemperatura, isDemo, sendInteractiveButtons, toggleIAMode, sendVideo, sendImageFile, precacheMedia, setCanalActivo, getCanalActivo } from '@/lib/api-client'
import { buildConvs, fmtDate, parseDate } from '@/lib/utils'
import { Spinner, Avatar, ContactRow, MessageBubble, Toast } from '@/components/Components'
import RightPanel from '@/components/RightPanel'
import SetupModal from '@/components/SetupModal'
import GuideModal from '@/components/GuideModal'
import { CANALES, CANAL_GENERAL, CANAL_POR_DEFECTO, colorDeCanal, canalDePhoneId, phoneIdDeCanal, etiquetaDePhoneId } from '@/lib/canales'

import SocialInbox from '@/components/SocialInbox'
import Contactos, { PlantillaModal } from '@/components/Contactos'
import Automatizaciones from '@/components/Automatizaciones'
import PushToggle from '@/components/PushToggle'
import AvisoSesion from '@/components/AvisoSesion'
import { actualizarNoLeidos, notificar } from '@/lib/notif'
import { hayQueConfirmarDescarte, AVISO_DESCARTAR_PEDIDO, anchoPanelPedido, anchoPanelMinimo, bytesDeDataUrl, MAX_HOJA_BYTES } from '@/lib/pedido-manual'
import { decidirArrastre } from '@/lib/arrastre'
import { ventanaAbierta } from '@/lib/bandeja'
import { ordenarBandeja } from '@/lib/orden-bandeja'
import { decidirPegado, decidirAdjuntos, TOPE_FOTOS } from '@/lib/adjuntos'

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
    // Si el navegador no sabe dibujar esa imagen (un HEIC del iPhone, un archivo
    // a medio copiar), sin esto la promesa no se resuelve NUNCA: la vista se
    // queda esperando para siempre y no aparece ni la miniatura ni un error. Se
    // sigue con el archivo tal cual y que decida el envío.
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
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
  /**
   * Número por el que va la CONVERSACIÓN ABIERTA.
   *
   * ⚠️ ESTA ES LA PIEZA QUE SOSTIENE TODO EL DISEÑO. El canal ya no sale de la
   * pestaña: sale del chat que tienes abierto. Por eso se puede responder desde
   * GENERAL sin moverse de ahí — es lo que pidió Rodrigo y es como se trabaja:
   *
   *   "en general respondo y solo cambia el número"
   *
   * El primer intento (19-ago) hizo lo contrario: al tocar una fila en GENERAL te
   * MANDABA a la pestaña del número. Además de sacarte de la cola única —el valor
   * entero de GENERAL— cada clic pasaba por `cambiarLinea`, que vacía `convs`,
   * `contacts` y el caché de hilos y recarga todo de cero. O sea que abrir un chat
   * borraba el inbox y lo volvía a bajar (474 kB + 370 kB + mensajes). Con 25
   * chats al día eran 25 clics extra y 50 recargas completas.
   *
   * Con el canal acá, abrir un chat no toca la pestaña ni la lista: solo cambia
   * cuál hilo se muestra y por dónde sale la respuesta.
   */
  const [activeCanal, setActiveCanal] = useState('')
  const activeCanalRef = useRef('')
  // Pendientes de GENERAL: PERSONAS distintas. Va aparte y no se deriva de
  // `pendientes`, porque quien está pendiente en los dos números suma en los dos
  // botones de número y sumarlos contaría a esa persona dos veces. `null` = todavía
  // no llegó del servidor (ver el badge de GENERAL más abajo).
  const [pendientesTotal, setPendientesTotal] = useState(null)
  // Las dos pestañas de número Y la de GENERAL comparten la vista de chat de
  // abajo: sin CANAL_GENERAL acá, la pestaña 📥 GENERAL se ve en blanco porque
  // ninguna de las otras vistas (SOCIAL/CONTACTOS/AUTO) se enciende para ella.
  const esChat = linea === 'MANDI' || linea === 'REPUBLIC' || linea === CANAL_GENERAL

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
  // Aviso corto de los adjuntos ("eso no es una foto", "ya no caben más"). Sin
  // esto, pegar algo que no sirve no hace NADA en pantalla y parece un bug.
  const [avisoAdjunto, setAvisoAdjunto] = useState('')
  // Solo para pintar la capa de "suelta la foto acá" mientras se arrastra un
  // archivo por encima del chat. Ojo: NO es el `arrastrando` de acá abajo, que
  // es el del asa del panel derecho.
  const [soltarAqui,   setSoltarAqui]   = useState(false)
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
  const avisoRef   = useRef(null)  // temporizador del aviso de adjuntos

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
    const enGeneral = lineaRef.current === CANAL_GENERAL
    const sync   = await fetchInboxSync(enGeneral)
    const lista  = sync?.lista ?? null
    const rows   = sync?.rows ?? null
    const ctList = sync?.contactos ?? null
    // El estado POR CANAL ya no se pide aparte: viene pegado a cada fila de
    // `lista` (campo `estadoBandeja`, vista inbox.lista_bandeja).
    //
    // Traerlo por separado fue el error del 19-ago: +142 kB y 6 viajes de red por
    // ciclo, y como el mapa arrancaba vacío, al abrir el inbox TODO se pintaba
    // pendiente hasta que llegara. Pegado a la fila, ese instante no existe.
    // Pendientes de TODOS los canales (incluido el que no se está mirando).
    //
    // En GENERAL se cuentan desde las FILAS que se acaban de traer, no desde el
    // contador del servidor. Son las mismas filas que se van a pintar, así que el
    // botón dice exactamente lo que se ve debajo — por construcción, no por
    // coincidencia. Es la garantía con la que se trabaja:
    //
    //   "si tengo esa bandeja vacía, he contestado a todas las personas"
    //
    // El contador del servidor (rpc, 0,1 ms) se sigue usando en las pestañas de un
    // solo número, donde la lista viene filtrada y no alcanza para contar la otra.
    // Contar desde la vista en el servidor costaría 12,2 ms por ciclo: no vale la
    // pena para un caso que acá sale gratis.
    if (enGeneral && Array.isArray(lista)) {
      const porCanal = {}
      for (const c of buildConvs(lista, true)) {
        if ((c.estadoBandeja || '') !== 'pendiente') continue
        const k = c.phoneId || 'sin-canal'
        porCanal[k] = (porCanal[k] || 0) + 1
      }
      setPendientes(porCanal)
    } else if (sync?.pendientes) {
      setPendientes(sync.pendientes)
    }
    // Solo si vino un número: `null` significa que la lectura falló, y ahí es mejor
    // conservar el valor anterior que pintar un 0 que diría "ya contestaste a todos".
    if (typeof sync?.pendientesTotal === 'number') setPendientesTotal(sync.pendientesTotal)
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
      // `enGeneral` parte al mismo cliente en una fila por número. En las pestañas
      // de un solo canal NO se parte: ya vienen filtradas del backend.
      const convsData = buildConvs([...(rows || []), ...hilos, ...(lista || [])], enGeneral)
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
      // Respetar los cambios de estado recién hechos, IGUAL que se hace abajo con
      // los contactos. Sin esto: marcas ATENDIDO, la fila se apaga, y al siguiente
      // poll (8 s) reaparece pendiente por unos segundos — porque la respuesta
      // puede venir del caché del edge (s-maxage=2) o de antes de que la escritura
      // se propagara. Marcar algo y verlo revivir es justo "la pantalla miente",
      // el patrón que este proyecto viene a cerrar.
      //
      // El override va por (teléfono, canal) porque el estado es por conversación:
      // marcar atendida la de REPUBLIC no puede tapar la de MANDI.
      const ahoraOv = Date.now()
      const conOverride = convsData.map(c => {
        const ov = localStatusRef.current[`${c.telefono}|${c.phoneId || ''}`]
        return (ov && ov.expiresAt > ahoraOv) ? { ...c, estadoBandeja: ov.estado } : c
      })
      setConvs(conOverride)
    }
    if (Array.isArray(ctList) && ctList.length > 0) {
      const ctMap = {}
      ctList.forEach(c => { ctMap[c.telefono] = c })
      // Respetar cambios locales recientes (evitar que el polling los pise)
      const now = Date.now()
      // Las claves llevan canal (`teléfono|phone_id`); la ficha del contacto es UNA
      // por persona, así que acá se aplica por el teléfono de la clave.
      Object.entries(localStatusRef.current).forEach(([clave, override]) => {
        const tel = clave.split('|')[0]
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
  const cargarHilo = useCallback(async (telefono, canal = '') => {
    if (!telefono) return
    const canalHilo = canal || activeCanalRef.current
    const msgs = await fetchHilo(telefono, 800, canalHilo)
    if (!Array.isArray(msgs) || !msgs.length) return
    // Clave por (teléfono, canal). Con la clave vieja —solo el teléfono— el caché
    // MEZCLABA los hilos de los dos números del mismo cliente bajo la misma
    // entrada: eso era lo que hacía que en GENERAL se viera una conversación que
    // no existe, dos hilos distintos cosidos por fecha.
    const clave = `${telefono}|${canalHilo || ''}`
    hilosRef.current[clave] = msgs
    const abiertos = Object.keys(hilosRef.current)
    if (abiertos.length > 5) {
      const claveActiva = `${activeRef.current}|${activeCanalRef.current || ''}`
      abiertos.slice(0, abiertos.length - 5)
        .filter(k => k !== claveActiva)
        .forEach(k => { delete hilosRef.current[k] })
    }
    setConvs(prev => prev.map(c => {
      if (c.telefono !== telefono) return c
      if (c.phoneId && canalHilo && c.phoneId !== canalHilo) return c  // la fila del OTRO número
      // REEMPLAZA, no fusiona. El `buildConvs([...c.msgs, ...msgs])` de antes unía
      // el hilo ya filtrado por canal con los mensajes SIN filtrar que trae el
      // poll, así que el filtro no servía de nada y los dos números volvían a
      // mezclarse en pantalla. `msgs` ya viene filtrado por el backend: manda.
      const armado = buildConvs(msgs)[0]
      return armado ? { ...c, msgs: armado.msgs, last: armado.last } : c
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
   *
   * Devuelve `true` si el salto se hizo de verdad y `false` si se abortó (el
   * usuario canceló el aviso de descartar el PEDIDO MANUAL). Los llamadores que
   * encadenan un `openConv(...)` justo después TIENEN que revisar este valor:
   * si no, `openConv` vuelve a preguntar por su cuenta y, si ahí el usuario
   * acepta, el chat se abre con la pestaña sin haberse movido (ver Step 3b).
   */
  const cambiarLinea = (id) => {
    // Salir de la pestaña de chats desmonta el panel derecho entero (`esChat`),
    // así que el formulario también se pierde acá.
    if (id !== linea && !puedoDejarLaConversacion(null)) return false
    // GENERAL cuenta como pestaña de chat (comparte la vista de abajo con
    // MANDI/REPUBLIC), pero NO es un canal con número propio — por eso las dos
    // ramas de abajo excluyen `id === CANAL_GENERAL` explícitamente: entrar a
    // GENERAL tiene su propia rama (la de más abajo) que conserva el canal
    // armado en vez de pisarlo con `setCanalActivo('GENERAL')`, que dejaría el
    // módulo de envíos sin canal (null) por CUALQUIER camino que llegue a GENERAL,
    // no solo desde MANDI/REPUBLIC.
    //
    // Nombrada `esPestanaDeChat` y no `esChat` (como en la primera entrega) para
    // no sombrear el `esChat` de arriba: ese sombreado, aunque inofensivo acá
    // porque nadie lo usa dentro de esta función, dejaba una trampa para
    // cualquier uso futuro (TDZ / "siempre truthy" si alguien confundía cuál era
    // la función y cuál el booleano).
    const esPestanaDeChat = (x) => x === CANAL_GENERAL || CANALES.some(c => c.id === x)
    const eraChat = esPestanaDeChat(linea)
    const vaAChat = esPestanaDeChat(id)
    if (vaAChat && eraChat && id !== linea && id !== CANAL_GENERAL) {
      setCanalActivo(id)        // manda a api-client: lecturas y envíos van por acá
      setCanalArmado(id)        // el estado de React no puede quedar atrás del módulo
      setActive(null); activeRef.current = null
      setActiveCanal(''); activeCanalRef.current = ''
      setCitando(null)
      setConvs([]); setContacts({})
      hilosRef.current = {}     // hilos cargados del canal anterior
      pendingRef.current = {}   // burbujas optimistas del canal anterior
      setTimeout(load, 0)       // recarga ya, sin esperar al siguiente poll
    } else if (vaAChat && !eraChat && id !== CANAL_GENERAL) {
      setCanalActivo(id)
      setCanalArmado(id)        // idem: MANDI/REPUBLIC mandan sobre lo armado, no al revés
    } else if (id === CANAL_GENERAL) {
      // EN GENERAL SE CONVERSA. Es la cola única y es donde se trabaja:
      //
      //   "en general respondo y solo cambia el número"
      //
      // Lo que cambió el 20-ago no es dónde se responde, sino DE DÓNDE SALE EL
      // CANAL: ya no de la pestaña (que en GENERAL no puede decidir, porque
      // conviven los dos números) sino de la conversación abierta, que sabe cuál
      // es el suyo porque la lista da una fila por (cliente, número).
      //
      // Ya no hay nada que adivinar, y por eso desaparece la familia de bugs que
      // volvió cinco veces: antes había que deducir el número del `phone_id` de la
      // ficha del cliente —UNA sola por persona— y cuando deducía mal, el mensaje
      // salía por el otro número y Meta lo rechazaba con 131047.
      //
      // ⚠️ El chat SÍ se cierra al entrar a GENERAL, igual que en cualquier cambio
      // de pestaña: la conversación que estabas mirando pertenece a la bandeja que
      // dejas. Lo que NO pasa —y era el error de la primera entrega— es cerrarlo y
      // recargar el inbox entero cada vez que abres un chat DENTRO de GENERAL.
      setActive(null); activeRef.current = null
      setActiveCanal(''); activeCanalRef.current = ''
      setCitando(null)
      // El canal armado se conserva igual porque CONTACTOS y las plantillas leen
      // `CANAL_ACTIVO` sin preguntar. Nunca null: un envío con Canal vacío cae al
      // número principal en silencio (ver `canalDe` en /api/saliente).
      setCanalActivo(canalArmado || CANAL_POR_DEFECTO)
      // Sin esto la columna tarda hasta el próximo poll (10-25 s) en perder el
      // filtro del número anterior: entrabas a "Los dos" y por un rato veías
      // solo uno. Mismo `setTimeout(load, 0)` que ya usa la rama de arriba.
      setTimeout(load, 0)
    } else if (linea === CANAL_GENERAL && !vaAChat) {
      // Salir de GENERAL —y SOLO de GENERAL— hacia una pestaña que no es de chat
      // (SOCIAL/CONTACTOS/AUTO). `Contactos.jsx` manda por `CANAL_ACTIVO` sin
      // mostrar ni preguntar por cuál canal, así que hereda a ciegas lo que haya
      // quedado armado. Viniendo de MANDI o de REPUBLIC eso es correcto: el canal
      // heredado ES la pestaña que estabas mirando hace un segundo, visible en la
      // pantalla. Viniendo de GENERAL no: sería el canal del último chat que
      // abriste dentro de la cola mezclada, sin ninguna pista en CONTACTOS de
      // cuál es. Solo ESE caso se aplana al canal por defecto, el mismo con el
      // que arranca el módulo (`lib/api-client.js`).
      //
      // ⚠️ La condición es `linea === CANAL_GENERAL`, NO `eraChat`. Con `eraChat`
      // esta rama también agarraba a REPUBLIC → CONTACTOS y le fijaba MANDI:
      // escribirle ahí a un cliente de REPUBLIC salía por el número de MANDI en
      // silencio, y la lista de plantillas (`?canal=${CANAL_ACTIVO}`) mostraba las
      // de MANDI. Es el mismo error que el aviso rojo de más abajo existe para
      // evitar: por defecto es determinista, pero igual de equivocado.
      setCanalActivo(CANAL_POR_DEFECTO)
      setCanalArmado(CANAL_POR_DEFECTO)
      // ⚠️ Soltar el canal SIN soltar el chat dejaba armado el número equivocado.
      // El chat abierto pertenecía al canal que se acaba de aplanar: en GENERAL
      // lo abriste (por ejemplo) en REPUBLIC, y al volver a GENERAL la rama de
      // `id === CANAL_GENERAL` restaura `canalArmado` —que ahora es MANDI— sin
      // que nadie vuelva a llamar `openConv`. El chat de REPUBLIC seguía en
      // pantalla (el hilo vive en `hilosRef`, que no se bota) con CANAL_ACTIVO
      // en MANDI, y `canalSinResolver()` daba false porque `phoneIdDe` resuelve
      // perfecto: ninguna guardia disparaba y la respuesta salía por MANDI.
      // El chat se cierra acá, y no se re-arma desde `active` al volver a
      // GENERAL, porque eso dependería de que `convs`/`contacts` ya tengan la
      // fila cargada — más frágil y con el mismo final malo si no está.
      setActive(null); activeRef.current = null
      setCitando(null)
    }
    // La plantilla de "ventana cerrada" pertenece al chat que estabas mirando, y
    // manda con `CANAL_ACTIVO` (`sendTemplate`) sin guard propio. Cambiar de
    // pestaña acaba de mover ese canal en casi todas las ramas de arriba, así que
    // un modal sobreviviente mandaría por el número de la pestaña NUEVA a un
    // cliente de la vieja. Su fondo oscuro tapa la barra de pestañas, o sea que
    // con el mouse esto no se alcanza; con el teclado (TAB hasta un botón de
    // pestaña, que sigue siendo enfocable detrás del fondo) sí. Cerrarlo es
    // gratis y reabrirlo es un clic — igual que en `openConv`.
    if (id !== linea) setShowTplModal(false)
    // `lineaRef` normalmente la sincroniza el `useEffect` de más abajo, pero
    // ESE corre después del commit — un pelín tarde para `openConv`, que puede
    // ejecutarse en el mismo tick, justo después de este `cambiarLinea` (Step
    // 3b). Fijarla acá, ya, es lo que le permite a `openConv` leer la pestaña
    // DESTINO en vez de la que ya se dejó atrás.
    lineaRef.current = id
    setLinea(id)
    return true
  }

  /**
   * Número por el que habla este contacto.
   *
   * ⚠️ SU ALCANCE SE REDUJO EL 20-ago Y NO DEBE VOLVER A CRECER.
   *
   * Esto es una ADIVINANZA, y adivinar el canal es de donde salieron los peores
   * bugs de este inbox (cinco veces). Hoy solo queda para los dos caminos que
   * llegan a un chat SIN saber de qué número es:
   *
   *   · CONTACTOS  → el directorio no guarda canal
   *   · aviso push → solo trae el teléfono
   *
   * La lista NO lo usa más: cada fila trae su propio `phoneId` y con eso se pinta
   * y se despacha. Si aparece la tentación de llamarlo desde algo que ya tiene la
   * fila a mano, es que se está reintroduciendo el bug — usa `conv.phoneId`.
   *
   * La ficha del contacto es la fuente buena, y ahora sí lo es de verdad: desde
   * el 20-ago `conversaciones.phone_id` solo lo mueven los mensajes ENTRANTES
   * (ver `guardarMensajeSupabase`), así que significa "el número por el que habla
   * esta persona". Antes lo pisaba cualquier saliente y por eso mentía. El último
   * mensaje de la fila queda de respaldo para una conversación tan nueva que su
   * ficha no llegó en el último sync.
   */
  const phoneIdDe = (tel) =>
    contacts[tel]?.phoneId || convs.find(c => c.telefono === tel)?.last?.phoneId || ''

  /**
   * Abre un chat. `phoneIdFila` = el número al que pertenece la fila que se tocó.
   *
   * Desde GENERAL ese dato es obligatorio en la práctica: es lo que convierte el
   * clic en "llévame a la pestaña de ESTE número", en vez de la vieja adivinanza.
   */
  const openConv = (telefono, phoneIdFila = '') => {
    // Único paso obligado para cambiar de chat: lo usan la lista, CONTACTOS y el
    // salto desde un aviso push. Con esto acá, los tres quedan cubiertos.
    if (!puedoDejarLaConversacion(telefono)) return

    // Cierra la plantilla de "ventana cerrada" del chat ANTERIOR si había una
    // abierta: sin esto, un `openConv` que llega de un camino que no pasa por
    // un clic del vendedor (el salto desde un aviso push) podía cambiar de
    // conversación con el modal todavía abierto, y el modal manda con
    // `CANAL_ACTIVO` — el de la conversación VIEJA si el canal de la nueva no
    // se llegó a resolver. Mejor cerrarlo siempre: reabrirlo es un clic.
    setShowTplModal(false)

    // EL CANAL DE LA CONVERSACIÓN, sin moverse de pestaña.
    //
    // Sale de `phoneIdFila` — el número de la fila que tocaste, un HECHO que trae
    // la lista (vista lista_bandeja, una fila por cliente y número). Antes había
    // que deducirlo de la ficha del cliente, que es UNA por persona: cuando deducía
    // mal, la respuesta salía por el otro número y Meta la rechazaba con 131047.
    //
    // ⚠️ NO se cambia de pestaña. En GENERAL se responde desde GENERAL; lo único
    // que cambia es por cuál número sale. Sacar al vendedor de la cola única
    // rompía su forma de trabajar Y disparaba una recarga completa del inbox en
    // cada clic (`cambiarLinea` vacía convs, contacts y el caché de hilos).
    //
    // Respaldo: si la fila no trae canal (un chat tan nuevo que la lista todavía
    // no lo tiene), se usa la ficha; y si tampoco, el de la pestaña. Nunca vacío:
    // un envío con Canal vacío cae al número principal en silencio.
    const canalConv = phoneIdFila || phoneIdDe(telefono) || phoneIdDeCanal(lineaRef.current) || phoneIdDeCanal(CANAL_POR_DEFECTO)
    setActiveCanal(canalConv)
    activeCanalRef.current = canalConv
    // El módulo de envíos sigue leyendo CANAL_ACTIVO cuando quien llama no pasa
    // canal explícito (CONTACTOS, plantillas), así que se mantiene al día.
    setCanalActivo(canalDePhoneId(canalConv) || CANAL_POR_DEFECTO)
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

  // Desde la pestaña CONTACTOS: salta a la conversación, en SU pestaña. El
  // teléfono del directorio puede venir en otro formato → matcheamos por
  // últimos 9 dígitos.
  const abrirChatDesdeContactos = (telefono) => {
    const t9 = String(telefono).replace(/\D/g, '').slice(-9)
    const conv = convs.find(c => String(c.telefono).replace(/\D/g, '').slice(-9) === t9)
    const destino = conv ? conv.telefono : telefono
    // Por `cambiarLinea` y no por `setLinea` a pelo: con GENERAL en el medio,
    // un `setLinea` suelto movía la pestaña sin avisarle a `canalArmado` ni al
    // canal activo del módulo — la pestaña mostraba MANDI mientras el envío
    // seguía armado sobre el canal de la pestaña anterior.
    //
    // ⚠️ El destino es el canal DE ESTE CONTACTO (`phoneIdDe`/`canalDePhoneId`,
    // los mismos helpers de siempre), no `CANAL_POR_DEFECTO` a ciegas. La
    // primera entrega mandaba siempre a MANDI: si estabas viendo REPUBLIC y
    // saltabas a un contacto de REPUBLIC desde CONTACTOS, la pestaña se movía a
    // MANDI y CUALQUIER respuesta a ese cliente salía por el número de MANDI.
    // `CANAL_POR_DEFECTO` queda solo de último recurso, para el contacto nuevo
    // sin ficha ni mensaje previo que `phoneIdDe` no puede resolver todavía.
    const canalDestino = canalDePhoneId(phoneIdDe(destino)) || CANAL_POR_DEFECTO
    // Si `cambiarLinea` abortó (el usuario canceló el aviso de descartar el
    // PEDIDO MANUAL), NO abrimos el chat: `openConv` volvería a preguntar y,
    // si ahí se acepta, el chat se abriría con la pestaña sin haberse movido.
    if (!cambiarLinea(canalDestino)) return
    openConv(destino)
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
    // Mismo motivo que en abrirChatDesdeContactos: el destino es el canal DE
    // ESTE CONTACTO, no `CANAL_POR_DEFECTO` a ciegas.
    const canalDestino = canalDePhoneId(phoneIdDe(conv.telefono)) || CANAL_POR_DEFECTO
    // Si `cambiarLinea` abortó (aviso de PEDIDO MANUAL cancelado), NO se
    // consume el pedido: `pedidoRef.current` se queda como estaba, para que el
    // próximo `convs` (o cuando el usuario por fin suelte la conversación)
    // reintente el mismo salto. Si se limpiara igual, el aviso del push se
    // perdía para siempre con solo cancelar un diálogo.
    if (!cambiarLinea(canalDestino)) return
    pedidoRef.current = null
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
  // La conversación abierta se identifica por (teléfono, número), no solo por
  // teléfono: en GENERAL el mismo cliente tiene DOS filas y con la clave vieja
  // `find` devolvía siempre la primera — abrías la de REPUBLIC y el panel te
  // mostraba la de MANDI.
  //
  // El respaldo por teléfono a secas cubre a quien llegó sin canal resuelto
  // (CONTACTOS, un aviso push) y a las pestañas de un solo número, donde solo
  // puede haber una fila por cliente.
  const activeConv  = convs.find(c => c.telefono === active && (!activeCanal || !c.phoneId || c.phoneId === activeCanal))
                   || convs.find(c => c.telefono === active)
                   || null
  const totalUnread = convs.reduce((s, c) => s + c.unread, 0)

  /**
   * Step 3c (Tarea 4): en GENERAL, si el chat abierto no tiene un canal que se
   * pueda resolver, NINGÚN camino de envío puede completarse.
   *
   * `phoneIdDe` devuelve '' cuando la ficha no tiene `phone_id` y no hay
   * mensaje en `convs` (pasa de verdad con los chats que nacen de un envío
   * saliente sin phone_id, p. ej. una plantilla desde CONTACTOS). En ese caso
   * `openConv` NO llama `setCanalActivo` (ver el `if (canal)` de más arriba) y
   * el módulo de envíos (lib/api-client) se queda con el canal ARMADO del chat
   * ANTERIOR — enviar ahí sería responderle a este cliente por el número de
   * otro, en silencio.
   *
   * Se usa como guardia en CADA función que manda algo (no solo en la caja de
   * escribir): las respuestas rápidas y los productos del panel derecho llaman
   * a estas mismas funciones sin pasar por la caja, así que ocultar solo el
   * textarea no alcanza.
   */
  const canalSinResolver = () =>
    linea === CANAL_GENERAL && !!activeConv && !canalDePhoneId(phoneIdDe(activeConv.telefono))

  // Mismo aviso en cualquier función de envío que tope con `canalSinResolver`.
  const avisarCanalSinResolver = () => {
    setToast({ ok: false, msg: '⚠️ No sé por cuál número enviarle a este chat. Ábrelo desde MANDI o REPUBLIC.' })
    setTimeout(() => setToast(null), 4500)
  }
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

  /**
   * Estado de bandeja de UNA FILA de la lista.
   *
   * En GENERAL cada fila es una conversación distinta —(cliente, número)— y su
   * estado sale de `bandeja`, indexado por esa misma clave. Es lo que hace que
   * contestarle por REPUBLIC apague ESA fila y deje la de MANDI pendiente si
   * todavía le debes una respuesta ahí.
   *
   * En las pestañas de un solo número la fila también tiene su canal, así que se
   * usa igual. `getStatus` (una por persona) queda para el panel del chat abierto
   * y para CONTACTOS, donde no hay canal de por medio.
   *
   * Sin fila en `bandeja` cae a 'pendiente', nunca a undefined: un chat recién
   * llegado no tiene fila todavía, y "no aparece el cliente" es el bug más
   * reincidente de este inbox.
   */
  const estadoFila = (conv) => {
    // El estado viene PEGADO a la fila (campo `estadoBandeja` de la CONVERSACIÓN,
    // vista inbox.lista_bandeja). No se busca en ningún mapa aparte.
    //
    // Eso no es solo más rápido: es lo que hace imposible el defecto del 19-ago.
    // Cuando el estado se leía por separado, había un instante —el primer render,
    // antes de que llegara la respuesta— en que la fila existía sin su estado, y
    // "sin estado" se traducía a PENDIENTE. Resultado: al abrir el inbox TODAS las
    // conversaciones se pintaban pendientes. Pegado a la fila, ese instante no
    // existe: si hay fila, hay estado.
    //
    // Respaldo al estado por persona para las filas que no vienen de esa vista
    // (búsqueda de mensajes, mensajes optimistas todavía sin confirmar).
    return conv.estadoBandeja || getStatus(conv.telefono)
  }
  // Eje 2: temperatura del lead ('' = sin clasificar).
  const getTemp = (tel) => contacts[tel]?.temperatura || ''

  // Ventana de 24h: ms transcurridos desde el último mensaje del cliente.
  //
  // `conv` (opcional) permite medirla POR CANAL, que es la única forma correcta:
  // la ventana de WhatsApp es por par (cliente ↔ número nuestro). El dato de la
  // ficha —`contacts[tel].ultimoEntranteAt`— mezcla los dos números, y por eso
  // decía "quedan 20 horas" cuando por ESE número hacía 35 días que no escribía.
  // Es el mismo error que mató 9 mensajes en agosto, con otra cara.
  //
  // Sin `conv` cae al dato de la persona: es lo que había, y sirve para CONTACTOS
  // y el aviso push, donde no hay canal de por medio.
  const silencioMs = (tel, conv = null) => {
    const t = conv?.last?.ultimoEntranteCanal || contacts[tel]?.ultimoEntranteAt
    return t ? (Date.now() - new Date(t).getTime()) : Infinity
  }
  // 🔥 caliente que se acerca al cierre de la ventana (entre el umbral y las 24h) → ⏰.
  const alertaVentana = (tel, conv = null) => {
    if (getTemp(tel) !== 'caliente') return false
    const ms = silencioMs(tel, conv)
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
  const filtered = ordenarBandeja(
    isSearching
      ? searched
      : searched.filter(c =>
          filter === 'venta' ? esVentaActiva(c.telefono)
          : esTemp(filter)   ? getTemp(c.telefono) === filter
          // Por CONVERSACIÓN, no por persona: en GENERAL la fila de REPUBLIC puede
          // estar atendida y la de MANDI seguir pendiente. Con el estado por
          // persona, contestar por un número escondía la conversación del otro.
          :                    estadoFila(c) === filter
        ),
    isSearching ? '' : filter,
    (tel) => contacts[tel]?.ultimoEntranteAt || null,
  )
  const counts = {
    // Los contadores usan `estadoFila`, IGUAL que el filtro de arriba. Si uno
    // contara por persona y el otro por conversación, el botón diría un número y
    // debajo se verían otras filas — y ese desajuste es exactamente lo que rompe
    // la garantía "si esa bandeja está vacía, contesté a todos".
    pendiente:  searched.filter(c => estadoFila(c) === 'pendiente').length,
    atendido:   searched.filter(c => estadoFila(c) === 'atendido').length,
    soporte:    searched.filter(c => estadoFila(c) === 'soporte').length,
    archivado:  searched.filter(c => estadoFila(c) === 'archivado').length,
    venta:      searched.filter(c => esVentaActiva(c.telefono)).length,
    // Temperaturas (Eje 2)
    caliente:   searched.filter(c => getTemp(c.telefono) === 'caliente').length,
    tibio:      searched.filter(c => getTemp(c.telefono) === 'tibio').length,
    frio:       searched.filter(c => getTemp(c.telefono) === 'frio').length,
    // Calientes que se acercan a las 24h → para el aviso ⏰.
    alerta:     searched.filter(c => alertaVentana(c.telefono, c)).length,
  }

  const lastMsg      = activeConv?.last
  const lastIncoming = activeConv ? [...activeConv.msgs].reverse().find(m => m.direccion === 'ENTRANTE') : null
  /**
   * ¿Se puede escribir libremente en este chat, o solo plantilla?
   *
   * Manda `ultimoEntranteCanal` — el último mensaje del cliente POR ESTE NÚMERO,
   * que viene de la base ya separado por canal. El respaldo (buscar el último
   * entrante entre los mensajes en pantalla) queda para cuando ese dato aún no
   * llegó, pero NO puede ser la fuente principal:
   *
   * en GENERAL el poll trae los mensajes de los DOS números, y en el instante
   * anterior a que cargue el hilo filtrado, un entrante del OTRO canal haría creer
   * que la ventana está abierta. Ese falso "abierta" es exactamente lo que dejó
   * salir los tres mensajes del 19-ago que Meta rechazó con 131047 — el vendedor
   * los vio salir y el cliente nunca los recibió.
   *
   * `ventanaAbierta` (lib/bandeja.js, con pruebas) cierra ante la duda: sin fecha
   * o con fecha corrupta devuelve false. Un falso "cerrada" solo obliga a usar
   * plantilla; un falso "abierta" pierde el mensaje en silencio.
   */
  const windowOpen = activeConv?.ultimoEntranteCanal
    ? ventanaAbierta(activeConv.ultimoEntranteCanal)
    : (lastIncoming ? ventanaAbierta(lastIncoming.timestamp) : false)

  /**
   * Por qué número sale lo que se envía AHORA.
   *
   * Es el canal de la CONVERSACIÓN ABIERTA, no el de la pestaña. Esa es la regla
   * de la que depende todo:
   *
   *   "en general respondo y solo cambia el número"
   *
   * En GENERAL conviven los dos números, así que la pestaña no puede decidir. La
   * conversación sí: cada fila sabe de qué número es.
   *
   * Se lee de la REF y no del estado de React a propósito. Los envíos se congelan
   * al ENCOLAR y salen segundos después (una tanda de 5-10 fotos), y mientras
   * salen el vendedor hace lo normal: clic en el siguiente chat. `activeCanal`
   * (estado) todavía sería el del render viejo; la ref está al día siempre.
   *
   * Nunca devuelve vacío: un `Canal` vacío cae al número principal en silencio
   * (ver `canalDe` en /api/saliente), que es exactamente cómo mueren los mensajes.
   */
  const canalDeEnvio = () =>
    activeCanalRef.current || getCanalActivo() || phoneIdDeCanal(CANAL_POR_DEFECTO)

  // ── Cambiar estado de BANDEJA (Eje 1) ─────────────────────────
  const changeStatus = async (telefono, status) => {
    // Clic en la misma bandeja = sin efecto (también evita el doble-clic sin bloquear
    // un clic legítimo a OTRA bandeja, que antes se tragaba un guard de 3s).
    // El canal de ESTA conversación: el del chat abierto, no el de la pestaña.
    // Es lo que decide CUÁL de las dos conversaciones del cliente se marca — sin
    // esto, darle ATENDIDO por REPUBLIC apagaba también la de MANDI, donde quizá
    // todavía le debes una respuesta.
    const canalFila = activeCanalRef.current || phoneIdDeCanal(linea) || getCanalActivo()
    const convFila = convs.find(c => c.telefono === telefono && (!canalFila || !c.phoneId || c.phoneId === canalFila))
    const estadoActual = convFila?.estadoBandeja || contacts[telefono]?.estado || 'pendiente'
    if (estadoActual === status) return

    // Override local para que el polling (8s) no pise el cambio mientras se guarda.
    // Clave (teléfono, canal): el override protege ESTA conversación, no las dos.
    const claveOv = `${telefono}|${canalFila || ''}`
    localStatusRef.current[claveOv] = { estado: status, expiresAt: Date.now() + 15000 }
    // Optimista: se ve al instante. El estado de bandeja vive PEGADO al último
    // mensaje de la fila, así que el pintado optimista va ahí — y solo en la fila
    // de ESTE número, no en las dos.
    setContacts(prev => ({ ...prev, [telefono]: { ...(prev[telefono] || {}), estado: status } }))
    const pintar = (est) => setConvs(prev => prev.map(c =>
      (c.telefono === telefono && (!canalFila || !c.phoneId || c.phoneId === canalFila) && c.last)
        ? { ...c, estadoBandeja: est }
        : c))
    pintar(status)
    const conv = convs.find(c => c.telefono === telefono)
    const res = await updateContact(telefono, conv?.nombre || '', status, contacts[telefono]?.alias || '', true, null, canalFila)
    // Si el guardado falló: avisar y revertir (no dejar un estado fantasma que el poll
    // deshace solo en silencio a los 15s).
    if (res && res.ok === false) {
      delete localStatusRef.current[claveOv]
      setContacts(prev => ({ ...prev, [telefono]: { ...(prev[telefono] || {}), estado: estadoActual } }))
      // Revertir TAMBIÉN la bandeja: es la que pinta la fila. Si solo se revirtiera
      // `contacts`, el aviso diría "no se pudo" y la fila seguiría mostrando el
      // estado nuevo — la pantalla mintiendo, que es el patrón que este proyecto
      // viene a cerrar.
      if (canalFila) {
        setBandeja(prev => {
          const m = new Map(prev)
          const k = claveBandeja(telefono, canalFila)
          m.set(k, { ...(m.get(k) || { telefono, phoneId: canalFila }), estado: estadoActual })
          return m
        })
      }
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
    if (canalSinResolver()) { avisarCanalSinResolver(); return }
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const canal    = canalDeEnvio()   // congelado con el teléfono, ver `encolar`
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
        sendReply(telefono, nombre, t, citaId, canal),
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
    if (canalSinResolver()) { avisarCanalSinResolver(); return }
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const canal    = canalDeEnvio()
    const estadoDestino = estadoAlResponder(currentStatus)
    return encolar(telefono, async () => {
      await enviarTextoSuelto(telefono, nombre, t, canal)
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
  //
  // `canal` va por parámetro por el mismo motivo que `telefono` y `nombre`:
  // leerlo con `getCanalActivo()` acá adentro es leerlo cuando la foto SALE, no
  // cuando se encoló. Una tanda de 5-10 fotos tarda segundos y el clic al
  // siguiente chat (el gesto normal de trabajo en GENERAL) ya movió el canal.
  const sendImageUrl = async (telefono, nombre, imageUrl, mediaId = '', canal = '') => {
    // OJO: esta función habla con /api/saliente por su cuenta, sin pasar por
    // postSaliente de lib/api-client — que es donde se inyecta el canal. Por eso
    // el `Canal` va explícito acá: sin él las fotos salían por el número
    // principal aunque estuvieras en la bandeja del otro.
    const res = await fetch('/api/saliente', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Telefono: telefono, Nombre: nombre, ImagenURL: imageUrl,
        Canal: canal || canalDeEnvio(),
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
  const subirYEnviarFoto = async (telefono, nombre, file, canal = '') => {
    let url = ''
    try {
      const fd = new FormData(); fd.append('file', file)
      const res  = await fetch('/api/upload-foto', { method:'POST', body:fd })
      const data = await res.json()
      if (res.ok && data.url) url = data.url
    } catch { /* seguimos por media id */ }
    return sendImageFile(telefono, nombre, file, url, canal)
  }

  const avisarAdjunto = (texto) => {
    setAvisoAdjunto(texto || '')
    clearTimeout(avisoRef.current)
    if (texto) avisoRef.current = setTimeout(() => setAvisoAdjunto(''), 5000)
  }
  useEffect(() => () => clearTimeout(avisoRef.current), [])

  /**
   * La ÚNICA puerta de entrada de archivos a la caja de escribir. La usan el 📎,
   * Ctrl+V y arrastrar-y-soltar: las tres traen una lista de File y de acá para
   * abajo el camino es el mismo de siempre (`imgFiles` → `handleSendImage`).
   * Qué se hace con esa lista lo decide `decidirAdjuntos`, que está aparte y
   * probado (ver tests/adjuntos.test.js).
   */
  const agregarAdjuntos = async (entrantes) => {
    const lista = Array.from(entrantes || [])
    if (!lista.length) return
    // La misma guardia que tienen todas las funciones de envío: sin saber por
    // cuál número sale, no se arma ninguna tanda. Va acá y no en cada puerta,
    // para que pegar no pueda saltarse lo que el 📎 respeta.
    if (canalSinResolver()) { avisarCanalSinResolver(); return }
    const plan = decidirAdjuntos({ actuales: imgFiles.length, esVideoActual: isVideo, entrantes: lista })
    avisarAdjunto(plan.aviso)
    if (plan.accion === 'nada') return
    setImgResult(null)

    if (plan.tipo === 'video') {
      setIsVideo(true)
      setImgFiles([{ file: plan.archivos[0], preview: URL.createObjectURL(plan.archivos[0]) }])
      return
    }

    const procesadas = await Promise.all(plan.archivos.map(async f => ({
      file: await toJpeg(f),
      preview: await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(f) })
    })))
    if (plan.accion === 'reemplazar') {
      setIsVideo(false)
      setImgFiles(procesadas)
    } else {
      // El `slice` no sobra: procesar es asíncrono y dos pegados seguidos y
      // rápidos deciden los dos contra el mismo `imgFiles.length` viejo. Acá,
      // dentro del updater, se ve el estado de verdad.
      setImgFiles(prev => [...prev, ...procesadas].slice(0, TOPE_FOTOS))
    }
  }

  const handleFileSelect = async (e) => {
    await agregarAdjuntos(e.target.files)
    // El input se limpia siempre: si no, elegir DOS VECES la misma foto no
    // dispara `change` la segunda vez y parece que el 📎 dejó de funcionar.
    if (fileRef.current) fileRef.current.value = ''
  }

  /**
   * Ctrl+V en la caja de escribir, como en WhatsApp Web.
   * Solo se mete cuando lo pegado son archivos de verdad; el pegado de texto de
   * toda la vida NO se toca (ver la trampa de Excel en lib/adjuntos.js).
   */
  const handlePaste = (e) => {
    const dt = e.clipboardData
    if (!dt) return
    const archivos = Array.from(dt.files || [])
    const decision = decidirPegado({ tieneArchivos: archivos.length > 0, texto: dt.getData('text/plain') })
    if (decision !== 'adjuntar') return
    e.preventDefault()
    agregarAdjuntos(archivos)
  }

  /**
   * Ctrl+V con el chat abierto pero SIN el cursor dentro de la caja.
   *
   * Es el caso normal, no el raro: se toma la captura, se vuelve a la pestaña
   * del inbox y se pega. Nadie hace clic en la caja primero. Sin esto el pegado
   * "no funciona" la mitad de las veces y parece un bug.
   *
   * Solo actúa cuando NADIE más reclama el pegado: si el foco está en un campo
   * de texto (la búsqueda, el nombre del contacto, la propia caja de escribir)
   * manda ese campo. La caja tiene su propio `onPaste`.
   */
  const pasteRef = useRef(handlePaste)
  useEffect(() => { pasteRef.current = handlePaste })
  useEffect(() => {
    // Solo con el chat de WhatsApp a la vista: en SOCIAL / CONTACTOS /
    // AUTOMATIZACIONES el chat sigue montado detrás, y pegar ahí dejaría una
    // foto encolada en una conversación que ni se está viendo.
    if (!activeConv || ['SOCIAL', 'CONTACTOS', 'AUTO'].includes(linea)) return
    const alPegarEnLaPagina = (e) => {
      const el = e.target
      const escribiendo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (escribiendo) return
      pasteRef.current(e)
    }
    window.addEventListener('paste', alPegarEnLaPagina)
    return () => window.removeEventListener('paste', alPegarEnLaPagina)
  }, [activeConv, linea])

  // ── Arrastrar y soltar una foto sobre el chat ──────────────────────
  const traeArchivos = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')

  const alArrastrarEncima = (e) => {
    if (!traeArchivos(e)) return
    e.preventDefault()
    setSoltarAqui(true)
  }
  const alSalirArrastrando = (e) => {
    // `dragleave` también salta al pasar de un hijo a otro dentro del chat: si
    // se apagara siempre, la capa parpadearía todo el rato.
    if (e.currentTarget.contains(e.relatedTarget)) return
    setSoltarAqui(false)
  }
  const alSoltar = (e) => {
    if (!traeArchivos(e)) return
    e.preventDefault()
    setSoltarAqui(false)
    agregarAdjuntos(e.dataTransfer?.files)
  }

  // Red de seguridad del navegador: si una foto se suelta FUERA del chat, por
  // defecto Chrome navega a ese archivo y se pierde el inbox entero (chat
  // abierto, borrador, tanda a medio armar). Esto se lo traga.
  useEffect(() => {
    const tragar = (e) => { if (traeArchivos(e)) e.preventDefault() }
    window.addEventListener('dragover', tragar)
    window.addEventListener('drop', tragar)
    return () => {
      window.removeEventListener('dragover', tragar)
      window.removeEventListener('drop', tragar)
    }
  }, [])

  const handleSendImage = async () => {
    if (!imgFiles.length || !activeConv) return
    if (canalSinResolver()) {
      setImgResult({ ok: false, error: 'no sé por cuál número mandar esto — abre el chat desde MANDI o REPUBLIC' })
      return
    }
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const canal    = canalDeEnvio()   // el bucle puede durar 10 archivos con pausas
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
        const result = await sendVideo(telefono, nombre, archivos[0].file, canal)
        allOk = result.ok
        if (!result.ok) sendErr = result.error || ''
      } else {
        for (let i = 0; i < archivos.length; i++) {
          // La url permanente en NUESTRO Storage + el envío por media id: los dos
          // pasos viven en `subirYEnviarFoto` (arriba), que es de donde salieron
          // y donde está explicado el porqué de cada uno.
          const { ok } = await subirYEnviarFoto(telefono, nombre, archivos[i].file, canal)
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
    setImgFiles([]); setImgResult(null); setIsVideo(false); setImgProgress(0); avisarAdjunto('')
    if (fileRef.current) fileRef.current.value = ''
  }

  /**
   * "↩ Responder" sobre una burbuja: además de fijar la cita, deja el cursor
   * DENTRO de la caja. Antes había que dar un clic extra en la caja para poder
   * escribir, y ese clic se olvida (tocas Responder, escribes, y no se escribió
   * nada).
   *
   * El foco va después de pintar y no en la misma línea: al citar aparece la
   * barra de la cita ARRIBA del textarea, que lo mueve; enfocarlo antes de que
   * el navegador lo recoloque deja la vista saltando.
   */
  const responderA = (msg) => {
    setCitando(msg)
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      // El cursor al FINAL de lo que ya estuviera escrito, no al principio:
      // citar a media frase no debe partir el borrador en dos.
      const fin = ta.value.length
      ta.setSelectionRange(fin, fin)
    })
  }

  // Burbuja optimista + envío de texto. Se usa DENTRO de una tarea ya encolada
  // (no encola por su cuenta), para que el texto de una respuesta rápida y sus
  // fotos cuenten como un solo bloque indivisible en la fila.
  // `canal` viaja congelado igual que `telefono`: esta función corre DENTRO de la
  // tarea encolada, o sea cuando le toca salir, y para entonces el canal activo
  // del módulo puede ser el del chat que el vendedor abrió mientras tanto.
  const enviarTextoSuelto = async (telefono, nombre, texto, canal = '') => {
    const tmpMsg = {
      id: 'tmp_' + Date.now(), telefono, nombre, mensaje: texto,
      direccion: 'SALIENTE', timestamp: new Date().toISOString(), estado: 'enviado',
    }
    setConvs(prev => prev.map(c => c.telefono === telefono ? { ...c, msgs: [...c.msgs, tmpMsg], last: tmpMsg } : c))
    pendingRef.current[telefono] = [...(pendingRef.current[telefono] || []), tmpMsg]
    return sendReply(telefono, nombre, texto, '', canal)
  }

  // ── Quick reply con imagen ────────────────────────────────────
  // `onProgress(hechas, total)` deja que el botón muestre "2/5" sin que el panel
  // tenga que esperar a que termine todo.
  const handleQuickReply = async (reply, onProgress) => {
    if (!activeConv) return
    if (canalSinResolver()) { avisarCanalSinResolver(); return }
    // Se congelan acá: el vendedor puede cambiar de chat mientras esto sale.
    // El CANAL también, y es el que más duele: leerlo cuando cada foto sale
    // significaba que a mitad de tanda las que faltaban se iban por el número
    // del chat nuevo (a los 24 clientes que escribieron a los dos números les
    // llega por el equivocado; al resto Meta se lo rechaza y la tanda se corta).
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const canal    = canalDeEnvio()
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
    // El `canal` va también acá: un media_id de Meta vale SOLO para el phone_id
    // que lo subió, así que precachear con el canal de otra pestaña deja ids que
    // el envío de esta tanda no puede usar.
    const idsPromesa = imgs.length ? precacheMedia(imgs, canal) : Promise.resolve({})

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
      await sendInteractiveButtons(telefono, nombre, reply.text, validBtns, canal)
      avanzar()
    } else if (reply.text) {
      await enviarTextoSuelto(telefono, nombre, reply.text, canal)
      avanzar()
    }

    // Envía las imágenes en orden (WhatsApp respeta el orden de llegada). La pausa
    // era de 800 ms cuando cada envío tardaba segundos; ahora que van por media id
    // alcanza con un respiro corto.
    const ids = await idsPromesa
    for (let i = 0; i < imgs.length; i++) {
      await sendImageUrl(telefono, nombre, imgs[i], ids[imgs[i]] || '', canal)
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
    if (canalSinResolver()) { avisarCanalSinResolver(); return }
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const canal    = canalDeEnvio()
    const estadoDestino = estadoAlResponder(currentStatus)
    return encolar(telefono, async () => {
      const ok = await sendImageUrl(telefono, nombre, imageUrl, '', canal)
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
    if (canalSinResolver()) { avisarCanalSinResolver(); return }
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const canal    = canalDeEnvio()
    const estadoDestino = estadoAlResponder(currentStatus)
    return encolar(telefono, async () => {
      if (modo === 'info') {
        await enviarTextoSuelto(telefono, nombre, `${p.title}${p.price ? ` — $${p.price}` : ''}`, canal)
      }
      const ok = await sendImageUrl(telefono, nombre, p.image, '', canal)
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
    if (canalSinResolver()) return { ok: false, error: 'no sé por cuál número mandarle esto — abre el chat desde MANDI o REPUBLIC' }
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
    const canal    = canalDeEnvio()
    const estadoDestino = estadoAlResponder(currentStatus)
    return encolar(telefono, async () => {
      let archivo
      try {
        archivo = archivoDesdeDataUrl(hoja.imagen, `pedido-${hoja.pedidoId}.jpg`)
      } catch {
        return { ok: false, error: 'la imagen llegó dañada' }
      }
      const res = await subirYEnviarFoto(telefono, nombre, archivo, canal)
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
    if (canalSinResolver()) { avisarCanalSinResolver(); return }
    const validBtns = btnTexts.map((t,i) => ({ id:`btn_${i+1}`, title:t.trim() })).filter(b=>b.title)
    if (validBtns.length === 0) return
    const telefono = activeConv.telefono
    const nombre   = activeConv.nombre
    const canal    = canalDeEnvio()
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
      const result = await sendInteractiveButtons(telefono, nombre, cuerpo, validBtns, canal)
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
            // GENERAL va primero: es la cola de trabajo, la que se mira todo el día.
            // Su contador son PERSONAS distintas, y por eso NO es la suma de los
            // otros botones: quien tiene un mensaje sin contestar en los dos números
            // aparece en los dos contadores de número —correcto, son dos bandejas—
            // pero abajo, en esta cola, es UNA sola fila. Sumar contaba de más.
            // La suma queda de respaldo por si el total no llegó: prefiero un número
            // levemente alto a un botón vacío que diga "ya contestaste a todos".
            {
              id: CANAL_GENERAL, label:'GENERAL', icon:'📥', color:'#a78bfa', sub:'Los dos',
              badge: pendientesTotal ?? Object.values(pendientes).reduce((a, b) => a + (b || 0), 0),
              title:'Todos los números en una sola cola',
            },
            // Los dos siguientes son NÚMEROS (canales), no aplicaciones distintas:
            // comparten la vista de chat. El contador de pendientes es lo que
            // impide que la bandeja que no estás mirando se vuelva invisible.
            ...CANALES.map(c => ({
              id: c.id, label: c.etiqueta, icon:'💬', color: c.color, sub: c.sub,
              badge: pendientes[c.phoneId] || 0, title: c.titulo,
              // Encendido cuando estás en GENERAL y el chat abierto es de este
              // número: la pestaña deja de ser "dónde estoy" y pasa a ser
              // "por acá sale lo que escribas".
              //
              // ⚠️ `&& !canalSinResolver()`: cuando el canal del chat abierto NO
              // se puede resolver, la caja de escribir se reemplaza por el cartel
              // rojo que dice justamente que no se sabe por dónde sale la
              // respuesta. Sin esta condición, al mismo tiempo seguía encendido el
              // `◉` de la pestaña del chat ANTERIOR (`canalArmado` conserva el
              // último valor a propósito, ver la rama GENERAL de `cambiarLinea`):
              // la pantalla afirmaba "sale por MANDI" y negaba "no sé por dónde
              // sale" en el mismo golpe de vista. Manda el cartel: si no se sabe,
              // no se muestra nada armado.
              armado: linea === CANAL_GENERAL && canalArmado === c.id && !canalSinResolver(),
            })),
            { id:'SOCIAL',   label:'SOCIAL',   icon:'🌐', color:'#1877F2', sub:'FB · IG' },
            { id:'CONTACTOS',label:'CONTACTOS',icon:'👥', color:'#38bdf8', sub:'Directorio' },
            { id:'AUTO',     label:'AUTOS',    icon:'⚙️', color:'#f59e0b', sub:'Reglas' },
          ].map(({ id, label, icon, color, sub, badge = 0, title, armado = false }) => (
            <button key={id} onClick={() => cambiarLinea(id)} title={title || label} style={{
              padding:'4px 16px', border:'none', cursor:'pointer', flexShrink:0, whiteSpace:'nowrap',
              background: linea===id ? `${color}15` : 'transparent',
              // Pestaña activa = línea sólida (dónde estás parado). Canal armado
              // = línea punteada (por dónde sale la respuesta). Tienen que verse
              // distintas: si se confunden, el aviso deja de servir.
              borderBottom: linea===id ? `2px solid ${color}`
                          : armado     ? `2px dashed ${color}`
                          :              '2px solid transparent',
              borderTop: '2px solid transparent',
              fontFamily:'Outfit,sans-serif', transition:'all .2s', height:'100%',
            }}>
              <div style={{ fontSize:10, fontWeight:800, color: linea===id ? color : '#334155', letterSpacing:'1.5px', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                <span>{icon} {label}{armado ? ' ◉' : ''}</span>
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
                  // La clave lleva el canal: en GENERAL el mismo cliente tiene DOS
                  // filas y con la clave vieja React las trataba como la misma —
                  // reciclaba el nodo y una fila se quedaba pintada con los datos
                  // de la otra.
                  key={linea === CANAL_GENERAL ? `${conv.telefono}|${conv.phoneId || ''}` : conv.telefono}
                  conv={{ ...conv, nombre: displayName(conv.telefono) }}
                  // Activa = mismo teléfono Y mismo número. Sin lo segundo, abrir
                  // la fila de REPUBLIC dejaba resaltadas las DOS filas del cliente.
                  isActive={active === conv.telefono && (!conv.phoneId || !activeCanal || conv.phoneId === activeCanal)}
                  // El canal de la fila viaja con el clic: es lo que le dice a
                  // `openConv` por cuál número responde este chat. No cambia de
                  // pestaña — te quedas en GENERAL, que es como se trabaja.
                  onClick={() => openConv(conv.telefono, conv.phoneId)}
                  search={search}
                  estado={estadoFila(conv)}
                  modoIA={getModoIA(conv.telefono)}
                  temp={getTemp(conv.telefono)}
                  alerta={alertaVentana(conv.telefono, conv)}
                  msgSnippet={searchingMsgs ? matchSnippet(conv) : null}
                  // El color y la etiqueta salen del canal DE LA FILA, que ahora
                  // es un hecho y no una deducción: la lista viene de
                  // `ultimos_mensajes_canal`, o sea una fila por (cliente, número).
                  //
                  // Antes esto se calculaba con `phoneIdDe` y podía discrepar del
                  // canal por el que iba a salir el envío: la fila decía un número
                  // y la respuesta usaba otro (medido en producción: 4 filas
                  // naranjas en MANDI y 7 verdes en REPUBLIC).
                  //
                  // En MANDI/REPUBLIC manda la pestaña: ahí todas las filas son de
                  // ese número y pintarlas de otro color sería mentir.
                  colorCanal={linea === CANAL_GENERAL
                    ? colorDeCanal(conv.phoneId)
                    : colorDeCanal(phoneIdDeCanal(linea))}
                  // El chip con el nombre del canal, SOLO en GENERAL: es la única
                  // pestaña donde conviven números distintos y donde el mismo
                  // cliente sale dos veces. El color solo no alcanzaba para
                  // distinguirlas de reojo en el celular.
                  etiquetaCanal={linea === CANAL_GENERAL ? etiquetaDePhoneId(conv.phoneId) : ''}
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
          /* Todo el chat es zona de soltar, no solo la caja de escribir: la mano
             suelta la foto donde está mirando, que es la conversación. El
             `position:relative` es para la capa de "suelta acá" de abajo. */
          <div className="chat-col" style={{ position:'relative' }}
            onDragOver={alArrastrarEncima} onDragLeave={alSalirArrastrando} onDrop={alSoltar}>
            {soltarAqui && (
              <div style={{
                position:'absolute', inset:0, zIndex:50, pointerEvents:'none',
                background:'rgba(8,13,20,.82)', border:'2px dashed #25d366', borderRadius:12,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10,
              }}>
                <div style={{ fontSize:44 }}>📥</div>
                <div style={{ color:'#25d366', fontWeight:800, fontSize:15 }}>Suelta la foto acá</div>
                <div style={{ color:'#64748b', fontSize:11 }}>imágenes o un video · también funciona Ctrl+V</div>
              </div>
            )}
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
                    <MessageBubble msg={msg} allMsgs={activeConv.msgs} onResponder={responderA} />
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
              {/* Step 3c (Tarea 4): en GENERAL, con el chat abierto sin canal
                  resuelto, NO se muestra la caja de escribir — se muestra el
                  aviso en su lugar. Es un bloqueo, no un aviso que se pueda
                  ignorar: mandar por el canal por defecto sería determinista
                  pero igual de equivocado (le escribirías a un cliente de
                  REPUBLIC por el número de MANDI). Las funciones de envío
                  (handleSend, handleQuickReply, etc.) tienen la misma guardia
                  por separado, para los caminos que no pasan por esta caja
                  (respuestas rápidas y productos del panel derecho). */}
              {canalSinResolver() ? (
                <div style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.45)',
                  color: '#f87171', fontSize: 12, lineHeight: 1.5,
                }}>
                  ⚠️ <b>No sé por cuál número responderle a este chat.</b><br />
                  Ábrelo desde la pestaña de MANDI o de REPUBLIC, la que corresponda, y contéstale desde ahí.
                </div>
              ) : (<>
              {!windowOpen && lastMsg && (
                <div style={{ marginBottom:8, padding:'7px 12px', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.2)', borderRadius:8, fontSize:11, color:'#fbbf24', display:'flex', alignItems:'center', justifyContent:'center', gap:10, flexWrap:'wrap' }}>
                  <span>⚠️ Ventana de 24h cerrada — solo plantilla</span>
                  <button onClick={() => setShowTplModal(true)}
                    style={{ background:'linear-gradient(135deg,#f59e0b,#f97316)', border:'none', color:'#0b1220', fontWeight:800, fontSize:11, padding:'4px 12px', borderRadius:7, cursor:'pointer', fontFamily:'Outfit,sans-serif' }}>
                    📋 Enviar plantilla
                  </button>
                </div>
              )}
              {/* Aviso de los adjuntos: lo que se pegó no servía, o ya no cabe
                  más. Va acá arriba, pegado a la caja, porque es la respuesta a
                  un Ctrl+V que si no se queda mudo. */}
              {avisoAdjunto && (
                <div style={{ marginBottom:8, padding:'7px 12px', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:8, fontSize:11, color:'#fbbf24', display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ flex:1 }}>{avisoAdjunto}</span>
                  <button onClick={() => avisarAdjunto('')} title="Cerrar"
                    style={{ background:'transparent', border:'none', color:'#a16207', fontSize:13, cursor:'pointer', lineHeight:1, flexShrink:0 }}>✕</button>
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
                    onPaste={handlePaste}
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
                <button onClick={() => fileRef.current?.click()} style={{ width:42, height:42, flexShrink:0, background:imgFiles.length?'rgba(37,211,102,.12)':'#111c2a', border:`1px solid ${imgFiles.length?'rgba(37,211,102,.3)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:17, display:'flex', alignItems:'center', justifyContent:'center', color:imgFiles.length?'#25d366':'#475569', transition:'all .15s', position:'relative' }} title="Adjuntar imagen o video — también puedes pegar con Ctrl+V o arrastrar la foto al chat">
                  📎
                  {imgFiles.length > 0 && <span style={{ position:'absolute', top:-4, right:-4, width:16, height:16, borderRadius:'50%', background:'#25d366', color:'#080d14', fontSize:8, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center' }}>{imgFiles.length}</span>}
                </button>
                <button onClick={() => setShowBtnPanel(p=>!p)} title="Botones interactivos" style={{ width:42, height:42, flexShrink:0, background:showBtnPanel?'rgba(37,211,102,.15)':'#111c2a', border:`1px solid ${showBtnPanel?'rgba(37,211,102,.4)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', color:showBtnPanel?'#25d366':'#475569', transition:'all .15s' }}>🔘</button>
                <button onClick={() => { setShowEmoji(p=>!p); setShowBtnPanel(false) }} title="Emojis" style={{ width:42, height:42, flexShrink:0, background:showEmoji?'rgba(245,158,11,.15)':'#111c2a', border:`1px solid ${showEmoji?'rgba(245,158,11,.4)':'#1e2d3d'}`, borderRadius:11, cursor:'pointer', fontSize:20, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>😊</button>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display:'none' }} onChange={handleFileSelect} />
              </div>
              </>)}
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
