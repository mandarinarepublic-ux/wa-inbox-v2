// lib/config.js
// Con la migración a Next.js los datos se leen directamente de Google Sheets
// via Service Account. Solo queda configurable el webhook de envío de Make.
export const CFG = {
  MAKE_SEND_WEBHOOK: '/api/saliente', // proxy interno → Make
  POLL_INTERVAL: 8, // segundos entre polling
}
