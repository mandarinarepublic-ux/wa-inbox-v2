import { google } from 'googleapis'

// Hoja de WhatsAppMandarinaSales
const SHEET_ID = process.env.SHEET_ID || '1ZQ_vIhKsDBnAUjitOB3zP-4MDbdmsv7hdDgnqNbOkak'

const MAX_CELL = 49000
function safeCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.length > MAX_CELL) return s.slice(0, MAX_CELL)
  return s
}

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  })
}

export async function getSheets() {
  const auth = getAuth()
  return google.sheets({ version: 'v4', auth })
}

// ── Leer hoja completa ────────────────────────────────────────────
export async function readSheet(sheetName) {
  const sheets = await getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:AZ`,
  })
  return res.data.values || []
}

// ── Agregar fila ──────────────────────────────────────────────────
export async function appendRow(sheetName, values) {
  const sheets = await getSheets()
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:A`,
    valueInputOption: 'RAW',
    requestBody: { values: [values.map(safeCell)] },
  })
}

// ── Actualizar celda puntual ──────────────────────────────────────
export async function updateCell(sheetName, rowNumber, colLetter, value) {
  const sheets = await getSheets()
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!${colLetter}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[safeCell(value)]] },
  })
}

// ── Actualizar fila completa ──────────────────────────────────────
export async function updateRow(sheetName, rowNumber, values) {
  const sheets = await getSheets()
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values.map(safeCell)] },
  })
}

// ── Buscar fila por valor en columna ─────────────────────────────
// Devuelve { rowNumber, values } o null
// rowNumber es el número real de fila en Sheets (base 1)
export async function findRowByValue(sheetName, colIndex, value) {
  const rows = await readSheet(sheetName)
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][colIndex] || '').trim() === String(value).trim()) {
      return { rowNumber: i + 1, values: rows[i] }
    }
  }
  return null
}
