# SOCIAL: bandejas y estados — plan de implementación

> **Para quien ejecute esto:** usar `superpowers:subagent-driven-development`, tarea
> por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que SOCIAL tenga dos bandejas independientes —Mensajes y Comentarios— y
el mismo vocabulario de estados que WhatsApp, más un selector de emojis.

**Arquitectura:** los datos ya vienen separados por `tipo` desde
`lib/social-agrupar.js`, así que la bandeja es un filtro de primer nivel en la
interfaz. El vocabulario de estados se unifica con el de WhatsApp en la base
(minúsculas) y se agrega una columna `temperatura`. El selector de emojis se copia de
`App.jsx` a `SocialInbox.jsx` por decisión explícita del dueño.

**Spec:** `docs/superpowers/specs/2026-07-28-social-bandejas-y-estados-design.md`

## Restricciones globales

- **No se toca `components/App.jsx`.** Corre el WhatsApp de producción.
- **Un comentario es público:** ni fotos, ni catálogo, ni links de pago, ni datos de
  entrega. La bandeja de Comentarios lleva una franja de aviso fija.
- El vocabulario de estados es **el de WhatsApp, en minúsculas**: `pendiente`,
  `atendido`, `venta`, `soporte`, `archivado`. Nada de `VENTAPROCESO`.
- La temperatura es **100 % manual**: nada la cambia sola.
- Estado y temperatura se escriben filtrando por `cuenta + canal + tipo + sender_id`.
  **El `tipo` no es negociable**: sin él, archivar un comentario archiva el DM.
- Comentarios y commits en español, explicando el porqué.
- **Verificar en celular**, no solo en pantalla ancha.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| migración Supabase | vocabulario en minúsculas + columna `temperatura` |
| `lib/social-supabase.js` | leer y escribir `temperatura`; estado ya filtra por tipo |
| `app/api/social/estado/route.js` | acepta también `temperatura` |
| `components/SocialInbox.jsx` | dos bandejas, filtros por bandeja, emojis |
| `tests/social.test.js` | pruebas de la lógica pura que se agregue |

---

### Tarea 1: Datos — vocabulario unificado y temperatura

**Archivos:** migración Supabase, `lib/social-agrupar.js`, `lib/social-supabase.js`,
`app/api/social/estado/route.js`, `tests/social.test.js`

- [ ] **Paso 1: Migración**

```sql
-- Vocabulario igual al de WhatsApp: minúsculas. En la base solo hay PENDIENTE y
-- ATENDIDO (35 filas); VENTAPROCESO y ARCHIVADO nunca se usaron.
update inbox.social_mensajes set estado = lower(estado);

-- Temperatura del lead (Eje 2 de WhatsApp). 100% manual: nada la cambia sola.
alter table inbox.social_mensajes
  add column if not exists temperatura text;
```

- [ ] **Paso 2: Prueba que falla**

En `tests/social.test.js`, para una función nueva `normalizarEstado` en
`lib/social-agrupar.js`:

```js
import { normalizarEstado } from '../lib/social-agrupar.js'

test('normalizarEstado pasa a minusculas', () => {
  assert.equal(normalizarEstado('PENDIENTE'), 'pendiente')
  assert.equal(normalizarEstado('Atendido'), 'atendido')
})

test('normalizarEstado traduce el vocabulario viejo de SOCIAL', () => {
  assert.equal(normalizarEstado('VENTAPROCESO'), 'venta')
})

test('normalizarEstado cae a pendiente ante un valor desconocido o vacio', () => {
  assert.equal(normalizarEstado(''), 'pendiente')
  assert.equal(normalizarEstado(null), 'pendiente')
  assert.equal(normalizarEstado('loquesea'), 'pendiente')
})
```

- [ ] **Paso 3: Implementar `normalizarEstado` y exponer `temperatura`**

En `lib/social-agrupar.js`: la función, y que `filaAMensaje` y
`agruparConversaciones` normalicen el estado y arrastren `temperatura` a la
conversación (el último valor no vacío gana, igual que el estado).

En `lib/social-supabase.js`: agregar `temperatura` al `select`, y que
`updateSocialEstadoSupabase` acepte cambiar estado **o** temperatura, manteniendo el
filtro por `cuenta + canal + tipo + sender_id`.

En `app/api/social/estado/route.js`: aceptar `temperatura` además de `estado`.

