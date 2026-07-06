'use client'
export default function GuideModal({ onClose }) {
  const sections = [
    {
      title: 'Escenario 1 — Recibir mensajes en Google Sheets',
      color: '#6366f1',
      steps: [
        'En Make → Crear nuevo escenario',
        'Trigger: Google Sheets → Watch Rows',
        'Conecta tu cuenta de Google y selecciona tu Sheet',
        'En el módulo de respuesta: Webhooks → Webhook Response',
        'Body: {{toJSON(array(rows))}} — devuelve las filas como JSON',
        'Activa el escenario (botón ON)',
        'Copia la URL del webhook → pégala en ⚙ Configuración → WEBHOOK LEER',
      ],
    },
    {
      title: 'Escenario 2 — Enviar respuestas por WhatsApp',
      color: '#25d366',
      steps: [
        'Nuevo escenario en Make',
        'Trigger: Webhooks → Custom Webhook → copia la URL generada',
        'Nodo 2: HTTP → Make a Request',
        '  · Método: POST',
        '  · URL: https://graph.facebook.com/v19.0/{PHONE_NUMBER_ID}/messages',
        '  · Headers: Authorization = Bearer {TU_ACCESS_TOKEN}',
        '  · Body (JSON): {"messaging_product":"whatsapp","to":"{{telefono}}","type":"text","text":{"body":"{{mensaje}}"}}',
        'Nodo 3: Google Sheets → Add a Row (registra la respuesta enviada)',
        'Activa el escenario y pega la URL en ⚙ Configuración → WEBHOOK ENVIAR',
      ],
    },
    {
      title: 'Configurar webhook en Meta (entrada de mensajes)',
      color: '#f59e0b',
      steps: [
        'Meta for Developers → tu App → WhatsApp → Configuration',
        'Callback URL: URL de tu escenario 1 de Make',
        'Verify Token: el string que tú elijas (configúralo en Make también)',
        'Suscríbete a: messages, message_deliveries, message_reads',
        'Haz clic en Verify and Save',
      ],
    },
    {
      title: 'Estructura requerida del Google Sheet',
      color: '#ec4899',
      steps: [
        'Columna A → id_mensaje   (string único de Meta)',
        'Columna B → telefono     (521234567890, sin + ni espacios)',
        'Columna C → nombre       (nombre del contacto)',
        'Columna D → mensaje      (texto del mensaje)',
        'Columna E → direccion    (ENTRANTE | SALIENTE)',
        'Columna F → timestamp    (2024-01-15T10:32:00Z)',
        'Columna G → estado       (recibido | leido | enviado | error)',
      ],
    },
    {
      title: 'Publicar en Vercel (gratis)',
      color: '#14b8a6',
      steps: [
        'Abre una terminal en la carpeta wa-inbox',
        'npm install',
        'npm run build   ← genera la carpeta dist/',
        'Ve a vercel.com → New Project → Import tu repositorio',
        'O instala Vercel CLI: npm i -g vercel → vercel deploy',
        'Vercel te da una URL pública gratis (ej: wa-inbox.vercel.app)',
        'Opcional: en Vercel → Settings → Environment Variables agrega VITE_MAKE_READ_WEBHOOK y VITE_MAKE_SEND_WEBHOOK',
      ],
    },
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 1000, backdropFilter: 'blur(6px)',
      overflowY: 'auto', padding: '24px 0',
    }}>
      <div style={{
        background: '#0d1420', borderRadius: 22, padding: 32,
        maxWidth: 580, width: '92%',
        border: '1px solid #1e2d3d', margin: 'auto',
      }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26 }}>
          <h2 style={{ margin: 0, color: '#f1f5f9', fontSize: 18, fontWeight: 800 }}>
            📖 Guía completa — Make + Google Sheets
          </h2>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,.05)', border: '1px solid #1e2d3d',
            color: '#94a3b8', borderRadius: 8, width: 32, height: 32,
            cursor: 'pointer', fontSize: 15, fontFamily: 'inherit',
          }}>✕</button>
        </div>

        {sections.map((sec, si) => (
          <div key={si} style={{ marginBottom: 26 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 3, height: 18, background: sec.color, borderRadius: 2, flexShrink: 0 }} />
              <h3 style={{ margin: 0, color: sec.color, fontSize: 13, fontWeight: 700 }}>{sec.title}</h3>
            </div>
            {sec.steps.map((step, ii) => (
              <div key={ii} style={{ display: 'flex', gap: 10, marginBottom: 7, alignItems: 'flex-start' }}>
                <span style={{
                  minWidth: 22, height: 22, borderRadius: 6,
                  background: sec.color + '18', color: sec.color,
                  fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: 1,
                }}>{ii + 1}</span>
                <span style={{
                  fontSize: 12.5, color: step.startsWith('  ') ? '#475569' : '#94a3b8',
                  lineHeight: 1.6, fontFamily: step.startsWith('  ') ? 'monospace' : 'inherit',
                }}>{step.trim()}</span>
              </div>
            ))}
          </div>
        ))}

        <button onClick={onClose} style={{
          width: '100%', padding: '13px',
          background: 'linear-gradient(135deg,#25d366,#128c7e)',
          border: 'none', borderRadius: 12, color: '#fff',
          fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          ¡Entendido, voy a configurarlo!
        </button>
      </div>
    </div>
  )
}
