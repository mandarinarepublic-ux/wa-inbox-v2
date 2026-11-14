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
    flowName: 'mandi_datos_pedido_v1',
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
        data: {},
        layout: {
          type: 'SingleColumnLayout',
          children: [{
            type: 'Form',
            name: 'form',
            children: [
              { type: 'TextBody', text: 'Con estos datos sale tu factura electrónica.' },
              ...CAMPOS_FACTURA.map(c => input(c, c.name === 'factura_cedula' ? { 'helper-text': 'Cédula (10 dígitos) o RUC (13)' } : {})),
              {
                type: 'Footer', label: 'Continuar',
                'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'ENVIO' }, payload: {} },
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
        data: {},
        layout: {
          type: 'SingleColumnLayout',
          children: [{
            type: 'Form',
            name: 'form',
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
export function payloadFormulario(dest, cuerpo, clave, ahora = Date.now()) {
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
          flow_action_payload: { screen: f.pantalla },
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
