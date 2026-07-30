# Diseño — El cron despierta a la IA (solo MANDI)

Repos: `wa-inbox-next` (proyecto Vercel `wa-inbox-v2`) y `mandi-agent` (proyecto `mandi-agent`).
Producción = `main` en los dos. Fecha: 2026-07-30.

**Alcance: solo MANDI.** IND va después, cuando esto esté validado en vivo (§8).

---

## 1. Qué se quiere

Hoy el cron de seguimientos solo sabe mandar un texto fijo, y **se salta** los chats
donde el bot está activo. La regla pedida es:

- **Bot activo** → el cron lo **despierta** para que retome él la conversación.
- **Bot apagado** → el cron manda el texto automático de siempre.

## 2. El agujero que esto cierra

`app/api/cron/seguimientos/route.js` decide con:

```js
if (seg.solo_ia_apagada && c.modoIA === true) continue
```

Mira el interruptor **por chat** y no el cortafuegos **por número** que se desplegó
hoy. Consecuencia: con el número apagado pero el chat marcado en IA, el cron se salta
el chat creyendo que "lo maneja el bot" — y el bot está detenido. **Ese lead caliente
no recibe ni bot ni seguimiento: se queda sin nadie.**

Con este cambio, cada chat cae siempre en uno de los dos caminos. Nunca en ninguno.

> ⚠️ **Pero no al desplegar.** El agujero se cierra cuando se pone
> `solo_ia_apagada` en `false` (§5), no al subir el código. Mientras siga en `true`
> —que es como sale a producción, a propósito— esos chats se siguen saltando igual
> que hoy. Es deliberado: el despliegue no debe cambiar el comportamiento, y esta
> funcionalidad cuesta tokens. Pero conviene no creer que el problema desaparece
> solo por desplegar.

## 3. Cómo se despierta al bot

`mandi-agent` ya recibe `source` en su cuerpo (`api/agent.js:189`), pero hoy solo lo
usa para registro. El cron lo llamará con:

```json
{ "phone": "593…", "name": "…", "message": "", "source": "seguimiento" }
```

y el agente, al ver ese origen, **no responde a un mensaje** (no hay ninguno):
construye una reanudación a partir del historial que ya lee.

**Por qué una señal aparte y no una instrucción escrita dentro del `message`:** el
agente trata `message` como lo que dijo el cliente. Una frase tipo *"[sistema] lleva
23 h sin responder"* podría acabar contestada literalmente, o mezclada en la respuesta
que ve el cliente. La señal por `source` no puede filtrarse al texto.

## 4. Lo que decide el camino

El cron usa **la misma función que el webhook**, `decidirIA({ config, phoneId, contacto })`
de `lib/ia-canal.js`:

```js
const botActivo = decidirIA({ config: auto, phoneId: c.phoneId, contacto: c })
```

Una sola fuente para "¿va a contestar el bot?". Es la lección de los cuatro bugs del
27-29 jul: cuando esa pregunta se responde en dos sitios, tarde o temprano divergen.

## 5. Encendido en dos tiempos

`seguimientos.solo_ia_apagada` (hoy `true`) cambia de significado y pasa a ser el
interruptor de esta funcionalidad:

| Valor | Comportamiento |
|---|---|
| `true` (hoy) | El cron **se salta** los chats con el bot activo. Exactamente lo de ahora. |
| `false` | El cron **despierta** al bot en esos chats. |

**Desplegar no cambia nada**, porque el valor actual es `true`. La funcionalidad se
enciende con un cambio de configuración cuando haya créditos, no con un despliegue.

Es el mismo criterio que el cortafuegos: el código sale a producción inerte y lo
activa una persona.

## 6. Reutilizar en vez de duplicar

Llamar al agente y mandar su respuesta (texto + fotos, en orden, quitando las URLs del
texto) ya está resuelto en `responderConIA`, dentro de `app/api/webhook/route.js`.

Se **mueve a `lib/responder-ia.js`** y lo importan el webhook y el cron. Movimiento
puro, sin cambio de lógica, como se hizo con `extraer()`.

Copiarlo sería repetir el error que produjo el bug de las fotos saliendo por el número
equivocado: dos caminos que hay que acordarse de mantener iguales. Y aquí el riesgo es
peor, porque ese código decide **qué se le manda a un cliente**.

## 7. Lo que NO cambia

- Los filtros del cron: solo temperatura marcada a mano, no archivado, sin pedido
  creado, **dentro de la ventana de 24 h**, y **uno por ventana** (`ultimo_seguimiento_at`).
- El texto fijo sigue saliendo igual cuando el bot está apagado.
- El envío sale por el número al que escribió el cliente (`Canal: c.phoneId`).
- Nada del webhook ni de las bandejas.

## 8. Límites conocidos

- **Cuesta tokens.** Cada chat despertado es una llamada a Anthropic. Con la cuenta
  sin créditos el agente devuelve error; el cron lo registra y sigue con el siguiente,
  sin mandar nada. **No se puede probar de punta a punta hasta recargar.**
- **Solo MANDI.** IND necesita más que un porte: su configuración **no tiene bloque
  `seguimientos`** y **le falta `CRON_SECRET`**, así que su cron hoy ni corre.
- Si el agente tarda o falla, ese chat se queda sin seguimiento **en esa ventana**: no
  hay reintento. Se prefiere no insistir a arriesgar un doble mensaje al cliente.

## 9. Riesgos y reversa

| Riesgo | Mitigación |
|---|---|
| Que empiece a mandar mensajes sin querer | Imposible al desplegar: `solo_ia_apagada` sigue en `true` (§5). |
| Que el agente responda algo raro al despertarse | Se prueba con un chat propio antes de encenderlo de verdad. |
| Romper la respuesta normal del webhook al mover `responderConIA` | Movimiento puro, verificado comparando lo borrado contra lo añadido. |
| Doble mensaje a un cliente | El tope de uno por ventana no se toca, y se marca el seguimiento igual por cuál de los dos caminos haya ido. |

**Reversa:** `git revert` + redeploy en cada repo. No hay cambio de esquema ni de datos.

## 10. Fuera de alcance

- IND (§8).
- Reintentar cuando el agente falla.
- Que el bot decida **si** merece la pena retomar: si el cron lo despierta, responde.
