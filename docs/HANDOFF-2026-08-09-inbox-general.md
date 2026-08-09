# HANDOFF — 9-ago-2026: INBOX GENERAL, una cola con los dos números

Continúa desde `HANDOFF-2026-08-08-pedidos-y-bandejas.md`. Todo lo de acá está
**en producción y verificado con envíos reales**: Rodrigo mandó un mensaje desde
un chat de cada número y llegaron desde el número correcto.

| Repo | Commit final |
|---|---|
| `wa-inbox-next` | `914f522` |
| `MANDARINACRM` | `502c6e69` (arreglo de CAPI, ver §5) |

---

## 1. Qué quedó funcionando

Una pestaña nueva en la cabecera: **📥 GENERAL · 💬 MANDI · 💬 REPUBLIC · …**

```
La columna acumula los chats de los DOS números en una sola cola.
Cada fila lleva debajo una línea de color: verde MANDI, naranja REPUBLIC.
Al abrir un chat se ARMA su canal y se enciende esa pestaña con ◉.
La columna NO se filtra: bajas la cola entera sin cambiar de vista.
Pendientes ordena FIFO: arriba quien lleva más rato esperando.
```

Las pestañas MANDI y REPUBLIC **no cambiaron** en cuanto al número de salida:
ahí sigue mandando la pestaña. Solo dentro de GENERAL el contacto que abres fija
el canal.

### Por qué este diseño y no otro

Lo propuso Rodrigo y es mejor que lo que yo había planteado, por una razón
concreta: **el camino de envío no cambia**. La app ya mandaba por el canal
activo; al hacer que seleccionar un contacto fije ese canal, el número correcto
queda garantizado por construcción y no por una comprobación que alguien pueda
olvidar.

## 2. ⚠️ Lo que más importa saber: esta familia de bugs reapareció TRES veces

En una sola sesión, **tres veces** apareció el mismo fallo —un mensaje saliendo
por el número equivocado— y **dos de ellas las introdujo un arreglo anterior**.
Las tres las cazó una revisión; **ninguna la habrían encontrado las pruebas**,
que estuvieron en verde todo el tiempo.

Si vas a tocar este código, esto es lo que tienes que saber:

1. **`CANAL_ACTIVO` (variable de módulo en `lib/api-client.js`) es la única
   verdad del número de salida.** `postSaliente` lo inyecta en TODO envío.
   `canalArmado` (estado de React) es solo para pintar; **nunca decidas con él**.
   El primer bug fue precisamente comparar contra `canalArmado`.
2. **Nunca fijes el canal a un valor por defecto cuando la conversación tiene el
   suyo.** El segundo bug fue `cambiarLinea(CANAL_POR_DEFECTO)` en los saltos
   desde CONTACTOS y desde un aviso push: convirtió un bug de etiqueta (la
   pestaña mentía) en uno de número (el mensaje salía mal), que es mucho peor.
3. **Si sueltas el canal, suelta el chat.** El tercero: salir de GENERAL a
   CONTACTOS reseteaba el canal pero dejaba el chat abierto; al volver, el chat
   seguía ahí armado sobre el número equivocado. Por eso esa rama ahora hace
   `setActive(null)`. **Es a propósito que se te cierre el chat.**
4. **Un envío en fila tiene que congelar el canal, no leerlo al ejecutarse.**
   `handleQuickReply` ya congelaba teléfono y nombre; faltaba el canal. Mandar
   fotos y pasar al siguiente chat —el gesto normal de trabajo— sacaba el resto
   de la tanda por el otro número. Hoy los 8 puntos de encolado hacen
   `const canal = getCanalActivo()` y lo pasan explícito hasta el `fetch`.

**El dato que destapa todos estos casos:** hay **una sola fila de conversación
por teléfono** (no una por canal), su `phone_id` es el del último mensaje, y
**24 clientes reales han escrito a los dos números**. Cualquier prueba mental que
no incluya a uno de esos 24 no prueba nada.

## 3. Dónde vive cada cosa

| Archivo | Qué hace |
|---|---|
| `lib/canales.js` | `CANAL_GENERAL`, `colorDeCanal`, `phoneIdDeCanal` (⚠️ `canalDePhoneId` devuelve un **string**, no un objeto — tropezamos dos veces con esto) |
| `lib/orden-bandeja.js` | El FIFO. Función pura con 7 pruebas |
| `components/App.jsx` | `phoneIdDe(tel)` es la **fuente única** del canal de una conversación: la usan la línea de color y el armado. Si alguna vez se calculan por separado, la pantalla miente |
| `lib/inbox-supabase.js` | `if (canal)` = sin filtro. **`null` → todos los canales; `undefined` → el principal** |
| `tests/canal-congelado.test.js` | 8 pruebas del canal congelado. Se comprobó que muerden: revertir el arreglo hace fallar 4 |

