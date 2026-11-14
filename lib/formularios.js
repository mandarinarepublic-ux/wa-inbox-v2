// lib/formularios.js — 📝 FORMULARIOS dentro de WhatsApp (WhatsApp Flows de Meta).
//
// Pedido de Rodrigo (14-nov-2026): "crea la opción para pedir los datos de
// facturación y envío". En vez de mandar el texto "ayúdanos con tus datos…" y que
// el cliente conteste todo mezclado en un mensaje, le llega un botón que abre un
// formulario NATIVO de WhatsApp (sin salir del chat). Lo que llena vuelve por el
// webhook como `interactive.nfm_reply`, con cada campo separado.
//
// Cómo encaja:
//   - El formulario vive en Meta (WhatsApp Manager de la WABA). Se crea y publica
//     UNA vez con POST /api/admin/formularios?accion=crear (el token solo existe en
//     Vercel). Se manda por NOMBRE (`flow_name`), así no hay ningún id que copiar.
//   - Una respuesta rápida con `formulario = 'datos_pedido'` (columna de
//     inbox.respuestas_rapidas) sale como mensaje con ese botón (App.jsx).
//   - /api/saliente arma el payload con `payloadFormulario`.
//   - lib/wa-mensaje.js → `extraer` usa `textoRespuestaFormulario` para guardar la
//     respuesta como texto legible (se copia directo al pedido).
//
// ☠️ Un formulario publicado en Meta NO se puede editar: para cambiar campos hay que
// crear uno nuevo (subir la versión del nombre) y apuntar FORMULARIOS a ese nombre.
// ☠️ Es un mensaje interactivo: solo sale con la ventana abierta (24 h o pauta).
// Fuera de ella Meta lo rechaza (131047), como cualquier texto libre.
//
// Módulo PURO (sin red): lo prueban tests/formularios.test.js.

export const PROVINCIAS = [
  ['AZUAY', 'Azuay'], ['BOLIVAR', 'Bolívar'], ['CANAR', 'Cañar'], ['CARCHI', 'Carchi'],
  ['CHIMBORAZO', 'Chimborazo'], ['COTOPAXI', 'Cotopaxi'], ['EL_ORO', 'El Oro'],
  ['ESMERALDAS', 'Esmeraldas'], ['GALAPAGOS', 'Galápagos'], ['GUAYAS', 'Guayas'],
  ['IMBABURA', 'Imbabura'], ['LOJA', 'Loja'], ['LOS_RIOS', 'Los Ríos'], ['MANABI', 'Manabí'],
  ['MORONA_SANTIAGO', 'Morona Santiago'], ['NAPO', 'Napo'], ['ORELLANA', 'Orellana'],
  ['PASTAZA', 'Pastaza'], ['PICHINCHA', 'Pichincha'], ['SANTA_ELENA', 'Santa Elena'],
  ['SANTO_DOMINGO', 'Santo Domingo de los Tsáchilas'], ['SUCUMBIOS', 'Sucumbíos'],
  ['TUNGURAHUA', 'Tungurahua'], ['ZAMORA_CHINCHIPE', 'Zamora Chinchipe'],
]
const NOMBRE_PROVINCIA = Object.fromEntries(PROVINCIAS)

// Los campos, en el orden en que se muestran y se leen de vuelta.
const CAMPOS_FACTURA = [
  { name: 'factura_nombre', etiqueta: 'Nombre o razón social', label: 'Nombre o razón social', tipo: 'text' },
  { name: 'factura_cedula', etiqueta: 'Cédula/RUC', label: 'Cédula o RUC', tipo: 'text', min: 10, max: 13 }, // text, no number: las cédulas de Guayas empiezan con 0
  { name: 'factura_correo', etiqueta: 'Correo', label: 'Correo electrónico', tipo: 'email' },
  { name: 'factura_celular', etiqueta: 'Celular', label: 'Celular', tipo: 'phone' },
]
const CAMPOS_ENVIO = [
  { name: 'envio_nombre', etiqueta: 'Recibe', label: 'Nombre de quien recibe', tipo: 'text' },
  { name: 'envio_celular', etiqueta: 'Celular', label: 'Celular de quien recibe', tipo: 'phone' },
  { name: 'envio_provincia', etiqueta: 'Provincia' },
  { name: 'envio_ciudad', etiqueta: 'Ciudad', label: 'Ciudad', tipo: 'text' },
  { name: 'envio_direccion', etiqueta: 'Dirección' },
  { name: 'envio_referencia', etiqueta: 'Referencia' },
]

/** Los formularios que el inbox sabe mandar. La clave va en respuestas_rapidas.formulario. */
export const FORMULARIOS = {
  datos_pedido: {
    // v2 (14-nov): los dos celulares vienen prellenados con el número del chat.
    flowName: 'mandi_datos_pedido_v2',
    cta: 'Llenar mis datos',          // máx. 30 caracteres (Meta)
    pantalla: 'FACTURACION',
    titulo: '📝 Datos de facturación y envío',
  },
}

