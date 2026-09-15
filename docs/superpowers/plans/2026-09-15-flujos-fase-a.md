# FLUJOS · Fase A — lienzo + motor lineal · plan de implementación (MANDI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Una pestaña FLUJOS con un lienzo de nodos (React Flow) donde Rodrigo dibuja Disparador → Mensajes → Fin, y un motor que ejecuta el camino lineal de cada flujo publicado igual que hoy corren las recetas; las recetas del 14-sep se importan como flujos y su motor se apaga.

**Architecture:** Los flujos viven en `inbox.flujos` (borrador `grafo` + publicado `grafo_vivo`). Toda la lógica (validar, elegir flujo, camino lineal, piezas, conversión de recetas) es un módulo puro `lib/flujo.js` con pruebas; el webhook solo llama y envía como hoy. El lienzo es un componente cliente con `@xyflow/react`, cargado con `next/dynamic` solo en la pestaña.

**Tech Stack:** Next.js 14 app router, React 18, `@xyflow/react` 12.11, Supabase (PostgREST, service role, schema `inbox`), `node --test`, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md` (autoridad). Reusa piezas del plan anterior `docs/superpowers/plans/2026-09-14-recetas-bienvenida.md`.

## Global Constraints

- Español ecuatoriano con tuteo en código, comentarios, commits y textos de la app. Nada de voseo.
- Trabajo en `main`. `git add` por nombre de archivo, nunca `-A` ni `.`. Push solo en la Task 8.
- `npm test` = `node --test tests/*.test.js && eslint .` en 0 fallos (warning previo de `components/RightPanel.jsx:107` se ignora). `npx next build` limpio antes de cada commit que toque `app/` o `components/`.
- Commits terminan con:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` y `Claude-Session: https://claude.ai/code/session_01LFZBYBZKQeHHX6yfeHcHht`
- Reglas del negocio que el código hace cumplir: sin flujo publicado que aplique NO sale nada · un disparo por cliente por 24 h (`conversaciones.ultima_receta_at`, marcar ANTES de enviar con guardia) · el bot activo en el chat (`decidirIA`) gana · `auto:true` → el chat queda en PENDIENTES · la primera pieza cita el entrante (`ContextoId`) · tope 15 piezas · botones ≤3 × 20 letras.
- Toda llamada interna a `/api/saliente` va por `enviarSaliente(origin, body)` (`lib/responder-ia.js`).
- Rutas nuevas quedan detrás del login: NO se agregan a `lib/rutas-publicas.js`; se listan en `PROTEGIDAS` de `tests/rutas-publicas.test.js`.
- El cliente de Supabase ya apunta al schema `inbox` (`lib/supabase.js`): `sb.from('flujos')`.
- Referral normalizado: `m.referral.source_id`, `.headline`, `.source_type` (`lib/wa-mensaje.js`).
- Formas ya existentes que se reusan: respuestas rápidas `{ id, text, botones:[string], adjuntos:[{tipo,url,nombre}], imageUrl… }` (`toRespuesta`); `adjuntosDeRespuesta(reply)` (`lib/adjuntos-respuesta.js`); `normalizarBotones`, `esc`, `MAX_PIEZAS` (`lib/recetas.js`); `caminoDeSeguimiento`/`decidirIA` (`lib/ia-canal.js`).

---

### Task 1: Migración — tabla `inbox.flujos`

**Files:** migración Supabase por MCP, nombre `inbox_flujos_fase_a`.

**Interfaces:**
- Produces: tabla `inbox.flujos (flujo_id uuid pk, cuenta text, nombre text, publicado bool, grafo jsonb, grafo_vivo jsonb, creado_at, actualizado_at)` + índice `(cuenta, publicado)` + trigger `inbox.tocar_updated_at`-style para `actualizado_at` (ya existe la función `inbox.tocar_updated_at()`: ver `trg_conversaciones_updated_at`).

- [x] **Step 1: Control previo**
```sql
select count(*) from information_schema.tables where table_schema='inbox' and table_name='flujos';
```
Esperado: 0.

- [x] **Step 2: Aplicar**
```sql
-- FLUJOS (15-sep-2026). Ver wa-inbox-next/docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md
create table if not exists inbox.flujos (
  flujo_id       uuid primary key default gen_random_uuid(),
  cuenta         text not null,
  nombre         text not null default 'Nuevo flujo',
  publicado      boolean not null default false,
  grafo          jsonb not null default '{"nodos":[],"lineas":[]}'::jsonb,  -- borrador (se edita)
  grafo_vivo     jsonb,                                                      -- lo publicado (lo que corre)
  creado_at      timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
create index if not exists flujos_cuenta_publicado on inbox.flujos (cuenta, publicado);
drop trigger if exists trg_flujos_updated_at on inbox.flujos;
create trigger trg_flujos_updated_at before update on inbox.flujos
  for each row execute function inbox.tocar_updated_at();
```
⚠️ Si `inbox.tocar_updated_at()` escribe `updated_at` y no `actualizado_at`, revisar su definición con `select pg_get_functiondef('inbox.tocar_updated_at'::regproc)` y, si hace falta, crear `inbox.tocar_actualizado_at()` equivalente que ponga `new.actualizado_at = now()`.

- [x] **Step 3: Verificar**
```sql
select column_name from information_schema.columns where table_schema='inbox' and table_name='flujos' order by ordinal_position;
insert into inbox.flujos (cuenta, nombre) values ('PRUEBA','x') returning flujo_id;
update inbox.flujos set nombre='y' where cuenta='PRUEBA' returning actualizado_at > creado_at as toco_trigger;
delete from inbox.flujos where cuenta='PRUEBA';
```
Esperado: 8 columnas · un uuid · `true` · fila borrada.

---

### Task 2: `lib/flujo.js` — el modelo y la lógica (puro)

**Files:**
- Create: `lib/flujo.js`
- Modify: `lib/recetas.js` (exportar `pieza` e `interactivo`; nada más)
- Test: `tests/flujo.test.js`

**Interfaces (Produces):**
```js
export const TIPOS_NODO = ['disparador', 'mensaje', 'condicion', 'fin']
export const MAX_ESPERA_MIN = 23 * 60
export function normalizarTexto(s)                       // minúsculas, sin acentos, espacios simples
export function nodoDisparador(grafo)                    // el nodo tipo 'disparador' o null
export function puertosDe(nodo)                          // ['siguiente'] | ['btn_1','btn_2','otra'] | ['respuesta'] | ['si','no'] | []
export function validarFlujo(grafo, { respuestas = [] } = {})  // → [{ nodoId?, lineaId?, texto }]  ([] = válido)
export function choquesDeDisparador(grafo, otrosPublicados)   // → [{ flujoId, nombre, motivo }]
export function elegirFlujo({ flujos, sourceId, esNuevo, texto })  // → flujo | null (anuncio > palabra > organico), solo publicados con grafo_vivo
export function caminoLineal(grafo)                      // → { mensajes: [nodo...], detenidoEn: nodoId|null, motivo: 'fin'|'botones'|'espera'|'esperar_respuesta'|'condicion'|'huerfano' }
export function piezasDeNodos({ nodos, respuestas, contacto, citaId })  // → cuerpos para /api/saliente (reusa pieza/interactivo/normalizarBotones/adjuntosDeRespuesta; tope MAX_PIEZAS; 1.ª pieza con ContextoId)
export function temperaturaAlPasar(nodos)                // → última temperatura no vacía de los nodos recorridos, o ''
export function recetaAFlujo(receta, { sourceIds = [], organico = false, publicado = false })  // → { nombre, publicado, grafo }
export function nuevoGrafo()                             // → grafo con un Disparador 'organico' y un Fin, posiciones por defecto
```
Forma del grafo:
```js
{ nodos: [
    { id:'n1', tipo:'disparador', pos:{x:0,y:0}, datos:{ tipo:'anuncio'|'organico'|'palabra', sourceIds:[], palabras:[] } },
    { id:'n2', tipo:'mensaje',    pos:{x:0,y:0}, datos:{ origen:'respuesta'|'texto', respuestaId:'', texto:'', adjuntos:[{tipo,url,nombre}], botones:[{title}], esperarRespuesta:false, citarUltimaRespuesta:false, temperatura:'' } },
    { id:'n3', tipo:'condicion',  pos:{x:0,y:0}, datos:{ campo:'temperatura'|'tiene_venta'|'hora'|'bandeja', valor:'' } },
    { id:'n4', tipo:'fin',        pos:{x:0,y:0}, datos:{} } ],
  lineas: [ { id:'l1', de:'n1', puerto:'siguiente', a:'n2', esperaMin: 0 } ] }
```

- [x] **Step 1: Pruebas (RED)** — crear `tests/flujo.test.js` con, como mínimo, estos casos (usar fixtures pequeños definidos arriba del archivo):
```js
import test from 'node:test'
import assert from 'node:assert'
import { normalizarTexto, puertosDe, validarFlujo, choquesDeDisparador, elegirFlujo, caminoLineal, piezasDeNodos, temperaturaAlPasar, recetaAFlujo, nuevoGrafo } from '../lib/flujo.js'

const D = (datos) => ({ id: 'd', tipo: 'disparador', pos: { x: 0, y: 0 }, datos })
const M = (id, datos) => ({ id, tipo: 'mensaje', pos: { x: 0, y: 0 }, datos: { origen: 'texto', texto: 'hola ' + id, adjuntos: [], botones: [], esperarRespuesta: false, citarUltimaRespuesta: false, temperatura: '', ...datos } })
const F = { id: 'f', tipo: 'fin', pos: { x: 0, y: 0 }, datos: {} }
const L = (de, a, puerto = 'siguiente', esperaMin = 0) => ({ id: `${de}-${puerto}-${a}`, de, puerto, a, esperaMin })
const contacto = { telefono: '593999000111', nombre: 'Ana', alias: '', phoneId: '1024077200794372' }
const respuestas = [{ id: 'r1', text: 'Saludo', botones: [], adjuntos: [{ tipo: 'imagen', url: 'https://x/1.jpg', nombre: '' }] }]

const lineal = { nodos: [D({ tipo: 'anuncio', sourceIds: ['111'], palabras: [] }), M('m1', { origen: 'respuesta', respuestaId: 'r1' }), M('m2', { temperatura: 'caliente' }), F], lineas: [L('d', 'm1'), L('m1', 'm2'), L('m2', 'f')] }

test('normalizarTexto: minúsculas, sin acentos, espacios simples', () => {
  assert.equal(normalizarTexto('  Hóla   CHAQUETA dragón '), 'hola chaqueta dragon')
})
test('puertosDe: mensaje simple, con botones, esperando, condición', () => {
  assert.deepEqual(puertosDe(M('a', {})), ['siguiente'])
  assert.deepEqual(puertosDe(M('a', { botones: [{ title: 'Sí' }, { title: 'No' }] })), ['btn_1', 'btn_2', 'otra'])
  assert.deepEqual(puertosDe(M('a', { esperarRespuesta: true })), ['respuesta'])
  assert.deepEqual(puertosDe({ id: 'c', tipo: 'condicion', datos: { campo: 'temperatura', valor: 'caliente' } }), ['si', 'no'])
})
test('validarFlujo: válido → []', () => { assert.deepEqual(validarFlujo(lineal, { respuestas }), []) })
test('validarFlujo: sin disparador / dos disparadores / nodo inalcanzable / respuesta borrada / botones de más / espera > 23h / ciclo sin espera', () => {
  assert.ok(validarFlujo({ nodos: [F], lineas: [] }).length >= 1)
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), { ...D({ tipo: 'organico' }), id: 'd2' }, F], lineas: [] }).some(e => /disparador/i.test(e.texto)))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('solo', {}), F], lineas: [L('d', 'f')] }).some(e => e.nodoId === 'solo'))
  assert.ok(validarFlujo({ ...lineal }, { respuestas: [] }).some(e => e.nodoId === 'm1'))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('b', { botones: [{ title: '1' }, { title: '2' }, { title: '3' }, { title: '4' }] }), F], lineas: [L('d', 'b'), L('b', 'f', 'btn_1')] }).some(e => e.nodoId === 'b'))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('a', {}), F], lineas: [L('d', 'a'), L('a', 'f', 'siguiente', 24 * 60)] }).some(e => e.lineaId))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {})], lineas: [L('d', 'a'), L('a', 'b'), L('b', 'a')] }).some(e => /ciclo/i.test(e.texto)))
})
test('choquesDeDisparador: mismo anuncio, misma palabra u orgánico repetido en otro publicado', () => {
  const otro = { flujo_id: 'x', nombre: 'Otro', publicado: true, grafo_vivo: lineal }
  assert.equal(choquesDeDisparador(lineal, [otro]).length, 1)
  assert.equal(choquesDeDisparador({ ...lineal, nodos: [D({ tipo: 'anuncio', sourceIds: ['999'], palabras: [] }), ...lineal.nodos.slice(1)] }, [otro]).length, 0)
})
test('elegirFlujo: anuncio > palabra > orgánico; solo publicados con grafo_vivo', () => {
  const fA = { flujo_id: 'a', publicado: true, grafo_vivo: lineal }
  const fP = { flujo_id: 'p', publicado: true, grafo_vivo: { ...lineal, nodos: [D({ tipo: 'palabra', palabras: ['Chaqueta'] }), ...lineal.nodos.slice(1)] } }
  const fO = { flujo_id: 'o', publicado: true, grafo_vivo: { ...lineal, nodos: [D({ tipo: 'organico' }), ...lineal.nodos.slice(1)] } }
  const fB = { flujo_id: 'b', publicado: false, grafo_vivo: lineal }
  const flujos = [fB, fO, fP, fA]
  assert.equal(elegirFlujo({ flujos, sourceId: '111', esNuevo: true, texto: 'quiero la chaqueta' })?.flujo_id, 'a')
  assert.equal(elegirFlujo({ flujos, sourceId: '', esNuevo: false, texto: 'la CHAQUETA dragón' })?.flujo_id, 'p')
  assert.equal(elegirFlujo({ flujos, sourceId: '', esNuevo: true, texto: 'hola' })?.flujo_id, 'o')
  assert.equal(elegirFlujo({ flujos, sourceId: '', esNuevo: false, texto: 'hola' }), null)
  assert.equal(elegirFlujo({ flujos: [fB], sourceId: '111', esNuevo: true, texto: '' }), null)
})
test('caminoLineal: recorre hasta Fin', () => {
  const c = caminoLineal(lineal)
  assert.deepEqual(c.mensajes.map(n => n.id), ['m1', 'm2']); assert.equal(c.motivo, 'fin')
})
test('caminoLineal: se detiene en botones / espera en la línea / esperar respuesta / condición', () => {
  const conBotones = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', { botones: [{ title: 'Sí' }] }), M('c', {}), F], lineas: [L('d', 'a'), L('a', 'b'), L('b', 'c', 'btn_1'), L('c', 'f')] }
  let c = caminoLineal(conBotones); assert.deepEqual(c.mensajes.map(n => n.id), ['a', 'b']); assert.equal(c.motivo, 'botones'); assert.equal(c.detenidoEn, 'b')
  const conEspera = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'siguiente', 60), L('b', 'f')] }
  c = caminoLineal(conEspera); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'espera')
  const esperando = { nodos: [D({ tipo: 'organico' }), M('a', { esperarRespuesta: true }), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'respuesta'), L('b', 'f')] }
  c = caminoLineal(esperando); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'esperar_respuesta')
  const conCond = { nodos: [D({ tipo: 'organico' }), M('a', {}), { id: 'c', tipo: 'condicion', pos: { x: 0, y: 0 }, datos: { campo: 'temperatura', valor: 'caliente' } }, F], lineas: [L('d', 'a'), L('a', 'c'), L('c', 'f', 'si')] }
  c = caminoLineal(conCond); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'condicion')
})
test('piezasDeNodos: respuesta rápida con adjuntos + texto con botones; la 1.ª cita; tope', () => {
  const nodos = [M('m1', { origen: 'respuesta', respuestaId: 'r1' }), M('m2', { origen: 'texto', texto: '¿Cuál?', botones: [{ title: '1' }, { title: '2' }] })]
  const p = piezasDeNodos({ nodos, respuestas, contacto, citaId: 'wamid.X' })
  assert.deepEqual(p.map(x => x.Mensaje || x.ImagenURL || x.Cuerpo), ['Saludo', 'https://x/1.jpg', '¿Cuál?'])
  assert.equal(p[0].ContextoId, 'wamid.X'); assert.ok(!p[1].ContextoId)
  assert.equal(p[2].TipoMensaje, 'interactive_buttons')
  assert.ok(p.every(x => x.Canal === contacto.phoneId))
})
test('piezasDeNodos: respuesta borrada se salta; texto vacío no sale; adjuntos por url en un nodo texto', () => {
  const nodos = [M('x', { origen: 'respuesta', respuestaId: 'no' }), M('y', { origen: 'texto', texto: '', adjuntos: [{ tipo: 'audio', url: 'https://x/v.ogg', nombre: '' }] })]
  const p = piezasDeNodos({ nodos, respuestas, contacto })
  assert.deepEqual(p.map(x => x.AudioURL), ['https://x/v.ogg'])
})
test('temperaturaAlPasar: la última no vacía', () => {
  assert.equal(temperaturaAlPasar([M('a', { temperatura: 'tibio' }), M('b', {}), M('c', { temperatura: 'caliente' })]), 'caliente')
  assert.equal(temperaturaAlPasar([M('a', {})]), '')
})
test('recetaAFlujo: disparador con los anuncios, un mensaje por paso, la pregunta con botones, fin; válido', () => {
  const receta = { id: 'r_1', nombre: 'DBZ', activa: true, pasos: [{ tipo: 'respuesta', respuestaId: 'r1' }], pregunta: { texto: '¿Cuál?', botones: [{ title: '1' }] } }
  const f = recetaAFlujo(receta, { sourceIds: ['111', '222'], publicado: true })
  assert.equal(f.nombre, 'DBZ'); assert.equal(f.publicado, true)
  assert.deepEqual(validarFlujo(f.grafo, { respuestas }), [])
  const c = caminoLineal(f.grafo); assert.equal(c.mensajes.length, 2); assert.equal(c.motivo, 'botones')
  assert.deepEqual(f.grafo.nodos[0].datos.sourceIds, ['111', '222'])
  const o = recetaAFlujo({ ...receta, pregunta: null }, { organico: true }); assert.equal(o.grafo.nodos[0].datos.tipo, 'organico'); assert.equal(caminoLineal(o.grafo).motivo, 'fin')
})
test('nuevoGrafo: un disparador orgánico y un fin, válido', () => {
  assert.deepEqual(validarFlujo(nuevoGrafo()), [])
})
```
Run: `node --test tests/flujo.test.js` → `Cannot find module`.

- [x] **Step 2: Exportar helpers de `lib/recetas.js`**: cambiar `const pieza = …` y `const interactivo = …` por `export const pieza = …` / `export const interactivo = …` (sin tocar su cuerpo). `node --test tests/recetas.test.js` sigue en verde.

- [x] **Step 3: Implementar `lib/flujo.js`** (puro; solo importa `./adjuntos-respuesta.js` y `./recetas.js`). Puntos que NO son obvios:
  - `normalizarTexto`: `String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim()`.
  - `puertosDe`: `disparador`→`['siguiente']`; `mensaje` con botones normalizados n≥1 → `btn_1..btn_n` + `'otra'`; si no y `esperarRespuesta` → `['respuesta']`; si no → `['siguiente']`; `condicion`→`['si','no']`; `fin`→`[]`.
  - `validarFlujo`: errores como `{ nodoId, texto }` o `{ lineaId, texto }`: exactamente un disparador · el disparador `anuncio` con ≥1 sourceId, `palabra` con ≥1 palabra · alcanzabilidad por BFS desde el disparador · líneas cuyo `de`/`a` no existan o cuyo `puerto` no esté en `puertosDe(de)` · más de una línea del mismo puerto · botones >3 o título >20 · `mensaje` `origen=respuesta` sin `respuestaId` o cuyo id no esté en `respuestas` (solo si se pasó `respuestas`) · `mensaje` `origen=texto` sin texto ni adjuntos · `esperaMin` < 0 o > `MAX_ESPERA_MIN` · ciclo alcanzable por líneas con `esperaMin` 0 (DFS con colores; un ciclo que pase por una línea con espera no es error).
  - `choquesDeDisparador(grafo, otros)`: compara el disparador propio con el de cada `otro.grafo_vivo` (solo `otro.publicado`): mismo `sourceId`, misma palabra normalizada, o ambos `organico`.
  - `elegirFlujo`: candidatos = `flujos.filter(f => f.publicado && f.grafo_vivo)`; con `sourceId` → el que tenga ese id en `sourceIds`; si no, con `texto` → el `palabra` cuya palabra normalizada esté contenida en `normalizarTexto(texto)`; si no y `esNuevo` → `organico`; si no → null.
  - `caminoLineal`: desde el disparador, seguir la única línea del puerto `siguiente` (o `respuesta`/`btn_*` no: esos detienen). Reglas de parada, en este orden al llegar a un nodo/línea: línea con `esperaMin>0` → `espera` (el nodo destino NO se incluye) · nodo `condicion` → `condicion` · nodo `mensaje` se incluye siempre; si tiene botones → `botones` (se incluye y se detiene); si `esperarRespuesta` → `esperar_respuesta` (se incluye y se detiene) · `fin` o puerto sin línea → `fin` · nodo inexistente → `huerfano`. Protección contra bucles: máximo 50 pasos.
  - `piezasDeNodos`: para cada nodo mensaje: si `origen=respuesta` → buscar en `respuestas` (si no está, `console.warn` y saltar), texto = `text`, botones = `normalizarBotones(nodo.datos.botones)` si hay, si no los de la respuesta; adjuntos = `adjuntosDeRespuesta(r)`; si `origen=texto` → texto/adjuntos/botones del nodo. Texto+botones → `interactivo`; solo texto → `{Mensaje}`; adjuntos → `ImagenURL`/`AudioURL`/`DocURL`+`DocNombre`. Tope `MAX_PIEZAS`; la primera pieza lleva `ContextoId: citaId` si viene.
  - `recetaAFlujo`: nodos en columna (`pos.y` = 0, 140, 280…); disparador `{tipo: organico? 'organico':'anuncio', sourceIds, palabras:[]}`; un `mensaje` `origen=respuesta` por paso; si `pregunta.texto` → `mensaje` `origen=texto` con `botones`; `fin`; líneas `siguiente` encadenadas (la pregunta con botones NO se conecta a fin: sus puertos quedan libres = Fin).
  - `nuevoGrafo`: `[disparador organico en (0,0), fin en (0,300)]` con línea `siguiente`.

- [x] **Step 4: GREEN** — `node --test tests/flujo.test.js tests/recetas.test.js` → todo pasa. `npm test` → 0 fallos.

- [x] **Step 5: Commit**
```bash
git add lib/flujo.js lib/recetas.js tests/flujo.test.js
git commit -m "feat(flujos): modelo, validación, elección, camino lineal y conversión de recetas (puro, probado)"
```

---

### Task 3: Persistencia + API `/api/flujos`

**Files:**
- Modify: `lib/inbox-supabase.js` (cuatro funciones al final)
- Create: `lib/flujos.js` (server; reexports + `publicarFlujo` con validación y choques + `importarRecetas`)
- Create: `app/api/flujos/route.js`, `app/api/flujos/publicar/route.js`, `app/api/flujos/importar-recetas/route.js`
- Modify: `lib/api-client.js` (`getFlujos`, `saveFlujo`, `publicarFlujo`, `deleteFlujo`, `importarRecetas`)
- Modify: `tests/rutas-publicas.test.js` (agregar `'/api/flujos'`, `'/api/flujos/publicar'`, `'/api/flujos/importar-recetas'` a PROTEGIDAS)
- Test: `tests/flujos-importar.test.js` (la parte pura de importar: qué recetas se convierten y cuáles ya existen)

**Interfaces (Produces):**
```js
// lib/inbox-supabase.js
export async function getFlujosSupabase()                         // todas las filas de la cuenta, orden actualizado_at desc
export async function getFlujosPublicadosSupabase()               // solo publicado=true, columnas flujo_id, nombre, grafo_vivo (para el webhook)
export async function guardarFlujoSupabase({ flujo_id, nombre, grafo })   // upsert por flujo_id (insert si no viene); devuelve la fila
export async function setPublicadoFlujoSupabase(flujo_id, publicado)      // publicado=true copia grafo→grafo_vivo; false deja grafo_vivo null
export async function borrarFlujoSupabase(flujo_id)
// lib/flujos.js
export async function getFlujos()
export async function guardarFlujo(args)
export async function publicarFlujo(flujo_id, publicar)  // publicar=true: valida (validarFlujo con respuestas actuales) + choquesDeDisparador contra los otros publicados; si hay errores devuelve { ok:false, errores } y NO publica
export async function borrarFlujo(flujo_id)
export async function importarRecetas()   // lee config.recetas y los anuncios asignados; por cada receta que NO tenga ya un flujo con nombre `[receta] <nombre>` crea uno con recetaAFlujo (publicado si recetas.activo && receta.activa); al final setAutomatizaciones({ recetas: { activo:false } }); devuelve { creados, saltados }
export function planDeImportacion(config, flujosExistentes)   // PURO: → [{ receta, sourceIds, organico, publicado, yaExiste }]
```
Rutas: `GET /api/flujos` → `{ok, flujos}` · `POST /api/flujos` `{flujo_id?, nombre, grafo}` → `{ok, flujo}` · `DELETE /api/flujos?flujo_id=` → `{ok}` · `POST /api/flujos/publicar` `{flujo_id, publicar}` → `{ok}` | `{ok:false, errores:[{texto,...}]}` · `POST /api/flujos/importar-recetas` → `{ok, creados, saltados}`. Todas con `dynamic='force-dynamic'`, `revalidate=0`, `try/catch` → 500 con `{ok:false,error}` como `app/api/anuncios/route.js`.

- [x] **Step 1: Pruebas (RED)**: `tests/rutas-publicas.test.js` (3 rutas en PROTEGIDAS — pasan ya, son la red) y `tests/flujos-importar.test.js`:
```js
import test from 'node:test'
import assert from 'node:assert'
import { planDeImportacion } from '../lib/flujos.js'
const config = { recetas: { activo: true, lista: [{ id: 'r_1', nombre: 'DBZ', activa: true, pasos: [], pregunta: null }, { id: 'r_2', nombre: 'Off', activa: false, pasos: [], pregunta: null }], por_anuncio: { '111': 'r_1', '222': 'r_1', organico: 'r_2' } } }
test('planDeImportacion: junta los anuncios por receta, marca orgánico y publicado', () => {
  const plan = planDeImportacion(config, [])
  const p1 = plan.find(p => p.receta.id === 'r_1'); assert.deepEqual(p1.sourceIds, ['111', '222']); assert.equal(p1.organico, false); assert.equal(p1.publicado, true); assert.equal(p1.yaExiste, false)
  const p2 = plan.find(p => p.receta.id === 'r_2'); assert.equal(p2.organico, true); assert.equal(p2.publicado, false)
})
test('planDeImportacion: una receta ya importada se marca yaExiste (idempotente)', () => {
  const plan = planDeImportacion(config, [{ nombre: '[receta] DBZ' }])
  assert.equal(plan.find(p => p.receta.id === 'r_1').yaExiste, true)
})
test('planDeImportacion: con recetas.activo=false nada queda publicado', () => {
  const plan = planDeImportacion({ recetas: { ...config.recetas, activo: false } }, [])
  assert.ok(plan.every(p => p.publicado === false))
})
```
⚠️ `lib/flujos.js` importa `./inbox-supabase.js` para las funciones async; `planDeImportacion` debe ser exportable sin tocar Supabase (el import del módulo no debe abrir conexión — `getSupabase()` es perezoso, así que basta con no llamarlo al cargar).

- [x] **Step 2: Implementar** las cuatro capas. Notas: `guardarFlujoSupabase` con `flujo_id` → `.update({nombre, grafo}).eq('cuenta',CUENTA).eq('flujo_id',id).select().single()`; sin id → `.insert({cuenta:CUENTA, nombre, grafo}).select().single()`. `setPublicadoFlujoSupabase(id, true)` → leer `grafo`, `.update({ publicado:true, grafo_vivo: grafo })`; `false` → `.update({ publicado:false, grafo_vivo:null })`. `publicarFlujo` obtiene `respuestas` con `getRespuestas()` (`lib/respuestas.js`) y `otros` con `getFlujosPublicadosSupabase()` excluyendo el propio id. `importarRecetas` usa `getAutomatizaciones`/`setAutomatizaciones` (`lib/automatizaciones.js`) y `getAnunciosResumen` no hace falta (los `sourceIds` salen de `por_anuncio`).

- [x] **Step 3: `npm test` → 0 fallos. Commit**
```bash
git add lib/inbox-supabase.js lib/flujos.js app/api/flujos/route.js app/api/flujos/publicar/route.js app/api/flujos/importar-recetas/route.js lib/api-client.js tests/rutas-publicas.test.js tests/flujos-importar.test.js
git commit -m "feat(flujos): persistencia, /api/flujos (guardar, publicar con validación, borrar) e importación de recetas"
```

---

### Task 4: Webhook — el motor lineal de flujos

**Files:**
- Modify: `app/api/webhook/route.js` (dentro de `procesar`: nueva `flujoSiCorresponde(m)`; el bucle llama primero a flujos y solo si no salió y `auto?.recetas?.activo`, a `recetaSiCorresponde`)

**Interfaces:** Consumes `getFlujosPublicadosSupabase` (vía `lib/flujos.js` → `getFlujosPublicados`), `elegirFlujo`, `caminoLineal`, `piezasDeNodos`, `temperaturaAlPasar` (`lib/flujo.js`), `updateTemperatura` (`lib/contactos.js`), y lo que ya usa `recetaSiCorresponde`: `marcarReceta`, `enviarSaliente`, `enviarTelegram`, `esc`, `respuestasRapidas()`, `recetados`, `saludados`, `modoIAde`, `esNuevoDe`, `tail9`, `waitUntil`.

- [x] **Step 1: Implementar `flujoSiCorresponde`** copiando la estructura de `recetaSiCorresponde` (léela primero) con estas diferencias:
  - Los flujos publicados se leen UNA vez por ciclo con un caché igual a `respuestasCache` (`flujosCache`), y solo cuando el mensaje tiene referral, o es contacto nuevo, o trae texto (`m.tipo === 'texto'`).
  - `const flujo = elegirFlujo({ flujos, sourceId, esNuevo: esNuevoDe(m.telefono), texto: m.contenido })`; sin flujo → `false`.
  - Guardias iguales: `modoIAde` → false; `recetados.has(t)` → false; `caminoLineal(flujo.grafo_vivo)` → `mensajes`; `piezas = piezasDeNodos({ nodos: mensajes, respuestas, contacto, citaId: m.wamid })`; vacío → warn y false; `marcarReceta` con guardia → si no `marcado` false; `recetados.add(t)`, `saludados.add(t)`.
  - Antes de despachar el envío: `const temp = temperaturaAlPasar(mensajes); if (temp) await updateTemperatura(m.telefono, temp).catch(log)`.
  - Tarea diferida idéntica (try/catch, envío secuencial, log `N/M piezas`, alarma Telegram si 0/N) con el texto `flujo <nombre>` en vez de `receta <id>`.
  - Log al detenerse en una rama: `console.log('[/api/webhook] flujo', flujo.nombre, 'se detuvo en', camino.motivo, camino.detenidoEn, '(Fase B)')`.
- [x] **Step 2: Enganchar en el bucle**: reemplazar `const conReceta = await recetaSiCorresponde(m)…` por
```js
    let conReceta = await flujoSiCorresponde(m).catch(e => { console.error('[/api/webhook] flujo:', e.message); return false })
    if (!conReceta && auto?.recetas?.activo) {
      conReceta = await recetaSiCorresponde(m).catch(e => { console.error('[/api/webhook] receta:', e.message); return false })
    }
```
  (el `if (!conReceta) saludarSiCorresponde…` queda igual).
- [x] **Step 3: `npm test` y `npx next build` limpios. Commit** `git add app/api/webhook/route.js` · `feat(flujos): el webhook ejecuta el camino lineal del flujo publicado; recetas solo si siguen activas`.

---

### Task 5: El lienzo — pestaña FLUJOS

**Files:**
- Modify: `package.json` (+ `@xyflow/react` `^12.11.6`), `package-lock.json` (`npm install @xyflow/react@12.11.6`)
- Create: `components/flujos/Flujos.jsx` (lista + lienzo + panel; exporta default), `components/flujos/nodos.jsx` (los cuatro tipos de nodo), `components/flujos/PanelEdicion.jsx` (panel derecho para nodo o línea), `components/flujos/grafo-reactflow.js` (PURO: `aReactFlow(grafo)` → `{nodes, edges}` y `deReactFlow(nodes, edges)` → `grafo`)
- Modify: `components/App.jsx` (pestaña `FLUJOS` en la lista de pestañas, en `cambiarLinea` si hace falta, en el `useEffect` del pegado, y el montaje con `next/dynamic`)
- Test: `tests/grafo-reactflow.test.js`

**Interfaces:** Consumes `getFlujos`, `saveFlujo`, `publicarFlujo`, `deleteFlujo`, `importarRecetas`, `fetchRepliesFromSheet`, `getAnuncios` (`lib/api-client.js`); `validarFlujo`, `puertosDe`, `nuevoGrafo`, `TIPOS_NODO` (`lib/flujo.js`).

- [x] **Step 1: Prueba del puente (RED)** `tests/grafo-reactflow.test.js`:
```js
import test from 'node:test'
import assert from 'node:assert'
import { aReactFlow, deReactFlow } from '../components/flujos/grafo-reactflow.js'
import { nuevoGrafo } from '../lib/flujo.js'
test('ida y vuelta conserva nodos, datos, posiciones y líneas con su puerto y espera', () => {
  const g = nuevoGrafo()
  g.nodos.push({ id: 'm', tipo: 'mensaje', pos: { x: 10, y: 20 }, datos: { origen: 'texto', texto: 'hola', adjuntos: [], botones: [{ title: 'Sí' }], esperarRespuesta: false, citarUltimaRespuesta: true, temperatura: 'tibio' } })
  g.lineas = [{ id: 'l1', de: g.nodos[0].id, puerto: 'siguiente', a: 'm', esperaMin: 0 }, { id: 'l2', de: 'm', puerto: 'btn_1', a: g.nodos[1].id, esperaMin: 90 }]
  const { nodes, edges } = aReactFlow(g)
  assert.equal(nodes.find(n => n.id === 'm').type, 'mensaje')
  assert.equal(edges.find(e => e.id === 'l2').sourceHandle, 'btn_1')
  assert.deepEqual(deReactFlow(nodes, edges), g)
})
```
- [x] **Step 2: `npm install @xyflow/react@12.11.6`** (commit `package.json` + `package-lock.json`).
- [x] **Step 3: `grafo-reactflow.js`** (puro): `aReactFlow(grafo)` → `nodes: [{ id, type: nodo.tipo, position: nodo.pos, data: { ...nodo.datos } }]`, `edges: [{ id, source: de, sourceHandle: puerto, target: a, targetHandle: 'in', label: esperaMin ? etiquetaEspera(esperaMin) : '', data: { esperaMin } }]`; `deReactFlow(nodes, edges)` inverso (`pos` con enteros redondeados, `datos` copia). `etiquetaEspera(min)` → `'⏱ 1 h 30 min'` / `'⏱ 45 min'`.
- [x] **Step 4: `nodos.jsx`**: cuatro componentes con `Handle` de React Flow. Entrada: `<Handle type="target" position={Position.Top} id="in" />` en mensaje/condicion/fin. Salidas: un `<Handle type="source" position={Position.Bottom} id={puerto} />` por cada `puertosDe(nodo)`, repartidos horizontalmente con etiqueta (título del botón, "Otra respuesta", "sí"/"no", "siguiente"). Tarjeta: cabecera con icono y tipo (📣 Disparador · 💬 Mensaje · 🔀 Condición · 🔴 Fin), cuerpo con resumen (anuncios/palabras; texto de la respuesta recortado + n.º adjuntos + 🔥/🌤️/❄️ si marca temperatura + "✋ espera respuesta" + "↩ cita"). Selección resaltada. Paleta del inbox (`#0d1828`, `#1e2d3d`, naranja `#f59e0b` para el disparador, verde `#25d366` para mensaje, azul `#60a5fa` para condición, rojo `#f87171` para fin). En Fase A, un mensaje con botones/esperar y las líneas con espera muestran una etiqueta gris "corre desde la Fase B".
- [x] **Step 5: `PanelEdicion.jsx`**: recibe el nodo o la línea seleccionada y `onChange`. Disparador: tipo (radio), lista de anuncios con casillas (etiqueta + titular + chats 30 d, de `getAnuncios`), palabras clave (chips). Mensaje: origen (respuesta rápida con `<select>` y vista previa / texto libre + adjuntos por URL + tipo), botones (3 inputs, maxLength 20), casillas esperar respuesta y citar última respuesta, temperatura al llegar (— / 🔥 / 🌤️ / ❄️). Condición: campo + valor. Línea: espera (número + unidad min/h, tope 23 h; vacío = inmediato). Errores de validación del nodo seleccionado en rojo debajo.
- [x] **Step 6: `Flujos.jsx`**: estado `flujos`, `actual`, `nodes/edges` (hooks `useNodesState`/`useEdgesState` de React Flow), `seleccion`, `dirty`, `errores`. Columna izquierda (lista, "+ Nuevo flujo" → `nuevoGrafo()`, duplicar, eliminar con confirmación por doble clic — no `confirm()`). Cabecera: nombre editable, "Guardar borrador" (`saveFlujo`), "Publicar"/"Despublicar" (`publicarFlujo`; si `errores`, mostrarlos y marcar nodos), estado (borrador/publicado/con cambios sin publicar), deshacer/rehacer (pila de grafos, 50). Paleta: botones "+ Mensaje", "+ Condición", "+ Fin" que agregan un nodo en el centro visible. `<ReactFlow nodeTypes fitView onConnect onNodesChange onEdgesChange onNodeClick onEdgeClick deleteKeyCode="Delete">` con `<Background/>`, `<MiniMap/>`, `<Controls/>`. `onConnect`: rechazar si el puerto ya tiene línea (un puerto, una línea). Importar `'@xyflow/react/dist/style.css'` en este archivo. Al abrir por primera vez sin flujos y con `config.recetas.lista.length>0`, ofrecer un botón "Importar las recetas de AUTOS" → `importarRecetas()`.
- [x] **Step 7: `App.jsx`**: agregar `{ id:'FLUJOS', label:'FLUJOS', icon:'🧭', color:'#a78bfa', sub:'Lienzo' }` después de `AUTO` en la lista de pestañas; sumar `'FLUJOS'` a los arreglos donde aparece `'AUTO'` como pestaña sin chat (`['SOCIAL','CONTACTOS','AUTO']` y cualquier `esPestanaDeChat`); montar `const Flujos = dynamic(() => import('./flujos/Flujos'), { ssr:false })` y un bloque igual al de AUTOMATIZACIONES con `display: linea === 'FLUJOS' ? 'flex' : 'none'`.
- [x] **Step 8: `npm test`, `npx next build`. Commit** (todos los archivos por nombre) `feat(flujos): pestaña FLUJOS con lienzo de nodos (React Flow), panel de edición, guardar y publicar`.

---

### Task 6: AUTOS — la tarjeta 📣 pasa a solo lectura

**Files:** Modify `components/Automatizaciones.jsx`.

- [x] Quitar el editor de recetas y el combo; dejar el interruptor global de recetas SOLO si `config.recetas.lista.length > 0` con la nota "Las recetas ahora viven en FLUJOS. Importa las que tengas desde esa pestaña; al importar, esto se apaga solo." y la lista de anuncios vistos (etiqueta editable, titular, chats 30 d, último chat) mostrando "→ flujo: <nombre>" cuando algún flujo publicado lo tenga en su Disparador (calculado con `getFlujos()`), o "sin flujo" en ámbar. Quitar helpers muertos (eslint los marca). `npm test` + build. Commit `refactor(autos): la tarjeta de anuncios apunta a FLUJOS; el editor de recetas se retira`.

---

### Task 7: Documentación

**Files:** Create `docs/HANDOFF-2026-09-15-flujos-fase-a.md`; Modify `docs/HANDOFF-2026-09-14-recetas-bienvenida.md` (nota arriba: "reemplazado por FLUJOS").

- [x] Handoff de una página: qué es, cómo se dibuja un flujo, qué corre en Fase A y qué no, cómo importar las recetas, los controles SQL (`select nombre, publicado, actualizado_at from inbox.flujos where cuenta='MANDI'`; el de `ultima_receta_at`), y lo pendiente de Fase B. Commit `docs: handoff FLUJOS fase A`.

---

### Task 8: Deploy, importación y verificación (controlador + Rodrigo)

- [x] `git push origin main`; confirmar deployment `READY` con el sha del último commit.
- [x] Controles negativos: `curl -s -o /dev/null -w "%{http_code}" https://inbox.apps.mandarinaec.com/api/flujos` → 401.
- [ ] Rodrigo abre FLUJOS, importa las recetas, ve los flujos lineales, publica el de prueba (Orgánico), escribe desde un número nuevo → llegan las piezas, la primera citando. Control: `select nombre, publicado from inbox.flujos where cuenta='MANDI'` y `select recetas->>'activo' from (select config->'recetas' recetas from inbox.automatizaciones where cuenta='MANDI') x` → `false`.
- [x] Memoria de Claude: archivo `inbox-flujos-lienzo.md` + línea en `MEMORY.md`.

---

## Self-review

- Cobertura de la spec §2 (nodos y puertos) → Task 2 `puertosDe`/`validarFlujo` + Task 5 nodos · §3 → Task 1 · §4 Fase A → Tasks 2, 4 · §5 → Task 5 · §6 → Task 3 · §7 → Tasks 2 (`recetaAFlujo`), 3 (`importarRecetas`), 6 · §8 riesgos: dos motores (Task 3 apaga `recetas.activo`, Task 4 orden), borrador roto (Task 3 `publicarFlujo` valida), ruta caliente (Task 4 caché por ciclo), bundle (Task 5 `dynamic`).
- Tipos: `grafo` = `{nodos, lineas}` en todas las tareas; `flujo` fila = `{ flujo_id, nombre, publicado, grafo, grafo_vivo }`; `elegirFlujo` recibe filas y lee `grafo_vivo`; `caminoLineal`/`piezasDeNodos` reciben grafo/nodos.
- Fase B (estado por cliente, ramas, esperas, condición, cron) queda para un plan aparte; en Fase A todo eso se dibuja y valida pero termina en Pendientes donde empieza la rama.
