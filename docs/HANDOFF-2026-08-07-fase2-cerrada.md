# HANDOFF — Fase 2 CERRADA: el inbox de MANDI ya tiene candado

Fecha: 7-ago-2026, ~17:40 UTC. Escrito al terminar la sesión.

- Spec: `docs/superpowers/specs/2026-08-06-login-crm-y-pedido-en-inbox-design.md`
- Plan ejecutado: `docs/superpowers/plans/2026-08-07-fase-2-candado-inbox-mandi.md`
- Handoff anterior: `docs/HANDOFF-2026-08-07-fase2-candado-inbox.md`

---

## 1. Estado: el candado está CERRADO y funcionando

`AUTH_MODO=bloquear` en producción. Verificado contra producción:

| | resultado |
|---|---|
| API sin cookie | **401** `{"error":"No autenticado","motivo":"sin-sesion"}` |
| Página sin cookie | **307** al login del CRM, con `volver` de vuelta al inbox |
| Meta WhatsApp `/api/webhook` | **403** (su propia firma) — intacto |
| Meta FB/IG `/api/social/webhook` | **403** — intacto |
| dLocal `/api/pago-dlocal` | **405** — intacto |
| Cron `/api/cron/seguimientos` | **401 propio** de `CRON_SECRET`, NO del candado |
| Páginas del host viejo | **307** al dominio nuevo; las `/api/*` NO se movieron |

Probado en vivo: se entró con la cuenta **AND**, y entraron y salieron mensajes
reales con `delivered`/`read`.

**Commits de la fase:** `e71b088` → `5306b47`.

## 2. Lo que salió mal, porque es lo que más enseña

Al encender el bloqueo se perdieron **3 mensajes salientes** (1 texto + 2 fotos),
entre las 17:10:33 y las 17:11:07. Los reenvió Rodrigo a mano.

```
17:06:46  último saliente OK
17:07     entra AUTH_MODO=bloquear
17:10:33  POST /api/upload-foto   401
17:10:55  POST /api/saliente      401   ← el mensaje perdido
17:11:07  POST /api/upload-foto   401
17:15+    todo vuelve a salir, delivered/read
```

**La recepción nunca se cortó** — los entrantes siguieron sin un solo hueco.

**Causa:** el navegador desde el que estaba enviando no tenía todavía la sesión
puesta. El candado hizo exactamente lo suyo.

**Lo que de verdad falló fue el aviso.** `postSaliente` devolvía un error genérico
y la pantalla decía "no se pudo enviar", nunca "tu sesión no está activa". Por eso
se vivió como "se perdieron 3 chats" en vez de "tengo que volver a entrar".

**Arreglado en `5306b47`:** `lib/sesion-caida.js` + `components/AvisoSesion.jsx`.
Se intercepta `fetch` UNA vez en vez de parchear las 25 llamadas de
`api-client.js` más las sueltas de los componentes. La barra **no** manda al login
sola, a propósito: sacarte en medio de un mensaje largo o de una foto a medio
subir pierde el trabajo. 10 pruebas en `tests/sesion-caida.test.js`.

## 3. Decisión tomada: se saltó la ventana de observación

El plan pedía 24-48 h en modo observación antes de bloquear. **Se corrió unos 40
minutos.** Rodrigo confirmó que **el inbox de MANDI lo atiende solo él**, con lo
que la ventana perdía casi todo su sentido: existía para descubrir a otras
personas y a llamadores desconocidos. Se aceptó el riesgo residual sabiendo que
revertir son ~1 minuto.

**Riesgo que queda vivo:** un proceso que corra con menos frecuencia que diaria
—un escenario de Make por horario, un script de alguien— empezaría a recibir 401
sin que nadie se entere. **Si algo raro aparece en los próximos días, mirar acá
primero.**

## 4. PENDIENTES, en orden de importancia

### 4.1 Comprobar el aviso en vivo (5 minutos, primero de todo)
Se desplegó pero **nadie lo ha visto todavía** con una sesión real cayéndose.
Cómo probarlo sin romper nada:

1. Con el inbox abierto y funcionando, en OTRA pestaña entra al CRM y **cierra
   sesión** (comparten cookie, así que eso mata la del inbox).
