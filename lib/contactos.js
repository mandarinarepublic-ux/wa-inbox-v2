import { readSheet, findRowByValue, updateCell, appendRow } from './sheets.js'
import { readContactos } from './cache.js'
import { revalidateTag } from 'next/cache'
import { dualRead, dualWrite } from './supabase.js'
import * as SB from './inbox-supabase.js'

// Columnas de CONTACTOS:
// A=Telefono B=Nombre C=Alias D=Estado E=WaId F=? G=ModoIA H=IdVenta I=Notas J=Refuerzo1 K=Refuerzo2 L=Temperatura

export function mapContactRow(row) {
  return {
    telefono: String(row[0] || ''),
    nombre:   row[1] || '',
    alias:    row[2] || '',
    // Normaliza el estado: quita espacios (incl. no-rompibles  ) y baja a minúsculas.
    // Sin esto, una celda como "SOPORTE " (con espacio, típico al escribir a mano) quedaba
    // como "soporte " y NO coincidía con el filtro de la bandeja → el caso "desaparecía".
    estado:   (String(row[3] || '').replace(/[\s ]+/g, ' ').trim().toLowerCase() || 'pendiente'),
    waId:     row[4] || '',
    modoIA:   (row[6] || 'IA').toUpperCase() !== 'HUMANO',
    idVenta:  String(row[7] || '').trim(),
    notas:    row[8] || '',
    // Eje 2: temperatura del lead (col L). '' = sin clasificar. (Sheets = respaldo; el
    // tracking del cron vive solo en Supabase, no en columnas de la hoja.)
    temperatura: String(row[11] || '').trim().toLowerCase(),
  }
}

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

// Devuelve TODAS las filas que coinciden con el teléfono. CONTACTOS tiene duplicados
// (mismo número en varias filas, a veces con estados distintos). El inbox indexa
// "última fila gana"; si solo escribiéramos en la primera, el estado se revertiría al
// leer la otra fila. Por eso actualizamos TODAS. Prioriza dígitos exactos; si no hay
// exactos, cae a match tolerante (últimos 9 dígitos).
async function findContactoRows(telefono) {
  const rows = await readSheet('CONTACTOS')
  const obj = soloDigitos(telefono)
  if (!obj) return []
  const exactas = [], tolerantes = []
  for (let i = 0; i < rows.length; i++) {
    const cel = soloDigitos(rows[i][0])
    if (!cel) continue
    if (cel === obj) exactas.push({ rowNumber: i + 1, values: rows[i] })
    else if (cel.endsWith(obj.slice(-9)) || obj.endsWith(cel.slice(-9))) tolerantes.push({ rowNumber: i + 1, values: rows[i] })
  }
  return exactas.length ? exactas : tolerantes
}

// Escribe una celda (por letra de columna) en TODAS las filas del mismo teléfono.
// Si el contacto NO existe en CONTACTOS (ej. chats que solo tenían mensajes de
// sistema), lo CREA con ese valor — así archivar/cambiar estado nunca falla.
async function setContactoCell(telefono, colLetter, value) {
  const found = await findContactoRows(telefono)
  if (!found.length) {
    const colIndex = colLetter.toUpperCase().charCodeAt(0) - 65
    const row = []
    for (let i = 0; i <= colIndex; i++) row[i] = i === 0 ? String(telefono) : (i === colIndex ? value : '')
    await appendRow('CONTACTOS', row)
    revalidateTag('contactos')
    return { ok: true, creado: true }
  }
  for (const f of found) await updateCell('CONTACTOS', f.rowNumber, colLetter, value)
  // Invalida la caché de lectura para que el próximo poll refleje el cambio ya
  // (sin esperar los 8s de TTL). El frontend además tiene override optimista.
  revalidateTag('contactos')
  return { ok: true, filas: found.length }
}

