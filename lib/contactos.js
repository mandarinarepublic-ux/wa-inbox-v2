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

export async function getContactos() {
  const rows = await readSheet('CONTACTOS')
  return rows
    .filter(r => r[0] && r[0] !== 'Telefono' && r[0] !== 'telefono') // saltar header
    .map(mapContactRow)
}

export async function updateEstado(telefono, estado) {
  const found = await findRowByValue('CONTACTOS', 0, telefono)
  if (!found) throw new Error(`Contacto no encontrado: ${telefono}`)
  await updateCell('CONTACTOS', found.rowNumber, 'D', estado.toUpperCase())
  return { ok: true }
}

export async function updateModoIA(telefono, modo) {
  // modo: 'IA' | 'HUMANO'
  const found = await findRowByValue('CONTACTOS', 0, telefono)
  if (!found) throw new Error(`Contacto no encontrado: ${telefono}`)
  await updateCell('CONTACTOS', found.rowNumber, 'G', modo)
  return { ok: true }
}

export async function updateNotas(telefono, notas) {
  const found = await findRowByValue('CONTACTOS', 0, telefono)
  if (!found) throw new Error(`Contacto no encontrado: ${telefono}`)
  await updateCell('CONTACTOS', found.rowNumber, 'I', notas)
  return { ok: true }
}

export async function updateAlias(telefono, alias) {
  const found = await findRowByValue('CONTACTOS', 0, telefono)
  if (!found) throw new Error(`Contacto no encontrado: ${telefono}`)
  await updateCell('CONTACTOS', found.rowNumber, 'C', alias)
  return { ok: true }
}
