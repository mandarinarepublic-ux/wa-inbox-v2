import * as SB from './inbox-supabase.js'

// Columnas de CONTACTOS:
// A=Telefono B=Nombre C=Alias D=Estado E=WaId F=? G=ModoIA H=IdVenta I=Notas J=Refuerzo1 K=Refuerzo2 L=Temperatura

export function mapContactRow(row) {
  return {
    telefono: String(row[0] || ''),
    nombre:   row[1] || '',
    alias:    row[2] || '',
    // Normaliza el estado: quita espacios (incl. no-rompibles  ) y baja a minúsculas.
    // Sin esto, una celda como "SOPORTE " (con espacio, típico al escribir a mano) quedaba
    // como "soporte " y NO coincidía con el filtro de la bandeja → el caso "desaparecía".
    estado:   (String(row[3] || '').replace(/[\s ]+/g, ' ').trim().toLowerCase() || 'pendiente'),
    waId:     row[4] || '',
    modoIA:   (row[6] || 'IA').toUpperCase() !== 'HUMANO',
    idVenta:  String(row[7] || '').trim(),
    notas:    row[8] || '',
    // Eje 2: temperatura del lead (col L). '' = sin clasificar.
    temperatura: String(row[11] || '').trim().toLowerCase(),
  }
}

export async function getContactos(canal) {
  return SB.getContactosSupabase(canal)
}

// Upsert de un contacto que ACABA de escribir (lo llama el webhook de Meta).
export async function registrarContactoEntrante(telefono, nombre, waId, username = '') {
  return SB.registrarContactoEntranteSupabase(telefono, nombre, waId, username)
}

/**
 * Estado de bandeja. `phoneId` dice EN QUÉ CANAL se cambia.
 *
 * Sin `phoneId` solo se escribe el estado viejo de `conversaciones` (el que lee
 * IND); con él se escribe además la fila de `bandeja` de ese número, que es la
 * que manda en esta app. Que sea opcional no es pereza: el CRM y cualquier
 * llamador externo siguen funcionando igual sin saber de canales.
 */
export async function updateEstado(telefono, estado, phoneId = '') {
  return SB.updateEstadoSupabase(telefono, estado, phoneId)
}

export async function updateModoIA(telefono, modo) {
  // modo: 'IA' | 'HUMANO'
  return SB.updateModoIASupabase(telefono, modo)
}

export async function updateNotas(telefono, notas) {
  return SB.updateNotasSupabase(telefono, notas)
}

export async function updateAlias(telefono, alias) {
  return SB.updateAliasSupabase(telefono, alias)
}

// Col H = IdVenta → se setea cuando se crea un pedido (botón CREAR PEDIDO).
export async function updateIdVenta(telefono, idVenta) {
  return SB.updateIdVentaSupabase(telefono, idVenta)
}

// Gestión (port desde IND): etapa, 📌, 🤫, tipo, promesas, pedidos del CRM.
export async function updateEtapa(telefono, etapa, por = 'humano', opciones = {}) {
  return SB.updateEtapaSupabase(telefono, etapa, por, opciones)
}
export async function updateDeuda(telefono, nota, por = 'humano', opciones = {}) {
  return SB.updateDeudaSupabase(telefono, nota, por, opciones)
}
export async function updateSinAutomaticos(telefono, on) {
  return SB.updateSinAutomaticosSupabase(telefono, on)
}
export async function updateTipoContacto(telefono, tipo) {
  return SB.updateTipoContactoSupabase(telefono, tipo)
}
export async function revisarPromesa(telefono, datos) {
  return SB.revisarPromesaSupabase(telefono, datos)
}
export async function marcarRespuestaHumana(telefono) {
  return SB.marcarRespuestaHumanaSupabase(telefono)
}
export async function reclamarReactivacion(telefono, datos) {
  return SB.reclamarReactivacionSupabase(telefono, datos)
}
export async function getEstadoBandeja(telefono, phoneId) {
  return SB.getEstadoBandejaSupabase(telefono, phoneId)
}
export async function getPedidosPorTelefono() {
  return SB.getPedidosPorTelefonoSupabase()
}

// Tracking del cron de seguimientos. Solo Supabase.
export async function marcarSeguimiento(telefono, ts = null) {
  if (typeof SB.marcarSeguimientoSupabase !== 'function') return { ok: false }
  return SB.marcarSeguimientoSupabase(telefono, ts)
}
export async function marcarAlertaVentana(telefono, ts = null) {
  if (typeof SB.marcarAlertaVentanaSupabase !== 'function') return { ok: false }
  return SB.marcarAlertaVentanaSupabase(telefono, ts)
}
// Enfriamiento del aviso push de mensaje nuevo.
export async function marcarPush(telefono, ts = null) {
  if (typeof SB.marcarPushSupabase !== 'function') return { ok: false }
  return SB.marcarPushSupabase(telefono, ts)
}
// Lo llama el envío de un humano: contestar reinicia el enfriamiento.
export async function limpiarPush(telefono) {
  if (typeof SB.limpiarPushSupabase !== 'function') return { ok: false }
  return SB.limpiarPushSupabase(telefono)
}
// Recordatorio de pendientes por Telegram (lo llama el cron /api/cron/pendientes).
export async function marcarAvisoTelegram(telefono, ts = null) {
  if (typeof SB.marcarAvisoTelegramSupabase !== 'function') return { ok: false }
  return SB.marcarAvisoTelegramSupabase(telefono, ts)
}

// Recetas de bienvenida por anuncio (lib/recetas.js decide; esto solo persiste).
export async function marcarReceta(telefono, ahoraIso) {
  if (typeof SB.marcarRecetaSupabase !== 'function') return { ok: false }
  return SB.marcarRecetaSupabase(telefono, ahoraIso)
}
export async function registrarAnuncioVisto(args) {
  if (typeof SB.registrarAnuncioVistoSupabase !== 'function') return { ok: false }
  return SB.registrarAnuncioVistoSupabase(args)
}
// Reclama el aviso ANTES de mandarlo (guardia atómica); liberarAvisoAnuncio lo
// devuelve si el envío a Telegram falló, para que el próximo referral reintente.
export async function reclamarAvisoAnuncio(sourceId) {
  if (typeof SB.reclamarAvisoAnuncioSupabase !== 'function') return { ok: false, reclamado: false }
  return SB.reclamarAvisoAnuncioSupabase(sourceId)
}
export async function liberarAvisoAnuncio(sourceId) {
  if (typeof SB.liberarAvisoAnuncioSupabase !== 'function') return { ok: false }
  return SB.liberarAvisoAnuncioSupabase(sourceId)
}
// Devuelve [] (no { ok:false }) cuando falta la función SB: el llamador la
// esparce (`...getAnunciosResumen()`) dentro de un arreglo, y un objeto ahí
// revienta.
export async function getAnunciosResumen() {
  if (typeof SB.getAnunciosResumenSupabase !== 'function') return []
  return SB.getAnunciosResumenSupabase()
}
export async function setEtiquetaAnuncio(sourceId, etiqueta) {
  if (typeof SB.setEtiquetaAnuncioSupabase !== 'function') return { ok: false }
  return SB.setEtiquetaAnuncioSupabase(sourceId, etiqueta)
}
