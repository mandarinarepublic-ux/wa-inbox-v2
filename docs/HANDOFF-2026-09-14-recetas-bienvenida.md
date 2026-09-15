# HANDOFF · 14-sep-2026 · Recetas de bienvenida por anuncio (MANDI)

**Qué es:** cuando un cliente llega de un anuncio de Meta, el inbox manda solo, al instante y en
orden, el paquete de respuestas rápidas que Rodrigo eligió para ese anuncio, y cierra con una
pregunta de hasta 3 botones. Reemplaza al saludo automático. Y cuando aparece un anuncio que el
inbox nunca vio, avisa por Telegram para que se le arme su receta.

Diseño: `docs/superpowers/specs/2026-09-14-recetas-bienvenida-design.md` · Plan:
`docs/superpowers/plans/2026-09-14-recetas-bienvenida.md`.

## Por qué (medido en MANDI, 29-jul → 12-sep)

Casi todos los chats recibían el mismo paquete de 3 respuestas rápidas **a mano** (saludo → pitch
del anuncio → fotos), con una mediana de **74 minutos** de retraso. Responder en menos de 15 min
hace que el 50 % vuelva a escribir, contra 35 % si se tarda más de 4 h.

## Cómo se configura (AUTOS → 📣 Bienvenida por anuncio)

1. Prender el interruptor global (arranca APAGADO).
2. **Recetas:** "+ Nueva receta", nombre, agregar respuestas rápidas en el orden que salen (▲▼),
   pregunta final con hasta 3 botones de 20 letras. "Guardar cambios".
3. **Anuncios vistos:** cada anuncio con su etiqueta editable, titular, chats de 30 días, último
   chat, y el combo para asignarle una receta. La primera fila es **Orgánico** (contactos nuevos
   sin anuncio). Un anuncio sin receta se marca NUEVO y **no recibe nada automático** (decisión de
   Rodrigo, 13-sep).

## Reglas que el código hace cumplir

- Una receta por cliente por ventana de 24 h. Se marca `conversaciones.ultima_receta_at` **ANTES**
  de enviar, con guardia en el WHERE: una reentrega del webhook de Meta no duplica el paquete.
- Si el bot va a contestar ese chat (cortafuegos del número + modo del chat), la receta no se mete.
- Las piezas salen una a una, en el orden cargado (texto/botones → fotos → audios → documentos →
  pregunta), por `/api/saliente` con la credencial de máquina y `auto:true` → **el chat queda en
  PENDIENTES**. Lo que el cliente toque en un botón entra como texto y lo devuelve a Pendientes.
  Ningún botón dispara nada solo.
- El envío corre en su propia tarea (`waitUntil`) para no tener de rehén al guardado de los demás
  mensajes del lote. El webhook tiene `maxDuration = 60`.
- Una respuesta rápida borrada deja un paso huérfano: se salta con log y la pantalla lo pinta en rojo.
- **La primera pieza sale citando el mensaje del cliente**, como cuando tocas "Responder" en la
  burbuja: así el paquete se siente contestado por alguien y no automático. Solo la primera; las
  demás salen sueltas debajo (pedido de Rodrigo, 15-sep).
- Tope de **15 piezas** por receta (una receta absurda no dispara 50 mensajes).
- Si NINGUNA pieza sale (0/N), llega una alarma por Telegram: el chat ya quedó marcado 24 h y
  hay que mirar `/api/saliente` en los logs. Sin esa alarma, "marcar antes de enviar" no
  tendría ninguna señal de falla.
- El aviso de "anuncio nuevo" se dispara mientras `avisado_at` esté vacío: si Telegram falló una
  vez, se reintenta con el próximo referral de ese anuncio.

## Dónde vive cada cosa

| pieza | archivo |
|---|---|
| Config (`activo`, `lista`, `por_anuncio`) | `inbox.automatizaciones.config.recetas` · defaults en `lib/automatizaciones.js` |
| Decidir + armar piezas + texto del aviso (puro, 14 pruebas) | `lib/recetas.js` · `tests/recetas.test.js` |
| Anuncio visto, marca con guardia, resumen, etiqueta | `lib/inbox-supabase.js` (`registrarAnuncioVistoSupabase`, `marcarRecetaSupabase`, …) · reexports en `lib/contactos.js` |
| Lista de anuncios para la pantalla | `GET/PATCH /api/anuncios` (detrás del login) · rpc `inbox.anuncios_resumen(p_cuenta)` |
| El disparo | `app/api/webhook/route.js` → `recetaSiCorresponde`, `anuncioVistoSiCorresponde` |
| Pantalla | `components/Automatizaciones.jsx` (tarjeta 📣) |
| Migración | `inbox_recetas_bienvenida` (columnas en `anuncios`, `conversaciones.ultima_receta_at`, rpc) |

⚠️ `merge()` de la config es de UN nivel: la pantalla manda `lista` y `por_anuncio` **completos**.

## Controles

```sql
-- ¿A quién le salió una receta?
select telefono, ultima_receta_at from inbox.conversaciones
where cuenta='MANDI' and ultima_receta_at is not null order by 2 desc limit 20;

-- ¿Qué anuncios vio el inbox y cuáles avisó?
select source_id, etiqueta, titular, visto_en, avisado_at from inbox.anuncios
where cuenta='MANDI' and visto_en is not null order by visto_en desc;
```
En los logs de Vercel: `[/api/webhook] receta <id> a <tel> N/M piezas` y
`[/api/webhook] receta … pieza rechazada <status>`.

## Prueba real (pendiente de Rodrigo)

1. Crear receta "Prueba" (saludo + una respuesta con fotos + pregunta con 2 botones), asignarla a
   **Orgánico**, prender el global, guardar.
2. Desde un número que NUNCA escribió a MANDI, mandar "hola". Deben llegar las piezas en orden y
   la pregunta con botones; el chat queda en PENDIENTES.
3. Tocar un botón → llega como texto; volver a escribir → NO se repite el paquete (24 h).
4. Quitar la asignación de Orgánico y guardar.

## Pendiente

- **IND:** mismo código, misma pantalla (paleta crema/negro), `cabecerasMaquina` en vez de
  `enviarSaliente`, y `tests/rutas-publicas.test.js` de IND. La migración ya vale para los dos.
- **Carrera del placeholder `unsupported`** (preexistente, ~10 casos en 60 días): si Meta entrega
  primero el placeholder y después el mensaje real con el mismo wamid, el segundo se salta por
  `yaVisto` y el referral no dispara la receta. Las dos operaciones nuevas son idempotentes, así
  que se pueden subir por encima del `continue` para mensajes con referral. Tarea aparte.
- `inbox.anuncios_resumen` recorre `mensajes` sin índice de apoyo: solo carga al abrir AUTOS, pero
  irá más lento con el tiempo.
