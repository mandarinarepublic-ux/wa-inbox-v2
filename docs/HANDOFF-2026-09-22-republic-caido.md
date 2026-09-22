# HANDOFF — 21/22-sep-2026: REPUBLIC caído de la API (NO resuelto, bloqueado en Meta)

**Estado: el número de REPUBLIC lleva desde el 5-sep sin recibir ni enviar por la
API.** El celular sigue perfecto y atendiendo. El re-enganche está **bloqueado
por el nivel de acceso de la app en Meta**, no por nuestro código: no hay nada
que arreglar en este repo.

| Repo | Commit al cerrar |
|---|---|
| `wa-inbox-v2` | `237f836` (tarjeta de re-enganche en AUTOS, PR #7) |
| `ind-inbox-v2` | sin tocar |

> ⚠️ El 9804 de IND se cayó igual el **11-sep** y sigue igual de caído. Son los
> **dos números en coexistencia**; los dos números normales (MANDI y el 3326 de
> IND) nunca se movieron. Lo de acá aplica tal cual allá.

---

## 1. Cronología (UTC)

```
05-sep 20:58   último mensaje ENTRANTE de REPUBLIC
05-sep 23:05   último SALIENTE
06-sep 22:57   último evento de Meta de esa WABA (un `read`)
06-sep →       CERO eventos. Ni uno, ni crudo, en 16 días.
11-sep         diag: ruta /api/admin/meta-waba (solo lectura)
12-sep         diag: ?accion=listar, ?accion=borrar-numero, ?accion=app
12-sep         /admin/conectar-whatsapp (registro insertado con coexistencia)
21-sep         se enlaza esa página desde AUTOS (PR #7) — hasta ese día nadie
               podía llegar a ella sin saberse la dirección de memoria
22-sep         el diálogo de Meta se planta: la app no tiene acceso avanzado
```

**No hubo aviso.** A diferencia del 9804 en agosto, Meta **no** mandó ningún
`account_update` / `ACCOUNT_OFFBOARDED`. Los últimos `statuses` son `delivered`
y `read` limpios. Se cortó en seco.

---

## 2. Por qué pasaron 16 días sin que nadie se enterara

**En coexistencia el celular es el dueño del número.** Siguió recibiendo y
contestando con total normalidad; lo único que se cortó fue la copia hacia el
inbox. Sin error en pantalla, sin un solo 5xx en Vercel, sin alarma. La pestaña
de REPUBLIC mostraba una lista congelada, que es **indistinguible de un día
tranquilo**.

> Esta es la lección cara del mes: **el inbox no dice nada cuando un canal se
> queda mudo.** Mientras eso no exista, la próxima caída también se descubre
> semanas después.

---

## 3. El diagnóstico de Meta (22-sep)

`GET /api/admin/meta-waba?canal=REPUBLIC`:

```
platform_type      ON_PREMISE          ← debería ser CLOUD_API
status             DISCONNECTED        ← debería ser CONNECTED
throughput.level   NOT_APPLICABLE      ← debería ser STANDARD
code_verification_status  NOT_VERIFIED
is_on_biz_app      true
quality_rating     GREEN
```

Es **exactamente** el cuadro del 9804 en agosto (`HANDOFF-2026-08-10-caida-9804.md`,
§1.4): durante la caída `ON_PREMISE` + `NOT_APPLICABLE`; al volver, `CLOUD_API` +
`STANDARD`, y los mensajes entraron en el mismo minuto. Esa es la señal a vigilar.

☠️ **`is_on_biz_app: true` MIENTE.** Se comprobó en el celular: en la app de
WhatsApp Business no hay ningún vínculo. Ese registro es un cascarón huérfano,
no un enganche vivo. Cuando las dos puntas no coinciden, la que miente es Meta.

---

## 4. Lo que se descartó, con evidencia

Esto ahorra horas la próxima vez. **Nada de esto era el problema:**

| Hipótesis | Cómo se descartó |
|---|---|
| El código está roto | `/api/webhook` guarda el POST **crudo antes de parsear** (`guardarEventoCrudoSupabase`, línea 700). Si Meta mandara algo, la fila estaría aunque el código fallara. **Cero filas en 16 días.** Y el mismo archivo atiende a MANDI, que recibe normal |
| Se rompió la suscripción de la app | `apps_suscritas: ["MandarinaSalesApp"]`. **Nunca se rompió** |
| Faltan campos de webhook | `?accion=app`: la app tiene `messages`, `history`, `smb_message_echoes`, `smb_app_state_sync`, `account_update` y las de plantillas, todas `active: true` |
| El token caducó o perdió permisos | Usuario del sistema, `is_valid: true`, `expires_at: 0`, con `whatsapp_business_management` y `whatsapp_business_messaging` |
| La cuenta está restringida | WABA `ACTIVE`, `account_review_status: APPROVED`, `business_verification_status: verified` |
| Castigo por volumen | `quality_rating: GREEN` |
| Volvió con otro phone_id u otra WABA | En 25 días las únicas WABAs que escriben a MANDI son la de MANDI, la de REPUBLIC (muerta), la página y la de Instagram. Ninguna nueva |
| Se borró la app del celular | Confirmado con el dueño: **no se borró nada** |

---

## 5. El bloqueo actual

El diálogo de Meta (`/admin/conectar-whatsapp`) responde:

```
La app de socio no tiene los permisos avanzados de mensajes y administración de
WhatsApp Business necesarios para el registro. (#2655111)
```

**MandarinaSalesApp (`931686799639248`) tiene acceso ESTÁNDAR** a
`whatsapp_business_messaging` y `whatsapp_business_management`. El registro
insertado exige **AVANZADO**, y con la app en modo Live solo aparecen en el flujo
los permisos aprobados por revisión.

⚠️ **`debug_token` NO sirve para ver esto.** Muestra qué permisos tiene el
*token*; el nivel de acceso es una propiedad de la *app* y no sale ahí. Por eso
se ve `whatsapp_business_management` en la lista y el diálogo igual lo rechaza.

Ya existe una solicitud de revisión **armada y sin enviar** (`No enviada`) con 13
permisos + el nivel de la Marketing API.

⚠️ **Enviarla no es gratis:** Meta revisa *"las solicitudes nuevas y las aprobadas
anteriormente"*. Ese paquete arrastra `pages_messaging`,
`instagram_manage_messages`, `business_management` y la Marketing API — o sea,
pone bajo revisión lo que mantiene vivos MANDI, Instagram, la página y la pauta.
**Recortar la solicitud a los dos permisos de WhatsApp** antes de enviar.

Antes de enviar, repasar también ícono, categoría y URL de la app: Meta dice que
los revisa, y hoy la app resuelve a `facebook.com/games/?app_id=...`, que huele a
configuración sin terminar. La política de privacidad sí está puesta.

---

## 6. ⏳ El reloj de los 14 días

Al re-enganchar, la sincronización de historial devuelve los mensajes por fases
(hoy → 90 días → 180). **El texto de los 16 días vuelve completo.**

☠️ **Los adjuntos no.** Los medios de más de 14 días llegan como
`media_placeholder`, sin id: se guardan como mensaje sin archivo
(`TEXTO_PLACEHOLDER` en `lib/coexistencia.js`). Al 22-sep las fotos del 5 al
8-sep **ya son irrecuperables**, y se pierde un día más por cada día que pasa.

**Si hay comprobantes de pago o fotos de pedidos en esas conversaciones, hay que
sacarlos del celular a mano.** No esperan a la revisión de Meta.

---

## 7. ☠️ El camino que NO se toma

**No se registra el número en la Cloud API por el asistente normal**
(`Casos de uso → Integrar con API`, o el alta de número nuevo del diálogo).
Suena razonable y es el único camino que había que evitar: **le quita el WhatsApp
al celular que está atendiendo** y se lleva por delante los 16 días, que existen
solo ahí.

Confirmado con el dueño el 22-sep: **el teléfono está vivo, se usa, y desde él se
envía y se recibe.** Así que esta puerta queda cerrada, no "a evaluar".

El 22-sep el diálogo llegó a ofrecer justo eso —dijo *"No tienes ningún número de
teléfono existente"* y pidió escribir el número a mano— y el error de permisos lo
frenó sin querer. Si el diálogo no ofrece **conectar tu app de WhatsApp Business
existente**, el bloqueo es la revisión de la app: no se sigue por ahí.

---

## 8. Lo que sí se hizo en esta sesión

`/admin/conectar-whatsapp` existía desde el 12-sep pero **no estaba enlazada en
ninguna parte**, y por eso quedó sin usar 9 días. Ahora vive al final de la
pestaña **AUTOS**, con un enlace 🔎 por canal al diagnóstico de Meta
(`components/Automatizaciones.jsx`, PR #7).

La tarjeta va **fuera** del `config &&` del panel a propósito: es la herramienta
de rescate, y el día que se necesita puede ser justo el día en que
`/api/automatizaciones` no contesta.

---

## 9. Lo que sigue

1. Recortar la solicitud de revisión a `whatsapp_business_messaging` +
   `whatsapp_business_management` y enviarla (descripción escrita **y** grabación
   de pantalla por permiso; sin descripción, rechazan).
2. Mientras tanto, rescatar a mano del celular los adjuntos que importen.
3. Con el acceso avanzado concedido: AUTOS → **🔌 Conectar o re-enganchar**, con
   el teléfono a mano.
4. Verificar con el 🔎 que diga `CLOUD_API · CONNECTED` y `throughput: STANDARD`.
   **Un 200 no prueba nada**; lo que prueba es releer el estado.
5. Repetir todo para el 9804 de IND.
6. Pendiente de producto: **una alarma cuando un canal deja de recibir.** Es lo
   único que habría convertido estos 16 días en un día.

---

## 10. Detalle suelto, por si muerde después

`plantillas: []` — la WABA de REPUBLIC **no tiene ni una plantilla aprobada**. Al
recuperar el número, los clientes con la ventana de 24 h vencida (todos, llevan
semanas) no se pueden reabrir sin plantilla. Y las plantillas son **de la WABA**,
no de la marca: las de MANDI no sirven ahí. Conviene crear al menos una de
reenganche antes de volver.
