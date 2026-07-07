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

// Busca la fila del contacto por teléfono con match TOLERANTE (formato/prefijo).
// Antes usaba match exacto → si el formato difería, no encontraba el contacto y el
// cambio de estado (PENDIENTE→ATENDIDO) fallaba en silencio.
async function findContactoRow(telefono) {
  const rows = await readSheet('CONTACTOS')
  const obj = soloDigitos(telefono)
  if (!obj) return null
  for (let i = 0; i < rows.length; i++) {
    const cel = soloDigitos(rows[i][0])
    if (!cel) continue
    if (cel === obj || cel.endsWith(obj.slice(-9)) || obj.endsWith(cel.slice(-9))) {
      return { rowNumber: i + 1, values: rows[i] }
    }
  }
  return null
}

export async function getContactos() {
  const rows = await readSheet('CONTACTOS')
  return rows
    .filter(r => r[0] && r[0] !== 'Telefono' && r[0] !== 'telefono') // saltar header
    .map(mapContactRow)
}

export async function updateEstado(telefono, estado) {
  const found = await findContactoRow(telefono)
  if (!found) throw new Error(`Contacto no encontrado: ${telefono}`)
  await updateCell('CONTACTOS', found.rowNumber, 'D', estado.toUpperCase())
  return { ok: true }
}

export async function updateModoIA(telefono, modo) {
  // modo: 'IA' | 'HUMANO'
  const found = await findContactoRow(telefono)
  if (!found) throw new Error(`Contacto no encontrado: ${telefono}`)
  await updateCell('CONTACTOS', found.rowNumber, 'G', modo)
  return { ok: true }
}

export async function updateNotas(telefono, notas) {
  const found = await findContactoRow(telefono)
  if (!found) throw new Error(`Contacto no encontrado: ${telefono}`)
  await updateCell('CONTACTOS', found.rowNumber, 'I', notas)
  return { ok: true }
}

export async function updateAlias(telefono, alias) {
  const found = await findContactoRow(telefono)
  if (!found) throw new Error(`Contacto no encontrado: ${telefono}`)
  await updateCell('CONTACTOS', found.rowNumber, 'C', alias)
  return { ok: true }
}
