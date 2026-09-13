'use client'
// /admin/conectar-whatsapp — Enganchar (o re-enganchar) un número que vive en
// la app de WhatsApp Business de un celular, desde el propio inbox.
//
// Es el registro insertado de Meta con la opción de coexistencia. Abre el
// diálogo de Meta en una ventana; Meta manda un WhatsApp de "Facebook Business"
// al celular con un código; se toca "Conectar a la Plataforma empresarial" en
// el teléfono y se pega el código acá. Al terminar, el servidor
// (/api/admin/conectar-whatsapp) suscribe la app, ubica el número y pide la
// sincronización del historial dentro de las 24 h que exige Meta.
//
// ⚠️ Con la app en acceso ESTÁNDAR, el diálogo solo muestra los permisos de
// WhatsApp a quien tenga rol en la app de Meta (administrador/desarrollador).
// Para nuestros propios números alcanza. Si el diálogo no ofrece "conectar tu
// app de WhatsApp Business existente", el bloqueo es la revisión de la app.
import { useEffect, useRef, useState } from 'react'
import { datosDeSesionES, FEATURE_COEXISTENCIA } from '@/lib/coexistencia'

const C = { bg: '#0b0f14', card: '#131a22', border: '#243040', text: '#e6edf3', dim: '#8b98a5', green: '#25d366', orange: '#f97316', red: '#f87171' }

function Numero({ n }) {
  if (!n) return <span style={{ color: C.dim }}>sin datos</span>
  if (!n.ok) return <span style={{ color: C.red }}>error: {n.error?.message || n.status}</span>
  const sano = n.platform_type === 'CLOUD_API' && n.status === 'CONNECTED'
  return (
    <span style={{ color: sano ? C.green : C.orange, fontWeight: 700 }}>
      {n.platform_type} · {n.status}{n.is_on_biz_app ? ' · en la app del celular' : ''}
    </span>
  )
}

