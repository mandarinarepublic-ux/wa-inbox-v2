export const metadata = {
  title: 'WA Inbox — Mandarina Republic',
  description: 'WhatsApp CRM para Mandarina Republic',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  )
}