2. Vuelve al inbox e intenta escribir.
3. Tiene que aparecer la barra roja arriba con el botón **Volver a entrar**, y ese
   botón tiene que devolverte al inbox después de entrar.

### 4.2 Repartir el permiso `INBOX_MANDARINA`
Al 7-ago, de 14 personas en `crm.usuarios` **solo 2** lo tienen: Andrés Admin
(`uuid-001`) y Xavier Castillo (`uuid-002`). ⚠️ **La cuenta `RODRIGO`
(`uuid-010`, VENDEDOR) NO lo tiene** — si algún día entras con esa, te rebota.

### 4.3 Volver a aceptar los avisos push
El push está atado al origen. Al pasar a `inbox.apps.mandarinaec.com` hay que
**volver a dar permiso una vez** por dispositivo. No afecta enviar ni recibir,
pero si nadie avisa parece una caída.

### 4.4 Los 502 de `/api/media` — NO son del candado
Se ven 502 al cargar fotos. Comprobado que **son anteriores**: 25 de ellos vienen
del deploy de hace dos días, previo a todo esto. Es un problema real de carga de
fotos, sin diagnosticar, que merece su propia sesión.

### 4.5 `/api/conversacion`
Sigue abierta la decisión de borrarla. La ventana de observación fue tan corta
que **no alcanzó a delatar si alguien la llama**. Ahora está protegida por el
candado, así que ya no devuelve historiales a cualquiera; el pendiente es
cosmético.

## 5. Lo que sigue

- **Fase 3** — PEDIDO MANUAL: la pantalla `nuevo-pedido` del CRM incrustada en el
  panel derecho (`?embed=1`, `postMessage`, `frame-ancestors`). El botón con IA
  se conserva como segundo camino. **Es lo que Rodrigo quiere de verdad.**
- **Fase 4** — `mandi-agent/api/crear-pedido.js`: hoy acepta `POST` de cualquiera
  y crea pedidos reales en el CRM, con el vendedor quemado como `MANDI-WA`.
  Ojo: **el botón CREAR PEDIDO del inbox llama a ese endpoint**, así que cerrarlo
  sin tocar el inbox rompe el botón.
- **Fase 5** — repetir todo esto en `ind-inbox-next` con `INBOX_INDSTORE`.
  `lib/acceso.js` ya lo contempla con `INBOX_PERMISO`. `SESSION_SECRET` **ya está
  cargado** en `ind-inbox-v2`. Copiar también `AvisoSesion` — sin él, IND repite
  el problema de los 3 mensajes.

## 6. Trampas que esta sesión midió, y que valen para la Fase 5

1. **`AUTH_MODO` NO surte efecto sin redesplegar.** Next incrusta `process.env` en
   el bundle de Edge al compilar. Medido: con la variable en `apagado`, el
   middleware siguió igual 3 minutos y dos sondas después. El procedimiento real
   del interruptor de pánico es:
   ```bash
   printf 'apagado' | vercel env add AUTH_MODO production --force
   vercel redeploy <url-del-deploy-actual> --scope mandarinarepublic-6819s-projects
   ```
   ~1 minuto, sin commit ni tocar código.

2. **Un `git push` a `main` no siempre dispara build.** Le pasó a `fdf70f4`; hubo
   que correr `vercel --prod --yes`. Confirmar con `vercel ls <proy> --prod`.

3. **La URL vieja `wa-inbox-v2.vercel.app` no se puede apagar**: ahí llegan los
   webhooks de Meta y dLocal. Solo se redirigen las páginas, nunca las `/api/*`.

4. **Para saber si una pausa de mensajes es una caída, mide los huecos normales
   primero.** MANDI tuvo 27 huecos de más de 10 minutos en 24 h, el más largo de
   4 h 18. Sin ese número, un silencio normal parece una caída:
   ```sql
   with huecos as (
     select recibido_en - lag(recibido_en) over (order by recibido_en) as hueco
     from inbox.webhook_eventos
     where cuenta='MANDI' and recibido_en > now() - interval '24 hours')
   select count(*) filter (where hueco > interval '10 minutes') as huecos_10min,
          max(hueco) as el_mas_largo from huecos;
   ```

5. **El CRM y el inbox comparten cookie.** Cerrar sesión en el CRM cierra el
   inbox en el mismo instante. Es nuevo y sorprende.