⚠️ **Límite conocido de las pruebas:** solo ejercitan `lib/api-client.js`. El
cableado en `App.jsx` —los 8 puntos de congelado y los 15 argumentos— **no está
cubierto**, y es justo donde el bug entró dos veces. Un punto de llamada nuevo
que se olvide del parámetro seguirá pasando 8/8 en verde. Revísalo a mano.

## 4. Pendientes

### 4.1 Los dos residuales, que se arreglan juntos

- **R1** — `MANDI con un chat abierto → CONTACTOS → REPUBLIC` deja el chat de
  MANDI en pantalla con el envío armado en REPUBLIC durante ~10 s (hasta el
  siguiente poll). Es el hermano del que ya arreglamos y **se cierra con la misma
  línea** (`setActive(null)` en la rama `vaAChat && !eraChat`), idealmente junto
  con el `load()` que a esa rama le falta.
- **R2** — `/api/media/upload` sube SIEMPRE al `META_PHONE_ID` de MANDI. En
  REPUBLIC, las fotos del computador y la hoja del pedido mandan un `media_id` de
  MANDI por el número de REPUBLIC. Es anterior a esta tanda, pero contradice el
  comentario de `precacheMedia` sobre que un media_id pertenece a su phone_id.

### 4.2 Menores diferidos

- `canalSinResolver()` solo mira dentro de GENERAL. Hoy no dispara nunca: se
  comprobó que **no hay ni una conversación con `phone_id` vacío**. O sea que ese
  cartel rojo salió a producción **sin haberse ejercido jamás** — si algún día
  hace falta, nadie lo ha visto funcionar.
- La rama `vaAChat && !eraChat` de `cambiarLinea` no llama `load()`.
- `phoneIdDe` usa `convs.find(...)` (O(n)) como respaldo por fila.
- Voseo argentino preexistente en `lib/api-client.js:415` ("Convertilo…
  reenvialo"). Corregir aparte.

### 4.3 Lo de siempre

- **Créditos de Anthropic**: la IA lleva medio mes apagada. Si IND no contesta,
  mirar `IA_AUTORESPUESTA`.
- **Portar GENERAL a IND**: no aplica hoy —IND tiene un solo número—, pero el
  día que tenga dos, todo esto es el mapa.

## 5. Lo del CRM en la misma sesión (resumen; el detalle está en su repo)

Se arregló que el Purchase de las ventas de pauta **no llegaba a Meta**: el
evento se armaba bien pero se mandaba al pixel de la web, que no tiene cuenta de
WhatsApp asociada, y Meta lo rechazaba entero con "Invalid parameter".

**15 compras por $1.159,98 entre el 3 y el 8-ago, el 100% de las atribuidas.**
Se rescataron las 15 con el reenvío del tablero de errores, todas con HTTP 200 y
cada una al dataset de su WABA.

⚠️ **El diagnóstico que traía el pedido estaba equivocado en dos de tres puntos**:
decía que el `clid` no se adjuntaba (sí se adjuntaba), y marcaba como "opcional"
diagnosticar los errores "Invalid parameter" — que eran **el bug entero**.
Además el mapeo de datasets venía cruzado: el que llamaba "Mandarina" era el de
IND. Aplicarlo tal cual habría reportado las compras de Mandarina como de IND,
con 200 y sin que nadie se enterara.

**Decisión de Rodrigo:** el evento se **redirige**, no se duplica. Efecto
aceptado a sabiendas: el pixel web ya no ve las ventas de WhatsApp de pauta.

## 6. Método, para repetir

1. **La revisión por tarea vale más que las pruebas en este código.** Tres de
   tres bugs de número los encontró un revisor leyendo, con la suite en verde.
2. **Dile al revisor lo que ya falló.** A la revisión final le pasé el historial
   —"dos arreglos introdujeron el mismo bug, búscalo otra vez"— y encontró la
   tercera variante. Eso orienta mejor que cualquier lista de comprobación.
3. **Muta el arreglo para ver si la prueba muerde.** El último revisor revirtió
   el fix y comprobó que 4 de 8 pruebas fallaban. Una prueba que no puede fallar
   es decoración.
4. ⚠️ **Un listado vacío de `vercel ls --prod` no significa "no hay".** Volvió a
   pasar hoy: el listado sin `--prod` sí mostraba el despliegue.