export default function ConectarWhatsApp() {
  const [cfg, setCfg] = useState(null)
  const [sdk, setSdk] = useState(false)
  const [sesion, setSesion] = useState(null)   // lo que Meta dice mientras corre el diálogo
  const [code, setCode] = useState('')
  const [resultado, setResultado] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const enviado = useRef(false)

  // 1. Config + estado de los canales.
  useEffect(() => {
    fetch('/api/admin/conectar-whatsapp', { cache: 'no-store' })
      .then((r) => r.json()).then(setCfg)
      .catch((e) => setError(e.message))
  }, [])

  // 2. SDK de Meta. Solo después de saber el appId.
  useEffect(() => {
    if (!cfg?.appId || window.FB) { if (window.FB) setSdk(true); return }
    window.fbAsyncInit = function () {
      window.FB.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: true, version: 'v21.0' })
      setSdk(true)
    }
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/es_LA/sdk.js'
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous'
    document.body.appendChild(s)
  }, [cfg?.appId])

  // 3. Lo que Meta cuenta durante el diálogo (session logging).
  useEffect(() => {
    const onMsg = (ev) => {
      const d = datosDeSesionES(ev.origin, ev.data)
      if (d) setSesion(d)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  // 4. Cuando hay code + waba → terminar en el servidor (una sola vez).
  useEffect(() => {
    if (!sesion?.terminado || !sesion?.wabaId || enviado.current) return
    enviado.current = true
    setOcupado(true)
    fetch('/api/admin/conectar-whatsapp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, wabaId: sesion.wabaId, phoneId: sesion.phoneId, evento: sesion.evento }),
    })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); setResultado(j) })
      .catch((e) => setError(e.message))
      .finally(() => setOcupado(false))
  }, [sesion, code])

  const abrir = () => {
    setError(''); setResultado(null); setSesion(null); setCode(''); enviado.current = false
    if (!window.FB) { setError('El SDK de Meta no cargó. Revisa el dominio autorizado en la app.'); return }
    window.FB.login(
      (resp) => {
        if (resp?.authResponse?.code) setCode(resp.authResponse.code)
        else if (!resp?.authResponse) setError('El diálogo se cerró sin terminar.')
      },
      {
        config_id: cfg.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: FEATURE_COEXISTENCIA, sessionInfoVersion: '3' },
      }
    )
  }

  const resync = async (phoneId) => {
    setOcupado(true); setError('')
    try {
      const r = await fetch('/api/admin/conectar-whatsapp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'sync', phoneId }),
      })
      setResultado(await r.json())
    } catch (e) { setError(e.message) } finally { setOcupado(false) }
  }

  return (
    <main style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Conectar un número que vive en el celular</h1>
        <p style={{ color: C.dim, margin: '0 0 18px', lineHeight: 1.5 }}>
          Para números en <b>coexistencia</b> (la app de WhatsApp Business del teléfono + la API). Al abrir el diálogo,
          Meta manda un WhatsApp de <b>Facebook Business</b> al celular con un código: ahí se toca
          <b> Conectar a la Plataforma empresarial</b> y se pega el código en la ventana. Ten el celular a mano.
        </p>

        <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: C.dim, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Estado de cada número, según Meta</div>
          {!cfg && <div style={{ color: C.dim }}>Leyendo…</div>}
          {cfg?.canales?.map((c) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
              <div><b>{c.etiqueta}</b> <span style={{ color: C.dim }}>{c.titulo}</span></div>
              <div><Numero n={c.numero} /></div>
              {c.numero?.is_on_biz_app && c.numero?.platform_type === 'CLOUD_API' && (
                <button onClick={() => resync(c.phoneId)} disabled={ocupado} style={btn(C.border)}>Volver a pedir historial</button>
              )}
            </div>
          ))}
          {cfg?.faltan?.length > 0 && <div style={{ color: C.red, marginTop: 10 }}>Faltan variables: {cfg.faltan.join(', ')}</div>}
        </section>

        <button onClick={abrir} disabled={!cfg?.listo || !sdk || ocupado} style={btn(C.green, !cfg?.listo || !sdk || ocupado)}>
          {sdk ? 'Conectar número con la app de WhatsApp Business' : 'Cargando el SDK de Meta…'}
        </button>

        {sesion && (
          <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>Lo que va diciendo Meta</div>
            <div>evento: <b>{sesion.evento || '—'}</b>{sesion.paso ? ` · paso: ${sesion.paso}` : ''}</div>
            {sesion.wabaId && <div>cuenta de WhatsApp Business: <b>{sesion.wabaId}</b></div>}
            {sesion.phoneId && <div>identificador del número: <b>{sesion.phoneId}</b></div>}
            {sesion.coexistencia && <div style={{ color: C.green }}>Terminó como coexistencia: el celular sigue con su WhatsApp.</div>}
            {sesion.cancelado && <div style={{ color: C.orange }}>Se canceló en el paso {sesion.paso || '?'}.</div>}
            {sesion.error && <div style={{ color: C.red }}>Meta reportó un error: {sesion.error}</div>}
            {ocupado && <div style={{ color: C.dim }}>Terminando el enganche en el servidor…</div>}
          </section>
        )}

        {error && <div style={{ color: C.red, marginTop: 12 }}>{error}</div>}

        {resultado && (
          <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>Resultado</div>
            {resultado.aviso && <div style={{ color: C.orange, marginBottom: 8 }}>{resultado.aviso}</div>}
            {resultado.numero && <div style={{ marginBottom: 8 }}>Número: <Numero n={{ ok: true, ...resultado.numero }} /></div>}
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: C.dim, margin: 0, overflowX: 'auto' }}>{JSON.stringify(resultado, null, 2)}</pre>
          </section>
        )}
      </div>
    </main>
  )
}

function btn(color, disabled = false) {
  return {
    background: disabled ? '#1f2937' : color, color: disabled ? '#6b7280' : '#0b0f14',
    border: 'none', borderRadius: 10, padding: '12px 18px', fontWeight: 800, fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer', width: '100%',
  }
}