- [ ] **Paso 4: Verificar** — `npm test`, `npm run build`, y comprobar contra la base
      que los 35 registros quedaron en minúsculas.

- [ ] **Paso 5: Commit**

---

### Tarea 2: Las dos bandejas

**Archivos:** `components/SocialInbox.jsx`

- [ ] **Paso 1: Selector de bandeja**

Estado nuevo `bandeja` (`'mensajes' | 'comentarios'`), por defecto `'mensajes'`.
Dos pestañas arriba de la lista, con el mismo peso visual que las de MANDI /
REPUBLIC / SOCIAL. La lista filtra por `tipo` según la bandeja.

Al cambiar de bandeja se cierra la conversación abierta (`setSelected(null)`), igual
que ya hace `cambiarFiltro` — si no, queda en pantalla un chat que no pertenece a la
bandeja.

- [ ] **Paso 2: Filtros por bandeja**

- Mensajes: 🔴 Pendientes · 🟢 Atendidos · 💰 Ventas · 🎧 Soporte · ⚫ Archivados,
  más 🔥 Caliente · 🌤️ Tibio · ❄️ Frío. Mismos iconos, etiquetas y colores que
  `App.jsx` (leerlos de ahí como referencia, **sin modificar ese archivo**).
- Comentarios: 🔴 Pendientes · 🟢 Atendidos · ⚫ Archivados.

- [ ] **Paso 3: Quitar lo que la bandeja reemplaza**

Se van la etiqueta 💬 PÚBLICO / ✉️ PRIVADO de cada fila y los filtros
"💬 Comentarios" / "✉️ Mensajes". En Comentarios, el aviso de "esto es público" pasa
a ser una **franja fija arriba de la bandeja**, no un badge por fila.

- [ ] **Paso 4: Botones de estado y temperatura en la cabecera del chat**

Los mismos que WhatsApp, con el vocabulario nuevo. La temperatura solo en Mensajes.

- [ ] **Paso 5: Que el poll no pise un cambio recién hecho**

El poll de 8 s tiene que respetar un cambio local reciente. `App.jsx` lo resuelve con
un override con vencimiento (`localTempRef`); replicar esa idea. Sin esto, marcas
🔥 Caliente y a los ocho segundos lo ves saltar al valor viejo.

- [ ] **Paso 6: Verificar** — build, y en pantalla angosta (~360 px) que las dos
      bandejas y sus filtros quepan sin descuadrar el envío.

- [ ] **Paso 7: Commit**

---

### Tarea 3: Selector de emojis

**Archivos:** `components/SocialInbox.jsx`

- [ ] **Paso 1: Copiar el selector**

Copiar de `components/App.jsx` (líneas ~51-90) las categorías `EMOJI_CATS` y el
componente del selector. **Leer `App.jsx`, no modificarlo.** Es una copia
deliberada: decisión del dueño, porque la lista no va a cambiar y se usa poco.

Dejar un comentario que diga que es una copia y por qué, para que quien agregue un
emoji sepa que va en dos sitios.

- [ ] **Paso 2: Botón en el compositor**

Junto a los demás. Inserta el emoji en la posición del cursor del textarea, no al
final. Disponible en las dos bandejas: un emoji es texto.

- [ ] **Paso 3: Verificar** — build, y que en ~360 px el compositor siga sin
      descuadrarse con el botón nuevo.

- [ ] **Paso 4: Commit**

---

### Tarea 4: Verificación en producción

- [ ] **1. WhatsApp intacto** — bandejas, temperaturas y contadores de MANDI igual
      que hoy. Si esto falla, se revierte todo.
- [ ] **2.** Las dos bandejas muestran solo lo suyo y los contadores cuadran con la
      base.
- [ ] **3.** Marcar 🟢 Atendido en un comentario **no** toca el DM de ese cliente.
- [ ] **4.** Marcar 🔥 Caliente en un DM persiste tras recargar y tras el poll de 8 s.
- [ ] **5.** En Comentarios no hay 💰 Ventas, ni 🎧 Soporte, ni temperaturas.
- [ ] **6.** El emoji entra donde está el cursor, en las dos bandejas.
- [ ] **7.** En celular, todo cabe y se puede escribir.

```sql
select tipo, estado, coalesce(temperatura,'—') temp, count(*)
  from inbox.social_mensajes group by 1,2,3 order by 1,4 desc;
```
