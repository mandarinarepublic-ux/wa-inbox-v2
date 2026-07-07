import { google } from 'googleapis'
import { readFileSync, writeFileSync } from 'fs'

const raw = readFileSync('./.env.local', 'utf8')
const env = {}
const re = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|.*)$/gm
let m
while ((m = re.exec(raw))) {
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[m[1]] = v
}

const SHEET_ID = env.SHEET_ID
const BACKUP = process.argv.includes('--backup-path') ? process.argv[process.argv.indexOf('--backup-path') + 1] : './_backup-contactos.json'
const DO_DELETE = process.argv.includes('--execute')

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || env.GOOGLE_CLIENT_EMAIL,
    private_key: (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const sheets = google.sheets({ version: 'v4', auth })

// sheetId (gid) de la pestaña CONTACTOS
const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' })
const tab = meta.data.sheets.find(s => s.properties.title === 'CONTACTOS')
const gid = tab.properties.sheetId

const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'CONTACTOS!A:K' })
const rows = res.data.values || []
writeFileSync(BACKUP, JSON.stringify(rows, null, 2))
console.log(`Backup guardado (${rows.length} filas) en ${BACKUP}`)

const norm = (s) => String(s || '').replace(/\D/g, '')
const groups = {}
rows.forEach((r, i) => {
  const d = norm(r[0]); if (!d) return
  ;(groups[d] = groups[d] || []).push({ rowNumber: i + 1, values: r })
})

const merges = [] // { rowNumber, values } filas a reescribir (la que se conserva)
const deletes = [] // rowNumbers a borrar
for (const [d, arr] of Object.entries(groups)) {
  if (arr.length < 2) continue
  arr.sort((a, b) => a.rowNumber - b.rowNumber)
  const keep = arr[arr.length - 1]            // la más reciente (última fila)
  const width = Math.max(...arr.map(a => a.values.length))
  const merged = []
  for (let c = 0; c < width; c++) {
    // toma el valor no vacío más reciente para esa columna
    let val = ''
    for (const row of arr) { const v = row.values[c]; if (v !== undefined && String(v).trim() !== '') val = v }
    merged[c] = val
  }
  const changed = JSON.stringify(merged) !== JSON.stringify(keep.values.slice(0, width))
  if (changed) merges.push({ rowNumber: keep.rowNumber, values: merged })
  arr.slice(0, -1).forEach(a => deletes.push(a.rowNumber))
  console.log(`  ${d}: conservo f${keep.rowNumber}, borro [${arr.slice(0, -1).map(a => 'f' + a.rowNumber).join(', ')}]${changed ? ' (fusiono datos)' : ''}`)
}

console.log(`\nResumen: ${merges.length} filas a fusionar, ${deletes.length} filas a borrar.`)

if (!DO_DELETE) { console.log('\n(DRY RUN — no se modificó nada. Corre con --execute para aplicar.)'); process.exit(0) }

// 1) Fusiona datos en las filas que se conservan (antes de borrar, con índices originales)
for (const mrg of merges) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `CONTACTOS!A${mrg.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [mrg.values] },
  })
}
console.log(`Fusionadas ${merges.length} filas conservadas.`)

// 2) Borra duplicados de ABAJO hacia ARRIBA (para no descuadrar índices)
const delDesc = [...new Set(deletes)].sort((a, b) => b - a)
const requests = delDesc.map(rowNumber => ({
  deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } },
}))
await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } })
console.log(`Borradas ${delDesc.length} filas duplicadas. CONTACTOS quedó en ${rows.length - delDesc.length} filas.`)
