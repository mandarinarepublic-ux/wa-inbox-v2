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

export async function getContactos() {
  return SB.getContactosSupabase()
}

// Upsert de un contacto que ACABA de escribir (lo llama el webhook de Meta).
export async function registrarContactoEntrante(telefono, nombre, waId) {
  return SB.registrarContactoEntranteSupabase(telefono, nombre, waId)
}

export async function updateEstado(telefono, estado) {
  return SB.updateEstadoSupabase(telefono, estado)
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

// Col L = Temperatura del lead (Eje 2). Manual 100%. '' / null limpia la clasificación.
export async function updateTemperatura(telefono, temperatura) {
  const val = temperatura ? String(temperatura).toLowerCase() : ''
  return SB.updateTemperaturaSupabase(telefono, val)
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
