import PwaRegister from './pwa-register'

export const metadata = {
  title: 'WA Inbox — Mandarina Republic',
  description: 'WhatsApp CRM para Mandarina Republic',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'WA Inbox',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport = {
  themeColor: '#0b1622',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, padding: 0 }}>
        <PwaRegister />
        {children}
      </body>
    </html>
  )
}