const input = (c, extra = {}) => ({
  type: 'TextInput', name: c.name, label: c.label, 'input-type': c.tipo, required: true,
  ...(c.min ? { 'min-chars': c.min } : {}), ...(c.max ? { 'max-chars': c.max } : {}),
  ...extra,
})

// Dato que el inbox le pasa al formulario al mandarlo: el celular del chat, para
// que los dos campos de celular lleguen ya escritos (el cliente puede cambiarlos).
const DATOS_PANTALLA = { celular: { type: 'string', __example__: '0991234567' } }
// ☠️ Dentro de un Form el valor inicial va en el Form (`init-values`), NO en el
// campo: Meta rechaza 'init-value' en un TextInput de Form (v2, 14-nov).

/** El celular del chat como lo escribe un ecuatoriano: 593991234567 → 0991234567. */
export function celularLocal(telefono) {
  const d = String(telefono || '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('593')) return '0' + d.slice(3)
  if (d.length === 9 && d.startsWith('9')) return '0' + d
  if (d.length === 10 && d.startsWith('0')) return d
  return d ? '+' + d : ''
}

/** El Flow JSON del formulario de datos (se sube a Meta al crearlo). */
export function flowJsonDatosPedido() {
  const ref = (pantalla, campo) => `\${screen.${pantalla}.form.${campo}}`
  const payload = {}
  for (const c of CAMPOS_FACTURA) payload[c.name] = ref('FACTURACION', c.name)
  for (const c of CAMPOS_ENVIO) payload[c.name] = `\${form.${c.name}}`
  return {
    version: '7.0',
    screens: [
      {
        id: 'FACTURACION',
        title: 'Datos de facturación',
        data: DATOS_PANTALLA,
        layout: {
          type: 'SingleColumnLayout',
          children: [{
            type: 'Form',
            name: 'form',
            'init-values': { factura_celular: '${data.celular}' },
            children: [
              { type: 'TextBody', text: 'Con estos datos sale tu factura electrónica.' },
              ...CAMPOS_FACTURA.map(c => input(c, c.name === 'factura_cedula' ? { 'helper-text': 'Cédula (10 dígitos) o RUC (13)' } : {})),
              {
                type: 'Footer', label: 'Continuar',
                'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'ENVIO' }, payload: { celular: '${data.celular}' } },
              },
            ],
          }],
        },
      },
      {
        id: 'ENVIO',
        title: 'Datos de envío',
        terminal: true,
        success: true,
        data: DATOS_PANTALLA,
        layout: {
          type: 'SingleColumnLayout',
          children: [{
            type: 'Form',
            name: 'form',
            'init-values': { envio_celular: '${data.celular}' },
            children: [
              { type: 'TextBody', text: '¿A dónde te lo enviamos? Despachamos por Servientrega.' },
              input(CAMPOS_ENVIO[0]),
              input(CAMPOS_ENVIO[1]),
              {
                type: 'Dropdown', name: 'envio_provincia', label: 'Provincia', required: true,
                'data-source': PROVINCIAS.map(([id, title]) => ({ id, title })),
              },
              input(CAMPOS_ENVIO[3]),
              { type: 'TextArea', name: 'envio_direccion', label: 'Dirección (calles y número)', required: true },
              { type: 'TextInput', name: 'envio_referencia', label: 'Referencia (opcional)', 'input-type': 'text', required: false },
              {
                type: 'Footer', label: 'Enviar mis datos',
                'on-click-action': { name: 'complete', payload },
              },
            ],
          }],
        },
      },
    ],
  }
}

/** Qué formulario es ('' si la clave no existe). */
export function formularioValido(clave) {
  const k = String(clave || '').trim()
  return FORMULARIOS[k] ? k : ''
}

/**
 * Payload de la Graph API para mandar el formulario. `dest` = { to } o { recipient }
 * (lib/cliente-sin-telefono.js). El `flow_token` vuelve en la respuesta: lleva la
 * clave del formulario para saber qué se llenó.
 */
export function payloadFormulario(dest, cuerpo, clave, { telefono = '', ahora = Date.now() } = {}) {
  const k = formularioValido(clave)
  if (!k) throw new Error(`Formulario desconocido: ${clave}`)
  const texto = String(cuerpo || '').trim()
  if (!texto) throw new Error('El formulario necesita un texto que lo presente')
  const f = FORMULARIOS[k]
  return {
    messaging_product: 'whatsapp',
    ...dest,
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: texto.slice(0, 1024) },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: `${k}:${ahora}`,
          flow_name: f.flowName,
          flow_cta: f.cta,
          flow_action: 'navigate',
          flow_action_payload: { screen: f.pantalla, data: { celular: celularLocal(telefono) } },
        },
      },
    },
  }
}

