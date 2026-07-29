# Diseño — Ordenar las respuestas rápidas

Afecta a **los dos inbox**, porque comparten la tabla:
`wa-inbox-next` (proyecto Vercel `wa-inbox-v2`) e `ind-inbox-next` (proyecto `ind-inbox-v2`).
Producción = `main` en los dos. Fecha: 2026-07-29.

---

## 1. El problema

Hoy **no existe ningún orden**. `getRespuestasSupabase` (`lib/inbox-supabase.js`) lee así:

```js
.from('respuestas_rapidas').select('*').eq('cuenta', CUENTA).eq('activo', true)
```

Sin `order by`. Y la tabla `inbox.respuestas_rapidas` no tiene columna de orden — solo
`cuenta, id, texto, imagenes, botones, activo, fecha`.

O sea que el orden que se ve es el que Postgres devuelve por casualidad, y **puede
cambiar solo** entre recargas o tras cualquier escritura. Esto no es solo "poder
reordenar": es darles un orden estable por primera vez.

La tabla es **compartida**: 13 respuestas de MANDI y 11 de IND en la misma tabla.

## 2. Alcance

**Entra:** columna de orden, lectura ordenada, reordenar desde la interfaz (flechas
↑↓ siempre, y arrastrar en computadora), y que una respuesta nueva entre **primera**.
En los dos inbox.

**No entra:** orden por usuario. El inbox **no tiene concepto de usuario** (no hay
`middleware.js` ni sesión), así que el orden es necesariamente uno solo por cuenta,
compartido por todo el equipo. No es una limitación que se elija: es lo único posible
hoy.

## 3. Modelo de datos

Columna nueva en `inbox.respuestas_rapidas`:

```sql
alter table inbox.respuestas_rapidas add column orden integer;
```

Y la lectura pasa a `.order('orden', { ascending: true }).order('fecha', { ascending: false })`.

El segundo criterio (`fecha`) es el desempate: si dos filas quedaran con el mismo
`orden` —o con `orden` nulo—, el resultado sigue siendo estable en vez de volver a
ser aleatorio.

Va **descendente** a propósito, para no contradecir el resto del diseño: si lo nuevo
entra arriba (§5) y las existentes se numeran de la más nueva a la más vieja (§6), un
empate también debe resolverse poniendo la más nueva primero. Con `ascending: true`
el desempate haría lo contrario de la regla, justo en el caso raro en que nadie
estaría mirando.

**Por qué una columna y no las alternativas:**

- *Una lista de ids en otra tabla*: se desincroniza en cuanto alguien borra o crea una
  respuesta, y obliga a limpiar huérfanos. El orden dejaría de ser un dato de la fila.
- *Reescribir la columna `fecha`*: destruiría cuándo se creó cada respuesta, que es
  información real que hoy existe y que además usamos como desempate.

## 4. Cómo se guarda un reordenamiento

Al soltar una caja o pulsar una flecha, el navegador recalcula la lista completa y
manda **el orden entero**: la lista de ids en su nueva posición. El servidor escribe
`orden = 0, 1, 2…` según ese orden.

La alternativa —mandar "intercambia estas dos"— es menos escritura, pero con el tiempo
deja huecos y empates que vuelven a producir orden impredecible, que es justo el
problema que esto viene a resolver. Con 13 filas, reescribir todo es gratis y el
resultado siempre queda consistente y sin huecos.

Es además **idempotente**: mandar dos veces el mismo orden deja lo mismo.

## 5. Crear entra primera. Editar NO mueve nada.

Al crear: `orden = (el menor que exista para esa cuenta) − 1`. Entra arriba sin tocar
las demás filas. Los valores pueden quedar negativos y no importa: solo se usan para
ordenar, y el primer reordenamiento manual los renumera desde 0.

### ⚠️ La trampa que hay que desarmar

Hoy, en `lib/inbox-supabase.js`:

```js
export async function editRespuestaSupabase(id, texto, imagenUrl, extras = {}) {
  return addRespuestaSupabase(id, texto, imagenUrl, extras) // upsert
}
```

**Editar y crear son la misma función.** Si el `orden` se calcula ahí sin distinguir,
cada edición mandaría la respuesta a la primera posición: corriges una tilde y se te
desordena la lista.

Hay que separarlas: **crear** calcula el `orden`; **editar** no lo toca. Se colapsaron
en una sola función porque el orden no existía; ahora ya no da lo mismo.

Implementación concreta: `addRespuestaSupabase` mira si la fila ya existe. Si no
existe, calcula el `orden` mínimo menos uno. Si existe, hace el upsert **sin** incluir
`orden` en el payload, de modo que el valor guardado sobrevive.

## 6. Orden inicial de las que ya existen

Se numeran de la **más nueva a la más vieja** (`fecha` descendente).

Va así por coherencia con el §5: si de aquí en adelante lo nuevo entra arriba, no
tendría sentido que las existentes arranquen al revés.

## 7. Interfaz

En cada caja de respuesta, junto a los ✏️ y 🗑 que ya existen (`components/RightPanel.jsx`,
pestaña Respuestas):

- **↑ y ↓** siempre. La primera no muestra ↑; la última no muestra ↓.
- **Arrastrar la caja**, solo con mouse. Mientras se arrastra se indica dónde va a caer.

El arrastre **no se activa en pantalla táctil** a propósito. Las respuestas viven en
una columna con scroll, y en táctil arrastrar dentro de algo que además hace scroll
pelea con el gesto de desplazar: el dedo no distingue mover la caja de bajar la lista.
Con 13 respuestas las flechas son rápidas, y funcionan en todas partes.

Si el guardado falla, la lista **vuelve al orden anterior** y avisa. Nunca puede
quedar reordenada en pantalla y sin guardar. (Mismo criterio que el
`guardarInterruptor` de la pestaña AUTOS, que existe por un bug real donde la pantalla
mentía.)

## 8. Orden de despliegue — importa

Los dos inbox leen la **misma tabla**, así que:

1. **La migración primero.** Añadir la columna y rellenarla.
2. Desplegar MANDI.
3. Desplegar IND.

Si el código pidiera `order by orden` antes de que la columna exista, la pestaña de
respuestas dejaría de cargar **en los dos a la vez**.

Entre los pasos 2 y 3 no hay problema: el inbox que aún no tenga el código nuevo
ignora la columna y se comporta exactamente como hoy.

## 9. Riesgos y reversa

| Riesgo | Mitigación |
|---|---|
| La pestaña de respuestas deja de cargar | Migración antes del código (§8). La columna es aditiva y nullable: el código viejo la ignora. |
| Editar desordena la lista | §5, separar crear de editar. Es el fallo más probable y el más molesto. |
| Reordenar y que no se guarde | La interfaz revierte y avisa (§7). |
| Dos personas reordenan a la vez | La última escritura gana. Con un equipo pequeño y una acción tan puntual, no merece bloqueo ni versionado. Queda dicho. |

**Reversa:** el código se revierte con `git revert` + redeploy. La columna puede
quedarse: es nullable y el código viejo no la mira. No hay pérdida de datos en ninguna
dirección.

## 10. Fuera de alcance, anotado

- Orden por usuario (§2): imposible hoy, haría falta autenticación en el inbox.
- Agrupar respuestas por categorías o carpetas.
- Reordenar arrastrando en pantalla táctil (§7).
