/** @type {import('next').NextConfig} */
const nextConfig = {
  // ☠️ EL LINT NO CORRE EN VERCEL A PROPÓSITO. `next build` lintea solo si
  // encuentra un `eslint.config.mjs`, y desde que existe uno eso alargaría
  // CADA despliegue — Build CPU llegó a ser el 29% de la factura y justo se
  // está bajando. El revisor corre con `npm test`, en la compu, gratis.
  // ⚠️ Esto NO lo desactiva: si alguien sube sin correr `npm test`, no hay red.
  eslint: { ignoreDuringBuilds: true },
  // El commit con el que se compiló ESTE bundle, horneado en el navegador. El
  // servidor manda el suyo en cada /api/inbox-sync: si difieren, la pestaña
  // corre código viejo y se le pide recargar (25-sep-2026: pestañas abiertas
  // desde antes del cambio de número de REPUBLIC pedían el phone_id viejo).
  env: { BUILD_CLIENTE: process.env.VERCEL_GIT_COMMIT_SHA || '' },
  // Las PÁGINAS del host viejo se mandan al dominio nuevo, porque la cookie de
  // sesión solo viaja a *.apps.mandarinaec.com y ahí nunca llegaría. Si alguien
  // se quedara en el host viejo cuando el candado bloquee, caería en un bucle de
  // login SIN mensaje de error — es lo que tumbó al CRM el 7-ago.
  //
  // Lo que NO se toca, y es lo delicado:
  //   api/   → por /api/webhook entra Meta y por /api/pago-dlocal entra dLocal,
  //            las dos apuntando al host viejo. Meta NO sigue redirecciones: un
  //            307 acá es dejar de recibir mensajes.
  //   _next/ → si a alguien le quedó un HTML viejo cacheado, sus recursos se
  //            piden al host viejo; redirigirlos los vuelve peticiones entre
  //            dominios y hay tipos (fuentes, módulos) que ahí fallan por CORS.
  //            No cuesta nada dejarlos servirse donde están.
  //
  // Estas redirecciones corren ANTES del middleware, así que el host viejo ni
  // siquiera llega a la puerta de sesión.
  async redirects() {
    return [{
      source: '/:path((?!api/|_next/).*)',
      has: [{ type: 'host', value: 'wa-inbox-v2.vercel.app' }],
      destination: 'https://inbox.apps.mandarinaec.com/:path',
      permanent: false,   // 307: si algún día hay que revertir, nadie quedó con el 308 cacheado
    }]
  },
}
module.exports = nextConfig