/** El `response_json` de un nfm_reply como objeto ({} si no se puede leer). */
export function datosRespuestaFormulario(interactive) {
  const raw = interactive?.nfm_reply?.response_json
  if (!raw) return {}
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return {} }
}

/**
 * Lo que llenó el cliente, como texto para el hilo ('' si no es un formulario
 * nuestro con datos). Va en líneas "Etiqueta: valor" para copiarlo al pedido.
 */
export function textoRespuestaFormulario(interactive) {
  if (interactive?.type !== 'nfm_reply') return ''
  const d = datosRespuestaFormulario(interactive)
  const val = (n) => String(d[n] ?? '').trim()
  const tieneDatos = [...CAMPOS_FACTURA, ...CAMPOS_ENVIO].some(c => val(c.name))
  if (!tieneDatos) return '📝 Envió un formulario (sin datos)'
  const linea = (c) => {
    let v = val(c.name)
    if (c.name === 'envio_provincia') v = NOMBRE_PROVINCIA[v] || v
    return v ? `${c.etiqueta}: ${v}` : ''
  }
  return [
    FORMULARIOS.datos_pedido.titulo,
    '',
    '🧾 Facturación',
    ...CAMPOS_FACTURA.map(linea).filter(Boolean),
    '',
    '🚚 Envío',
    ...CAMPOS_ENVIO.map(linea).filter(Boolean),
  ].join('\n')
}

// ── 🧾 Del formulario al PEDIDO MANUAL del CRM (14-nov-2026) ──────────────────
//
// Pedido de Rodrigo: un botón "Crear pedido" junto a la burbuja del formulario
// que abra el PEDIDO MANUAL con estos datos ya puestos. Se lee del TEXTO guardado
// (no del `raw`): el poll del inbox no trae el crudo (COLS_MSG), así que leer el
// texto es lo único que funciona igual con el chat recién llegado y con el viejo.

/** ¿Este texto es un formulario de datos lleno? → los campos, o null. */
export function datosDesdeTexto(texto) {
  const lineas = String(texto || '').split(/\r?\n/)
  if (lineas[0]?.trim() !== FORMULARIOS.datos_pedido.titulo) return null
  const porEtiqueta = (bloque) => {
    const out = {}
    let dentro = false
    for (const l of lineas) {
      const t = l.trim()
      if (t === '🧾 Facturación' || t === '🚚 Envío') { dentro = t === bloque; continue }
      if (!dentro) continue
      const i = t.indexOf(':')
      if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
    }
    return out
  }
  const f = porEtiqueta('🧾 Facturación'), e = porEtiqueta('🚚 Envío')
  const d = {}
  for (const c of CAMPOS_FACTURA) if (f[c.etiqueta]) d[c.name] = f[c.etiqueta]
  for (const c of CAMPOS_ENVIO) if (e[c.etiqueta]) d[c.name] = e[c.etiqueta]
  return Object.keys(d).length ? d : null
}

const soloDig = (s) => String(s || '').replace(/\D/g, '')
/** 0991234567 / 593991234567 → 0991234567; otro formato → '' (el CRM exige 0 + 9). */
function celularCrm(c) {
  const d = soloDig(c)
  if (/^593\d{9}$/.test(d)) return '0' + d.slice(3)
  if (/^0\d{9}$/.test(d)) return d
  if (/^9\d{8}$/.test(d)) return '0' + d
  return ''
}

/**
 * Los datos del formulario como los pide el PEDIDO MANUAL del CRM:
 * { nombre, cedula, celular, email, ciudad, direccion }. El CRM no tiene "quién
 * recibe" ni "provincia": van dentro de la dirección, para que lleguen a la guía.
 */
export function prefillPedido(d) {
  if (!d) return {}
  const mismo = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
  const recibeOtro = (d.envio_nombre && !mismo(d.envio_nombre, d.factura_nombre))
    || (d.envio_celular && soloDig(d.envio_celular) !== soloDig(d.factura_celular))
  const direccion = [
    d.envio_direccion && `Dirección: ${d.envio_direccion}`,
    d.envio_referencia && `Lugar de referencia: ${d.envio_referencia}`,
    d.envio_provincia && `Provincia: ${d.envio_provincia}`,
    recibeOtro && `Recibe: ${[d.envio_nombre, d.envio_celular].filter(Boolean).join(' · ')}`,
  ].filter(Boolean).join('\n')
  const out = {
    nombre: d.factura_nombre || d.envio_nombre || '',
    cedula: soloDig(d.factura_cedula),
    celular: celularCrm(d.factura_celular) || celularCrm(d.envio_celular),
    email: String(d.factura_correo || '').trim(),
    ciudad: d.envio_ciudad || '',
    direccion,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v))
}
