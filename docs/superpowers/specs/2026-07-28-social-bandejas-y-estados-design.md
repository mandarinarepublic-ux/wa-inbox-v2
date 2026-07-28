# SOCIAL: bandejas independientes y los estados de WhatsApp — diseño

**Fecha:** 2026-07-28
**Estado:** aprobado

## De dónde sale esto

Dos reclamos del dueño, en sus palabras:

> "horrible como arreglaste la conversación.. hubiera sido más fácil que sean
> bandejas independientes.. una bandeja de mensajes directos, otra bandeja de
> comentarios.. acá no entiendo y es confuso y con mucha probabilidad de error"

> "tampoco colocaste los subestados que tenemos en whatsapp de pendiente,
> atendido, caliente.. etc"

Tiene razón en los dos. El trabajo anterior separó comentarios y mensajes **en los
datos**, pero en pantalla los dejó mezclados en una sola lista, distinguidos por una
etiqueta por fila. Eso obliga al vendedor a **leer un badge en cada fila** para saber
si está a punto de escribir en público: pone la seguridad en su atención, que es
donde no hay que ponerla. Con bandejas separadas el modo deja de ser una etiqueta y
pasa a ser **dónde estás parado**.

Y SOCIAL quedó con un vocabulario de estados propio, distinto al de WhatsApp — dos
idiomas para lo mismo, que es lo que produce errores al saltar de pestaña.

## Lo que hay hoy contra lo que debe haber

| | WhatsApp | SOCIAL hoy |
|---|---|---|
| Bandeja | 🔴 pendiente · 🟢 atendido · 💰 venta · 🎧 soporte · ⚫ archivado | PENDIENTE · VENTAPROCESO · ATENDIDO · ARCHIVADO |
| Temperatura | 🔥 caliente · 🌤️ tibio · ❄️ frío (100 % manual) | no existe |
| Alerta | ⏰ lead caliente cerca de las 24 h de silencio | no existe |

En la base solo se usan `PENDIENTE` (25 filas) y `ATENDIDO` (10). `VENTAPROCESO` y
`ARCHIVADO` nunca se usaron, así que unificar el vocabulario es casi gratis.

## La forma

```
SOCIAL
├── ✉️ MENSAJES        ← DM de FB e IG. Aquí se vende.
│   🔴 Pendientes  🟢 Atendidos  💰 Ventas  🎧 Soporte  ⚫ Archivados
│   🔥 Caliente  🌤️ Tibio  ❄️ Frío
│   Herramientas: fotos, catálogo, link de pago, datos de entrega
│
└── 💬 COMENTARIOS     ← público.
    🔴 Pendientes  🟢 Atendidos  ⚫ Archivados
    Franja fija de aviso arriba de la bandeja, no un badge por fila
    Herramientas: solo texto
```

Al entrar, **Mensajes** por defecto: es donde está el volumen y donde se vende.

**Por qué Comentarios lleva menos estados** (decisión del dueño): un comentario o lo
contestaste o no. La venta y la temperatura del lead se siguen en el DM, que es donde
ocurren. Meter ahí 💰 Ventas y 🎧 Soporte sería vocabulario que nadie usa.

## Lo que desaparece, y es parte del punto

- La etiqueta 💬 PÚBLICO / ✉️ PRIVADO en cada fila — redundante dentro de su bandeja.
- Los filtros "💬 Comentarios" y "✉️ Mensajes" — los reemplaza la bandeja.
- Buena parte de la lógica de "¿qué puedo hacer aquí?" en el componente: la respuesta
  pasa a depender de en qué bandeja estás, no de inspeccionar cada conversación.

## Datos

**Vocabulario unificado con WhatsApp**, en minúsculas: `pendiente`, `atendido`,
`venta`, `soporte`, `archivado`. Migración: `PENDIENTE`→`pendiente`,
`ATENDIDO`→`atendido`. No hay filas con los otros dos valores.

**Columna nueva** `inbox.social_mensajes.temperatura` (text, nulable): `caliente`,
`tibio`, `frio`. 100 % manual, igual que en WhatsApp — nada la cambia sola.

Estado y temperatura se escriben **por conversación**, filtrando por
`cuenta + canal + tipo + sender_id`, como ya hace `updateSocialEstadoSupabase` desde
el arreglo de anoche. El `tipo` en ese filtro no es negociable: sin él, archivar un
comentario archivaba también el DM del cliente.

## Manejo de errores

- Cambiar estado o temperatura es optimista en pantalla y se confirma contra el
  servidor; si falla, se revierte y se avisa. Hoy el update optimista ya existe y es
  coherente con el servidor: mantenerlo así.
- El poll de 8 s no puede pisar un cambio recién hecho por el vendedor. WhatsApp
  resuelve esto con un override local con vencimiento (`localTempRef` en `App.jsx`);
  SOCIAL necesita lo mismo o el estado "salta" al valor viejo durante unos segundos.

## Cómo se verifica

1. **WhatsApp intacto**: bandejas, temperaturas y contadores de MANDI igual que hoy.
2. Las dos bandejas de SOCIAL muestran solo lo suyo, y los contadores cuadran con la
   base.
3. Marcar 🟢 Atendido en un comentario **no** toca el DM de ese cliente, y al revés.
4. Marcar 🔥 Caliente en un DM persiste tras recargar y tras el poll de 8 s.
5. En Comentarios no aparecen 💰 Ventas ni 🎧 Soporte ni las temperaturas.
6. En celular: las dos bandejas y sus filtros caben sin descuadrar el envío.
7. La franja de "esto es público" se ve siempre en Comentarios, sin depender de fila.

## Fuera de alcance

- La alerta ⏰ de lead caliente cerca de las 24 h: va después, cuando la temperatura
  ya tenga uso real.
- Autenticación de `/api/social/*`: es el siguiente ticket y excede esto.
