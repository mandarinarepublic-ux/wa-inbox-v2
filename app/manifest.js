// Manifest PWA — permite instalar Wa-Inbox como app en el celular.
export default function manifest() {
  return {
    name: 'WA Inbox — Mandarina Republic',
    short_name: 'WA Inbox',
    description: 'WhatsApp CRM para Mandarina Republic',
    start_url: '/inbox',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b1622',
    theme_color: '#0b1622',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
