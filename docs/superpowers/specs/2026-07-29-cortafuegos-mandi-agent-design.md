# Diseño — Cortafuegos de MANDI AGENT, un interruptor por número

Proyecto Vercel **`wa-inbox-v2`** · producción = `main`. Fecha: 2026-07-29.
**Urgente: se quiere en pie antes del 1-ago-2026.**

---

## 1. Por qué

Desde el **1-ago-2026** Meta empieza a cobrar su IA. La decisión del dueño es
apagar la IA de Meta y trabajar solo con **MANDI AGENT** (el bot propio,
`MANDI_AGENT_URL` → `https://mandi-agent.vercel.app/api/agent`).

Hoy MANDI AGENT solo se puede apagar **chat por chat** (`conversaciones.modo_ia`).
No existe forma de pararlo entero. Si el bot se desboca —un bucle, un gasto
inesperado, una respuesta mala en masa— hay que entrar chat por chat.

Falta un **cortafuegos**: un interruptor que lo apague de golpe.

> **Ojo, y es importante:** esto controla **MANDI AGENT, nuestro bot**. La IA de
> Meta que se va a apagar el 1-ago se apaga del lado de Meta y este interruptor
> **no la toca**. Apagar esto no protege de un cobro de Meta. Son dos cosas
> distintas y el spec no las mezcla.

## 2. Alcance

**Entra:** un interruptor por **número** (MANDI y REPUBLIC por separado), en la
pestaña AUTOS, que corta las llamadas a MANDI AGENT de ese canal.

**No entra:** la IA de Meta (§1). El control por chat, que **se mantiene tal cual**.
IND, que tiene su propio repo y necesita el mismo cambio aparte.

## 3. Modelo de datos

En `inbox.automatizaciones.config` (jsonb, una fila por cuenta):

```json
"ia": { "MANDI": true, "REPUBLIC": true }
```

Dos decisiones, las dos por seguridad:

### 3.1 Booleanos planos, no `{activo: …}`

El resto de la config usa `{ activo, texto, horas }`, pero `merge()` en
`lib/automatizaciones.js` es de **un solo nivel**: un patch
`{ia:{REPUBLIC:{activo:false}}}` reemplazaría el objeto `REPUBLIC` entero. Hoy
sobrevive porque solo tendría un campo, pero es una mina para el que agregue el
segundo.

Con booleanos planos el merge de un nivel es **exactamente correcto**:
`{...base.ia, ...patch.ia}` con `{REPUBLIC:false}` deja `{MANDI:true, REPUBLIC:false}`.
No hay sub-objeto que perder.

Es la misma trampa que el handoff ya documenta para `seguimientos.caliente`.

### 3.2 La llave es el **id lógico** del canal, no el `phone_id`

`lib/canales.js` dice explícitamente que el `phone_id` de Meta **cambia si el
número se migra de cuenta** (le pasó al 3326 de IND el 28-jul). Si la config se
guardara por `phone_id`, una migración dejaría el interruptor huérfano: el switch
apuntaría a un número que ya no existe y el bot volvería a hablar solo.

Se guarda por `MANDI` / `REPUBLIC`, y el webhook traduce con `canalDePhoneId()`,
que ya existe.

## 4. Dónde se aplica

El guard va **dentro de `modoIAde()`** en `app/api/webhook/route.js`, no en cada
sitio que llama al agente:

```js
const modoIAde = (phone, phoneId) => {
  const canal = canalDePhoneId(phoneId)
  if (canal && auto?.ia?.[canal] === false) return false   // cortafuegos
  const c = contactos.find(…)
  return c ? c.modoIA !== false : false
}
```

Los dos consumidores ya tienen el canal a mano:

- `saludarSiCorresponde(phone, name, canal)` — línea ~251
- la auto-respuesta, con `m.phoneId` — línea ~334

Poniéndolo en `modoIAde` hay **una sola fuente**: no puede pasar que un camino
respete el cortafuegos y otro no. Es la lección de los cuatro bugs del 27-29 jul,
donde había cuatro caminos hacia `/api/saliente` y solo uno inyectaba el canal.

### 4.1 Precedencia

**Apagado global gana siempre.** Si el canal está apagado, da igual que un chat
tenga `modo_ia='IA'`: no se llama al agente. Si está prendido, manda el
interruptor por chat de siempre.

El estado por chat **no se toca ni se reescribe**. Al volver a prender el canal,
cada chat vuelve a como estaba. El cortafuegos tapa, no borra.

## 5. Efecto lateral que hay que saber

`saludarSiCorresponde` hace `if (!auto || modoIAde(phone)) return`: hoy no saluda
cuando la IA está prendida, porque el propio agente saluda y si no habría doble
mensaje.

Al apagar el canal, `modoIAde` pasa a devolver `false` → **el saludo automático
se vuelve elegible**. Hoy no cambia nada porque `saludo_nuevo` está **apagado**
(se apagó a mano el 28-jul), pero si algún día se prende, apagar el bot hace que
empiece a saludar el saludo automático. Es coherente —alguien tiene que
recibir al cliente— pero no debe sorprender.

## 6. Valor inicial: PRENDIDO

`DEFAULTS.ia = { MANDI: true, REPUBLIC: true }`.

Arranca prendido **a propósito**: el cortafuegos no debe cambiar el
comportamiento actual al desplegarse. Si arrancara apagado, el deploy mataría el
bot en silencio, que es justo el tipo de sorpresa que este trabajo quiere
eliminar. Solo un clic del dueño lo apaga.

Esto es distinto de los saludos y seguimientos, que arrancan apagados porque
**mandan mensajes nuevos**. El cortafuegos no manda nada: solo deja de bloquear.

## 7. Canal desconocido

Si llega un `phone_id` que `canalDePhoneId()` no reconoce, el guard **no
bloquea** (el bot sigue funcionando) y se loguea un aviso.

Se elige así porque el fallo contrario —fallar cerrado— dejaría el bot mudo en
silencio ante un cambio de `phone_id`, exactamente lo que pasó con el 3326 y
exactamente la familia de fallos que se está combatiendo. Un bot que gasta de
más se ve en la factura; un bot mudo no se ve hasta que se pierden ventas.

## 8. Interfaz

Tarjeta nueva en `components/Automatizaciones.jsx`, arriba de todo (es la más
importante): **"🤖 MANDI AGENT"**, con un interruptor por canal, recorriendo
`CANALES` de `lib/canales.js` para que agregar un número no exija tocar la
pantalla.

Requisitos, heredados del bug 4.4 del handoff:

- El switch **se guarda solo** (patch mínimo), sin "Guardar cambios".
- Si el guardado falla, el switch **vuelve donde estaba** y avisa. Nunca puede
  quedar apagado en pantalla y prendido en la base.
- Cuando está apagado, se ve **claramente** que ese número tiene el bot detenido:
  no puede ser un detalle gris.

## 9. Pruebas

Sobre la función de decisión, no sobre la pantalla:

1. Canal apagado + chat con `modo_ia='IA'` → **no** se llama al agente.
2. Canal prendido + chat en `HUMANO` → no se llama (el de siempre sigue mandando).
3. Canal prendido + chat en `IA` → se llama.
4. Apagar REPUBLIC **no** afecta a MANDI.
5. `phone_id` desconocido → no bloquea (§7).
6. El patch de un canal **no borra** el otro (§3.1).

## 10. Fuera de alcance, anotado

- **IND** necesita el mismo cortafuegos en su repo (`ind-inbox-next`).
- La IA de Meta se apaga en Meta, no acá (§1).
