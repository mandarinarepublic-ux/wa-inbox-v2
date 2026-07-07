import { readSheet, findRowByValue, updateCell } from './sheets.js'

// Columnas de CONTACTOS:
// A=Telefono B=Nombre C=Alias D=Estado E=WaId F=? G=ModoIA H=IdVenta I=Notas J=Refuerzo1 K=Refuerzo2

export function mapContactRow(row) {
  return {
    telefono: String(row[0] || ''),
    nombre:   row[1] || '',
    alias:    row[2] || '',
    estado:   (row[3] || 'PENDIENTE').toLowerCase(),
    waId:     row[4] || '',
    modoIA:   (row[6] || 'IA').toUpperCase() !== 'HUMANO',
    idVenta:  String(row[7] || '').trim(),
    notas:    row[8] || '',
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
async function setContactoCell(telefono, colLetter, value) {
  const found = await findContactoRows(telefono)
  if (!found.length) throw new Error(`Contacto no encontrado: ${telefono}`)
  for (const f of found) await updateCell('CONTACTOS', f.rowNumber, colLetter, value)
  return { ok: true, filas: found.length }
}

export async function getContactos() {
  const rows = await readSheet('CONTACTOS')
  return rows
    .filter(r => r[0] && r[0] !== 'Telefono' && r[0] !== 'telefono') // saltar header
    .map(mapContactRow)
}

export async function updateEstado(telefono, estado) {
  return setContactoCell(telefono, 'D', String(estado).toUpperCase())
}

export async function updateModoIA(telefono, modo) {
  // modo: 'IA' | 'HUMANO'
  return setContactoCell(telefono, 'G', modo)
}

export async function updateNotas(telefono, notas) {
  return setContactoCell(telefono, 'I', notas)
}

export async function updateAlias(telefono, alias) {
  return setContactoCell(telefono, 'C', alias)
}
