import { NextResponse } from 'next/server'
import { COOKIE_SESION, verificarSesion, secretoSesion } from '@/lib/sesion'
import { esRutaPublica } from '@/lib/rutas-publicas'
import { puedeEntrar } from '@/lib/acceso'

// ── La puerta del inbox ───────────────────────────────────────────────────────
// Hasta hoy esto era una URL pública: cualquiera que la conociera leía TODAS las
// conversaciones con las clientas y podía escribirles haciéndose pasar por
// Mandarina. El 6-ago se comprobó mandando un WhatsApp real desde una terminal,
// sin ninguna credencial.
//
// Tres puertas, igual que en el CRM:
//   1. PERSONA con sesión del CRM + permiso INBOX_MANDARINA en crm.usuarios
//   2. MÁQUINA con `Authorization: Bearer $INBOX_API_TOKEN`
//   3. RUTA PÚBLICA que se defiende sola (lib/rutas-publicas.js)
//
// ⚠️ AUTH_MODO manda sobre todo, y sin la variable el valor es `observar`:
//   observar → NO rechaza nada, solo anota lo que habría rechazado (arranca así)
//   bloquear → rechaza de verdad
//   apagado  → ni siquiera mira; es el interruptor de pánico
//
// ⚠️ MEDIDO el 7-ago-2026, y NO es lo que decía el plan: cambiar AUTH_MODO en
// Vercel **no surte efecto solo**. Next incrusta process.env en el bundle de Edge
// al compilar, así que el middleware sigue con el valor con el que se construyó.
// Se comprobó con tres sondas: puesta la variable en `apagado`, el middleware
// siguió anotando 3 minutos después; recién dejó de hacerlo tras redesplegar.
//
// Entonces, para usar el interruptor de pánico de madrugada:
//   1. cambiar AUTH_MODO en Vercel
//   2. `vercel redeploy <url-del-deploy-actual> --scope mandarinarepublic-6819s-projects`
// Sigue sin necesitar commit ni tocar código, pero tarda ~1 minuto, no 30 segundos.
const LOGIN = 'https://crm.apps.mandarinaec.com'

const modo = () => (process.env.AUTH_MODO || 'observar').trim().toLowerCase()

function tokenDeMaquina(req) {
  const esperado = String(process.env.INBOX_API_TOKEN || '').replace(/[^\x21-\x7E]/g, '')
  if (!esperado) return false
  const recibido = (req.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '').replace(/[^\x21-\x7E]/g, '')
  // Comparación de largo constante: el tiempo de respuesta no delata aciertos.
  if (recibido.length !== esperado.length) return false
  let dif = 0
  for (let i = 0; i < recibido.length; i++) dif |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i)
  return dif === 0
}

export async function middleware(req) {
  if (modo() === 'apagado') return NextResponse.next()

  const { pathname } = req.nextUrl
  if (esRutaPublica(pathname)) return NextResponse.next()

  const esApi = pathname.startsWith('/api/')
  let motivo = null

  const secreto = secretoSesion()
  if (!secreto) {
    motivo = 'sin-SESSION_SECRET'
  } else {
    const sesion = await verificarSesion(req.cookies.get(COOKIE_SESION)?.value, secreto)
    if (!sesion) {
      motivo = tokenDeMaquina(req) ? null : 'sin-sesion'
    } else {
      const permiso = await puedeEntrar(sesion.id)
      if (!permiso.ok) motivo = permiso.motivo
    }
  }

  if (!motivo) return NextResponse.next()

  if (modo() !== 'bloquear') {
    // MODO OBSERVACIÓN: no se rechaza nada. Esta línea es el insumo para decidir
    // si ya se puede bloquear; se lee en los registros de Vercel buscando
    // "[auth] rechazaria".
    console.log(`[auth] rechazaria ${req.method} ${pathname} — ${motivo}`)
    return NextResponse.next()
  }

  if (esApi) return NextResponse.json({ error: 'No autenticado', motivo }, { status: 401 })

  if (motivo === 'sin-permiso' || motivo === 'inactivo') {
    return new NextResponse(
      'No tienes acceso a este inbox. Pídele a un administrador que te habilite INBOX MANDARINA en el CRM.',
      { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }

  const volver = `${req.nextUrl.origin}${pathname}${req.nextUrl.search}`
  return NextResponse.redirect(`${LOGIN}/?volver=${encodeURIComponent(volver)}`)
}

// Los webhooks quedan fuera ACÁ, a nivel de configuración: así el código de
// sesión ni siquiera corre para ellos. `lib/rutas-publicas.js` es la segunda
// capa, por si alguien toca esto sin pensar.
export const config = {
  matcher: [
    // ⚠️ CADA CRON NUEVO TIENE QUE ENTRAR EN ESTA LISTA, o no corre nunca.
    //
    // Vercel llama al cron, el middleware lo manda al login y la tarea no se
    // ejecuta jamás — sin error, sin registro, sin nada. `api/cron/entregas` (el
    // aviso de mensajes que no le llegaron al cliente) se desplegó el 21-ago
    // SIN estar acá: estuvo callado desde el primer minuto, que es exactamente
    // la clase de silencio que ese aviso venía a romper.
    //
    // Sacarlos del middleware no los deja abiertos: cada ruta de cron valida
    // `CRON_SECRET` por su cuenta (ver la función `autorizado` de cada una).
    //
    // `opus/` es el codificador de audio (librería MIT, sin nada privado). Va
    // fuera porque lo carga un Worker, y un Worker que recibe el HTML del login
    // en vez del JS falla con un error que no se parece en nada a "te falta
    // sesión".
    '/((?!api/webhook|api/social/webhook|api/cron/seguimientos|api/cron/pendientes|api/cron/entregas|api/cron/pagos|api/pago-dlocal|_next/static|_next/image|opus/|favicon.ico|sw.js|icon-|manifest.webmanifest).*)',
  ],
}
