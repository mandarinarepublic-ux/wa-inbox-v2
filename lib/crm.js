// lib/crm.js
// Lectura del Google Sheet de MANDARINACRM (la fuente de verdad de PEDIDOS — ventas
// por WhatsApp, NO Shopify). Reutiliza la MISMA Service Account del inbox
// (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY); solo cambia el spreadsheetId.
//
// REQUISITO: el Sheet del CRM debe estar compartido (lectura) con el email de la
// Service Account del inbox. Si ambos proyectos usan la misma SA, ya funciona.
//
// Estructura especial del CRM: fila1=título, fila2=headers, fila3=descripción,
// fila4+=datos → headers = rows[1], datos = rows.slice(3). Mapeamos por NOMBRE de
// columna (no por índice) para ser robustos ante reordenamientos.
//
// CUOTA: como el historial cambia poco y todas las aperturas de chat quieren los
// mismos datos globales, cacheamos las 3 hojas con unstable_cache (60s). Así una
// lectura por minuto por hoja sirve a todos → no revienta la cuota de Sheets.
import { google } from 'googleapis'
import { unstable_cache } from 'next/cache'

const CRM_SHEET_ID = process.env.MANDARINACRM_SHEET_ID || '13MiI4BPE247suz539TtObvS3L0SqhMu5KnvIg2YkAfs'

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
}

async function readCrmSheet(sheetName) {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CRM_SHEET_ID,
    range: `${sheetName}!A:AZ`,
  })
  return res.data.values || []
}

// rows crudas → array de objetos { HEADER: valor } (offset especial del CRM)
function rowsToObjects(rows) {
  const headers = rows[1] || []
  return rows.slice(3).map(r => {
    const o = {}
    headers.forEach((h, i) => { const k = String(h || '').trim(); if (k) o[k] = r[i] ?? '' })
    return o
  })
}

export const readCrmPedidos = unstable_cache(
  async () => rowsToObjects(await readCrmSheet('PEDIDOS')),
  ['crm:pedidos'], { revalidate: 60, tags: ['crm'] }
)

export const readCrmDetalle = unstable_cache(
  async () => rowsToObjects(await readCrmSheet('DETALLE_PEDIDO')),
  ['crm:detalle'], { revalidate: 60, tags: ['crm'] }
)

export const readCrmClientes = unstable_cache(
  async () => rowsToObjects(await readCrmSheet('CLIENTES')),
  ['crm:clientes'], { revalidate: 60, tags: ['crm'] }
)