export async function getContactos() {
  return dualRead(
    async () => {
      // Cacheado 8s (readContactos): una lectura por ventana sirve a todas las pestañas.
      const rows = await readContactos()
      return rows
        .filter(r => r[0] && r[0] !== 'Telefono' && r[0] !== 'telefono') // saltar header
        .map(mapContactRow)
    },
    () => SB.getContactosSupabase(),
  )
}

// Upsert de un contacto que ACABA de escribir (lo llama el webhook de Meta).
export async function registrarContactoEntrante(telefono, nombre, waId) {
  return dualWrite(
    () => registrarContactoEntranteSheets(telefono, nombre, waId),
    () => SB.registrarContactoEntranteSupabase(telefono, nombre, waId),
    'contacto.entrante',
  )
}

// Si no existe, lo crea en PENDIENTE con la IA APAGADA. Si existe, solo rellena nombre/waId
// vacíos — NUNCA pisa el nombre/alias/estado editado a mano.
async function registrarContactoEntranteSheets(telefono, nombre, waId) {
  const found = await findContactoRows(telefono)
  if (!found.length) {
    // A=Telefono B=Nombre C=Alias D=Estado E=WaId F=? G=ModoIA
    await appendRow('CONTACTOS', [
      String(telefono), nombre || '', '', 'PENDIENTE', waId || '', '', 'HUMANO',
    ])
    revalidateTag('contactos')
    return { ok: true, creado: true }
  }
  const f = found[0]
  if (nombre && !String(f.values[1] || '').trim()) await updateCell('CONTACTOS', f.rowNumber, 'B', nombre)
  if (waId   && !String(f.values[4] || '').trim()) await updateCell('CONTACTOS', f.rowNumber, 'E', waId)
  revalidateTag('contactos')
  return { ok: true, creado: false }
}

export async function updateEstado(telefono, estado) {
  return dualWrite(
    () => setContactoCell(telefono, 'D', String(estado).toUpperCase()),
    () => SB.updateEstadoSupabase(telefono, estado),
    'contacto.estado',
  )
}

export async function updateModoIA(telefono, modo) {
  // modo: 'IA' | 'HUMANO'
  return dualWrite(
    () => setContactoCell(telefono, 'G', modo),
    () => SB.updateModoIASupabase(telefono, modo),
    'contacto.modoIA',
  )
}

export async function updateNotas(telefono, notas) {
  return dualWrite(
    () => setContactoCell(telefono, 'I', notas),
    () => SB.updateNotasSupabase(telefono, notas),
    'contacto.notas',
  )
}

export async function updateAlias(telefono, alias) {
  return dualWrite(
    () => setContactoCell(telefono, 'C', alias),
    () => SB.updateAliasSupabase(telefono, alias),
    'contacto.alias',
  )
}

// Col H = IdVenta → se setea cuando se crea un pedido (botón CREAR PEDIDO).
export async function updateIdVenta(telefono, idVenta) {
  return dualWrite(
    () => setContactoCell(telefono, 'H', idVenta),
    () => SB.updateIdVentaSupabase(telefono, idVenta),
    'contacto.idVenta',
  )
}

// Col L = Temperatura del lead (Eje 2). Manual 100%. '' / null limpia la clasificación.
export async function updateTemperatura(telefono, temperatura) {
  const val = temperatura ? String(temperatura).toLowerCase() : ''
  return dualWrite(
    () => setContactoCell(telefono, 'L', val),
    () => SB.updateTemperaturaSupabase(telefono, val),
    'contacto.temperatura',
  )
}

// Tracking del cron de seguimientos. Solo Supabase (Sheets no tiene estas columnas);
// no bloquean nada si el backend es Sheets.
export async function marcarSeguimiento(telefono, ts = null) {
  if (typeof SB.marcarSeguimientoSupabase !== 'function') return { ok: false }
  return SB.marcarSeguimientoSupabase(telefono, ts)
}
export async function marcarAlertaVentana(telefono, ts = null) {
  if (typeof SB.marcarAlertaVentanaSupabase !== 'function') return { ok: false }
  return SB.marcarAlertaVentanaSupabase(telefono, ts)
}
