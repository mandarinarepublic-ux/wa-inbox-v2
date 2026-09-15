# FLUJOS · Fase B — estado por cliente (ramas, esperas, condición) · plan de implementación (MANDI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un flujo publicado corra ENTERO: ramas por botón y "Otra respuesta", esperar la respuesta del cliente, esperas en las líneas, Condición, citar la última respuesta, contadores por nodo; y retirar el motor viejo de recetas.

**Architecture:** el grafo y toda decisión siguen siendo PUROS en `lib/flujo.js` (probados sin red). Se suma una tabla `inbox.flujo_estado` (un cliente está parado en UN nodo de UN flujo) y una `inbox.flujo_pasos` (bitácora para contadores). Un módulo de servidor nuevo, `lib/flujo-motor.js`, es el ÚNICO que manda piezas y escribe estado; lo llaman el webhook (al disparar y al avanzar con un entrante) y un cron cada 5 min (esperas vencidas). Cualquier saliente humano (inbox o celular) borra el estado del cliente.

**Tech Stack:** Next.js (App Router, Vercel Functions con `waitUntil`), Supabase (schema `inbox`, PostgREST), `node --test`, React Flow 12 en el lienzo.

**Spec:** `docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md` (§3 tabla `flujo_estado`, §4 "Fase B", §8 riesgos). Plan anterior: `docs/superpowers/plans/2026-09-15-flujos-fase-a.md` (todo lo que ahí se nombra ya existe en el repo).

## Global Constraints

- **Todo en `main`**, commits chicos, `npm test` (629+ pruebas + lint) en verde antes de cada commit. Nunca `git add -A` ni `git add .`: hay archivos sueltos sin trackear (`docs/superpowers/plans/2026-08-14-pausa-por-inactividad.md`) que no son de esto.
- Español ecuatoriano con **tuteo** en textos de la app, comentarios y commits (`tú`, `puedes`; nunca `vos`, `podés`).
- **Ruta caliente:** `/api/webhook` es la ruta #1 de consumo. Por entrante se permite UNA lectura más (`flujo_estado` por clave primaria) y solo si hay flujos publicados en el ciclo. Nada de leer toda la tabla por mensaje.
- **Un cliente está en UN flujo a la vez** (`primary key (cuenta, telefono)`). El que está gana: un entrante que dispararía otro flujo no reinicia nada.
- **Cualquier saliente NO automático borra el estado** (`/api/saliente` con `auto` ausente, y los ecos del celular en coexistencia).
- **Todo termina en PENDIENTES:** el motor nunca cambia `estado` de la conversación; la regla del webhook ("un entrante devuelve a PENDIENTE") no se toca.
- **Nunca fuera de la ventana de 24 h:** una espera vencida solo se sigue si `ultimo_entrante_at + 24 h − 5 min > ahora`; si no, se borra el estado.
- Los botones interactivos salen con ids `rc_1..rc_3` (`normalizarBotones` en `lib/recetas.js`) y los puertos del nodo son `btn_1..btn_3` (`puertosDe` en `lib/flujo.js`): **`rc_N` ↔ `btn_N`**, mismo índice.
- Un botón tocado llega al inbox como `tipo:'texto'` con `contenido = título` y el id en `raw.interactive.button_reply.id` (`lib/wa-mensaje.js` línea ~199). Las guardas de PALABRA (`raw.type==='text'`, `humanoAtendiendo`) de la Fase A no se tocan.
- **Cron nuevo = 3 lugares** o no corre nunca: `vercel.json`, `lib/rutas-publicas.js`, `middleware.js` (matcher). `tests/rutas-publicas.test.js` lo exige.
- Migraciones por MCP de Supabase (`apply_migration`, proyecto `piingkecjgoisnxccvaa`), nombre con prefijo `inbox_`. Se registran solas en `supabase_migrations.schema_migrations`.
- Hora de Ecuador = `America/Guayaquil` (como `lib/pagos-sin-pedido.js`).

---

### Task 1: Migración — `inbox.flujo_estado` y `inbox.flujo_pasos`

**Files:** migración Supabase por MCP, nombre `inbox_flujo_estado_fase_b`.

**Interfaces:**
- Produces: tabla `inbox.flujo_estado (cuenta, telefono, flujo_id, nodo_id, esperando, puerto_tiempo, vence_at, ultimo_wamid, actualizado_at)` con PK `(cuenta, telefono)`; tabla `inbox.flujo_pasos (paso_id, cuenta, telefono, flujo_id, nodo_id, pasado_at)`; función `inbox.flujo_pasos_contar(p_cuenta text, p_flujo_id uuid, p_desde timestamptz) returns table (nodo_id text, n bigint)`.

- [ ] **Step 1: Control previo**
```sql
select table_name from information_schema.tables where table_schema='inbox' and table_name in ('flujo_estado','flujo_pasos');
select pg_get_functiondef('inbox.tocar_updated_at'::regproc);
```
Esperado: 0 filas; la función existe y escribe `new.actualizado_at` (si escribe `updated_at`, usar la misma que usó la Fase A para `trg_flujos_updated_at`: mirar `select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid='inbox.flujos'::regclass`).

- [ ] **Step 2: Aplicar**
```sql
-- FLUJOS Fase B (15-sep-2026): estado por cliente + bitácora de pasos.
-- Ver wa-inbox-next/docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md §3.
create table if not exists inbox.flujo_estado (
  cuenta         text not null,
  telefono       text not null,                       -- canónico, igual que conversaciones.telefono
  flujo_id       uuid not null references inbox.flujos(flujo_id) on delete cascade,
  nodo_id        text not null,                       -- dónde está parado el cliente
  esperando      text not null check (esperando in ('boton','respuesta','tiempo')),
  puerto_tiempo  text,                                -- para 'tiempo': qué puerto seguir al vencer
  vence_at       timestamptz not null,                -- 'tiempo': cuándo seguir · otros: fin de la ventana 24h
  ultimo_wamid   text,                                -- para citar la última respuesta del cliente
  actualizado_at timestamptz not null default now(),
  primary key (cuenta, telefono)                      -- un cliente está en UN flujo a la vez
);
create index if not exists flujo_estado_vence on inbox.flujo_estado (cuenta, esperando, vence_at);
drop trigger if exists trg_flujo_estado_updated_at on inbox.flujo_estado;
create trigger trg_flujo_estado_updated_at before update on inbox.flujo_estado
  for each row execute function inbox.tocar_updated_at();

create table if not exists inbox.flujo_pasos (
  paso_id    bigint generated always as identity primary key,
  cuenta     text not null,
  telefono   text not null,
  flujo_id   uuid not null references inbox.flujos(flujo_id) on delete cascade,
  nodo_id    text not null,
  pasado_at  timestamptz not null default now()
);
create index if not exists flujo_pasos_flujo_fecha on inbox.flujo_pasos (cuenta, flujo_id, pasado_at);

-- Contadores por nodo (clientes DISTINTOS que pasaron desde p_desde).
create or replace function inbox.flujo_pasos_contar(p_cuenta text, p_flujo_id uuid, p_desde timestamptz)
returns table (nodo_id text, n bigint)
language sql stable as $$
  select nodo_id, count(distinct telefono) as n
  from inbox.flujo_pasos
  where cuenta = p_cuenta and flujo_id = p_flujo_id and pasado_at >= p_desde
  group by nodo_id
$$;
```

- [ ] **Step 3: Verificar**
```sql
select column_name from information_schema.columns where table_schema='inbox' and table_name='flujo_estado' order by ordinal_position;
insert into inbox.flujos (cuenta, nombre) values ('PRUEBA','x') returning flujo_id;  -- anotar el uuid
insert into inbox.flujo_estado (cuenta, telefono, flujo_id, nodo_id, esperando, vence_at) values ('PRUEBA','593999000111','<uuid>','m1','boton', now() + interval '1 day');
insert into inbox.flujo_pasos (cuenta, telefono, flujo_id, nodo_id) values ('PRUEBA','593999000111','<uuid>','m1'), ('PRUEBA','593999000111','<uuid>','m1'), ('PRUEBA','593999000222','<uuid>','m1');
select * from inbox.flujo_pasos_contar('PRUEBA','<uuid>', now() - interval '30 days');
delete from inbox.flujos where cuenta='PRUEBA';   -- el cascade tiene que dejar 0 en las dos tablas
select (select count(*) from inbox.flujo_estado where cuenta='PRUEBA') estados, (select count(*) from inbox.flujo_pasos where cuenta='PRUEBA') pasos;
```
Esperado: 9 columnas · `m1 | 2` (dos teléfonos distintos, no tres filas) · `0 | 0`.

---

### Task 2: `lib/flujo.js` — el motor puro de la Fase B

**Files:**
- Modify: `lib/flujo.js` (la función `caminoLineal` líneas ~330-385 se reescribe encima de `avanzarDesde`; lo demás se agrega al final, antes de `recetaAFlujo`)
- Test: `tests/flujo.test.js` (se agregan pruebas al final; las 26 existentes siguen igual)

**Interfaces:**
- Consumes: `puertosDe`, `nodoDisparador`, `normalizarTexto`, `TOPE_PASOS_CAMINO` (ya existen en el archivo), `normalizarBotones` de `./recetas.js`.
- Produces (todas exportadas, puras):
  - `avanzarDesde(grafo, { nodoId, puerto, saltarEsperaInicial = false, evaluar = null })` → `{ mensajes: nodo[], visitados: string[], detenidoEn: string|null, lineaEspera?: string, puertoEspera?: string, esperaMin?: number, motivo: 'fin'|'botones'|'esperar_respuesta'|'espera'|'condicion'|'huerfano' }`.
  - `caminoLineal(grafo)` → igual que hoy (mismo contrato que usan el webhook y las pruebas), implementado como `avanzarDesde` desde el Disparador.
  - `evaluarCondicion(nodo, ctx)` → `true|false`. `ctx = { temperatura: string, tieneVenta: boolean, estado: string, ahora: Date }`.
  - `puertoDeEntrante(nodo, { botonId, texto })` → `'btn_N' | 'otra' | 'respuesta' | null`.
  - `paradaDeCamino(camino, { ahora: Date, ultimoEntranteAt: string|null })` → `null` o `{ esperando: 'boton'|'respuesta'|'tiempo', nodoId, puertoTiempo: string|null, venceAt: string(ISO) }`.
  - `citaDeTanda({ nodos, esDisparo, wamidEntrante, ultimoWamid })` → `string` (el wamid a citar en la primera pieza, o `''`).
  - `ventanaAbierta(ultimoEntranteAt, ahora, margenMin = 5)` → `boolean`.
  - `horaEcuador(fecha)` → `'HH:MM'`.

- [ ] **Step 1: Pruebas (RED)** — agregar al final de `tests/flujo.test.js` (usa los fixtures `D`, `M`, `F`, `L`, `contacto`, `respuestas`, `lineal` que ya están arriba del archivo). Sumar `avanzarDesde, evaluarCondicion, puertoDeEntrante, paradaDeCamino, citaDeTanda, ventanaAbierta, horaEcuador` al `import` de la línea 3.

```js
// ── Fase B ────────────────────────────────────────────────────────────────────
const C = (id, datos) => ({ id, tipo: 'condicion', pos: { x: 0, y: 0 }, datos })
// d → pregunta(btn Sí/No) → [Sí] m_si → f · [No] m_no → f · [otra] m_otra → f
const conBotones = {
  nodos: [D({ tipo: 'organico' }), M('preg', { botones: [{ title: 'Sí' }, { title: 'No' }] }), M('m_si', {}), M('m_no', {}), M('m_otra', {}), F],
  lineas: [L('d', 'preg'), L('preg', 'm_si', 'btn_1'), L('preg', 'm_no', 'btn_2'), L('preg', 'm_otra', 'otra'), L('m_si', 'f'), L('m_no', 'f'), L('m_otra', 'f')],
}
// d → a ─(espera 30 min)→ b → f
const conEspera = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'siguiente', 30), L('b', 'f')] }
// d → cond(temperatura=caliente) → [si] m_si → f · [no] m_no → f
const conCondicion = {
  nodos: [D({ tipo: 'organico' }), C('cond', { campo: 'temperatura', valor: 'caliente' }), M('m_si', {}), M('m_no', {}), F],
  lineas: [L('d', 'cond'), L('cond', 'm_si', 'si'), L('cond', 'm_no', 'no'), L('m_si', 'f'), L('m_no', 'f')],
}

test('avanzarDesde: desde un botón sigue la rama de ese botón y llega a Fin', () => {
  const r = avanzarDesde(conBotones, { nodoId: 'preg', puerto: 'btn_2' })
  assert.deepEqual(r.mensajes.map(n => n.id), ['m_no'])
  assert.equal(r.motivo, 'fin')
  assert.deepEqual(r.visitados, ['m_no', 'f'])
})
test('avanzarDesde: una línea con espera se detiene ANTES de seguirla y dice por dónde seguir', () => {
  const r = avanzarDesde(conEspera, { nodoId: 'd', puerto: 'siguiente' })
  assert.deepEqual(r.mensajes.map(n => n.id), ['a'])
  assert.equal(r.motivo, 'espera')
  assert.equal(r.detenidoEn, 'a')
  assert.equal(r.puertoEspera, 'siguiente')
  assert.equal(r.esperaMin, 30)
})
test('avanzarDesde: con saltarEsperaInicial la primera línea se sigue aunque tenga espera (así reanuda el cron)', () => {
  const r = avanzarDesde(conEspera, { nodoId: 'a', puerto: 'siguiente', saltarEsperaInicial: true })
  assert.deepEqual(r.mensajes.map(n => n.id), ['b'])
  assert.equal(r.motivo, 'fin')
})
test('avanzarDesde: sin evaluar, una Condición detiene; con evaluar, sigue por si/no y la cuenta como visitada', () => {
  const sinEval = avanzarDesde(conCondicion, { nodoId: 'd', puerto: 'siguiente' })
  assert.equal(sinEval.motivo, 'condicion')
  assert.equal(sinEval.detenidoEn, 'cond')
  const si = avanzarDesde(conCondicion, { nodoId: 'd', puerto: 'siguiente', evaluar: () => true })
  assert.deepEqual(si.mensajes.map(n => n.id), ['m_si'])
  assert.deepEqual(si.visitados, ['cond', 'm_si', 'f'])
  const no = avanzarDesde(conCondicion, { nodoId: 'd', puerto: 'siguiente', evaluar: () => false })
  assert.deepEqual(no.mensajes.map(n => n.id), ['m_no'])
})
test('caminoLineal sigue dando lo mismo que antes (contrato de la Fase A)', () => {
  const r = caminoLineal(lineal)
  assert.deepEqual(r.mensajes.map(n => n.id), ['m1', 'm2'])
  assert.equal(r.motivo, 'fin')
  assert.equal(caminoLineal(conBotones).motivo, 'botones')
  assert.equal(caminoLineal(conEspera).motivo, 'espera')
})

test('evaluarCondicion: temperatura, tiene_venta, bandeja, hora (rango normal y rango que cruza medianoche)', () => {
  const base = { temperatura: 'caliente', tieneVenta: false, estado: 'pendiente', ahora: new Date('2026-09-15T15:30:00-05:00') } // 15:30 Ecuador
  assert.equal(evaluarCondicion(C('c', { campo: 'temperatura', valor: 'Caliente' }), base), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'temperatura', valor: 'frio' }), base), false)
  assert.equal(evaluarCondicion(C('c', { campo: 'tiene_venta', valor: 'no' }), base), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'tiene_venta', valor: 'si' }), { ...base, tieneVenta: true }), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'bandeja', valor: 'PENDIENTE' }), base), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'hora', valor: '09:00-18:00' }), base), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'hora', valor: '18:00-09:00' }), base), false)
  assert.equal(evaluarCondicion(C('c', { campo: 'hora', valor: '22:00-06:00' }), { ...base, ahora: new Date('2026-09-15T23:10:00-05:00') }), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'hora', valor: 'cualquier cosa' }), base), false)
  assert.equal(evaluarCondicion(C('c', { campo: 'mago', valor: 'x' }), base), false)
})
test('horaEcuador: convierte a America/Guayaquil', () => {
  assert.equal(horaEcuador(new Date('2026-09-15T20:05:00Z')), '15:05')
})

test('puertoDeEntrante: id rc_N → btn_N; texto igual al título → ese botón; otro texto → otra; esperando respuesta → respuesta; nodo simple → null', () => {
  const preg = conBotones.nodos.find(n => n.id === 'preg')
  assert.equal(puertoDeEntrante(preg, { botonId: 'rc_2', texto: 'No' }), 'btn_2')
  assert.equal(puertoDeEntrante(preg, { botonId: '', texto: '  sí ' }), 'btn_1')
  assert.equal(puertoDeEntrante(preg, { botonId: '', texto: 'quiero ver fotos' }), 'otra')
  assert.equal(puertoDeEntrante(preg, { botonId: 'rc_9', texto: 'x' }), 'otra')
  assert.equal(puertoDeEntrante(M('e', { esperarRespuesta: true }), { botonId: '', texto: 'lo que sea' }), 'respuesta')
  assert.equal(puertoDeEntrante(M('s', {}), { botonId: '', texto: 'hola' }), null)
})

test('paradaDeCamino: botones/respuesta esperan hasta el fin de la ventana; espera en la línea espera esperaMin; fin → null', () => {
  const ahora = new Date('2026-09-15T10:00:00Z')
  const ultimoEntranteAt = '2026-09-15T09:00:00Z'
  const pb = paradaDeCamino(caminoLineal(conBotones), { ahora, ultimoEntranteAt })
  assert.deepEqual(pb, { esperando: 'boton', nodoId: 'preg', puertoTiempo: null, venceAt: '2026-09-16T09:00:00.000Z' })
  const pr = paradaDeCamino(caminoLineal({ nodos: [D({ tipo: 'organico' }), M('e', { esperarRespuesta: true }), F], lineas: [L('d', 'e'), L('e', 'f', 'respuesta')] }), { ahora, ultimoEntranteAt })
  assert.equal(pr.esperando, 'respuesta')
  const pt = paradaDeCamino(caminoLineal(conEspera), { ahora, ultimoEntranteAt })
  assert.deepEqual(pt, { esperando: 'tiempo', nodoId: 'a', puertoTiempo: 'siguiente', venceAt: '2026-09-15T10:30:00.000Z' })
  assert.equal(paradaDeCamino(caminoLineal(lineal), { ahora, ultimoEntranteAt }), null)
  // sin ultimoEntranteAt (contacto recién creado): la ventana se cuenta desde ahora
  assert.equal(paradaDeCamino(caminoLineal(conBotones), { ahora, ultimoEntranteAt: null }).venceAt, '2026-09-16T10:00:00.000Z')
})

test('citaDeTanda: al disparar cita el entrante; después solo si el primer nodo pide citar la última respuesta', () => {
  assert.equal(citaDeTanda({ nodos: [M('a', {})], esDisparo: true, wamidEntrante: 'w1', ultimoWamid: '' }), 'w1')
  assert.equal(citaDeTanda({ nodos: [M('a', {})], esDisparo: false, wamidEntrante: 'w2', ultimoWamid: 'w2' }), '')
  assert.equal(citaDeTanda({ nodos: [M('a', { citarUltimaRespuesta: true })], esDisparo: false, wamidEntrante: '', ultimoWamid: 'w9' }), 'w9')
  assert.equal(citaDeTanda({ nodos: [], esDisparo: true, wamidEntrante: 'w1', ultimoWamid: '' }), '')
})

test('ventanaAbierta: 24 h desde el último entrante, con 5 min de margen; sin fecha → cerrada', () => {
  const ahora = new Date('2026-09-16T08:56:00Z')
  assert.equal(ventanaAbierta('2026-09-15T09:00:00Z', ahora), false)   // quedan 4 min: no alcanza
  assert.equal(ventanaAbierta('2026-09-15T09:02:00Z', ahora), true)    // quedan 6 min
  assert.equal(ventanaAbierta(null, ahora), false)
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test tests/flujo.test.js`
Expected: FAIL con `avanzarDesde is not a function` (o `does not provide an export named`).

- [ ] **Step 3: Implementar en `lib/flujo.js`** — reemplazar `caminoLineal` por esto (mismo comentario de cabecera que tiene hoy, ampliado) y agregar el resto debajo de `temperaturaAlPasar`:

```js
/**
 * Camina el grafo desde (nodoId, puerto) siguiendo líneas hasta el primer punto
 * que necesita algo que este módulo puro no tiene: la respuesta del cliente
 * (botones / esperar), el reloj (espera en la línea) o —si no se pasa `evaluar`—
 * una Condición. Devuelve los Mensajes a mandar EN ORDEN y por qué se detuvo.
 *
 *  - `saltarEsperaInicial`: la PRIMERA línea se sigue aunque tenga espera. Así
 *    reanuda el cron: el cliente estaba parado en el origen de esa línea y la
 *    espera ya se cumplió.
 *  - `evaluar(nodoCondicion) → true|false`: si se pasa, la Condición se resuelve
 *    en el momento y se sigue por `si`/`no`; si no, se detiene ahí (Fase A).
 *  - `visitados`: TODOS los nodos por los que pasó (mensajes, condiciones, fin),
 *    para la bitácora de pasos. No incluye el nodo de arranque.
 *
 * motivos: 'fin' · 'botones' · 'esperar_respuesta' · 'espera' (trae
 * `lineaEspera`, `puertoEspera`, `esperaMin`) · 'condicion' · 'huerfano'.
 */
export function avanzarDesde(grafo, { nodoId, puerto, saltarEsperaInicial = false, evaluar = null }) {
  const nodos = (Array.isArray(grafo?.nodos) ? grafo.nodos : []).filter(Boolean)
  const lineas = (Array.isArray(grafo?.lineas) ? grafo.lineas : []).filter(Boolean)
  const porId = new Map(nodos.map((n) => [n.id, n]))
  const lineaDe = (id, p) => lineas.find((l) => l.de === id && l.puerto === p)

  const mensajes = []
  const visitados = []
  let actualId = nodoId
  let puertoActual = puerto
  if (!porId.has(actualId)) return { mensajes, visitados, detenidoEn: null, motivo: 'huerfano' }

  for (let paso = 0; paso < TOPE_PASOS_CAMINO; paso++) {
    const linea = lineaDe(actualId, puertoActual)
    if (!linea) return { mensajes, visitados, detenidoEn: actualId, motivo: 'fin' }

    const espera = esperaMinDe(linea.esperaMin)
    if (Number.isNaN(espera)) return { mensajes, visitados, detenidoEn: actualId, motivo: 'huerfano' }
    const saltar = saltarEsperaInicial && paso === 0
    if (espera > 0 && !saltar) {
      return { mensajes, visitados, detenidoEn: actualId, lineaEspera: linea.id, puertoEspera: puertoActual, esperaMin: espera, motivo: 'espera' }
    }

    const destino = porId.get(linea.a)
    if (!destino) return { mensajes, visitados, detenidoEn: actualId, motivo: 'huerfano' }

    if (destino.tipo === 'fin') {
      visitados.push(destino.id)
      return { mensajes, visitados, detenidoEn: destino.id, motivo: 'fin' }
    }
    if (destino.tipo === 'condicion') {
      if (typeof evaluar !== 'function') return { mensajes, visitados, detenidoEn: destino.id, motivo: 'condicion' }
      visitados.push(destino.id)
      actualId = destino.id
      puertoActual = evaluar(destino) ? 'si' : 'no'
      continue
    }
    if (destino.tipo === 'mensaje') {
      mensajes.push(destino)
      visitados.push(destino.id)
      const puertos = puertosDe(destino)
      if (puertos.some((p) => p.startsWith('btn_'))) return { mensajes, visitados, detenidoEn: destino.id, motivo: 'botones' }
      if (puertos.includes('respuesta')) return { mensajes, visitados, detenidoEn: destino.id, motivo: 'esperar_respuesta' }
      actualId = destino.id
      puertoActual = 'siguiente'
      continue
    }
    // Disparador u otro tipo como destino: en un grafo válido no pasa; mejor parar.
    return { mensajes, visitados, detenidoEn: actualId, motivo: 'huerfano' }
  }
  return { mensajes, visitados, detenidoEn: actualId, motivo: 'huerfano' }
}

/** El camino lineal desde el Disparador (contrato de la Fase A: sin resolver condiciones). */
export function caminoLineal(grafo) {
  const disparador = nodoDisparador(grafo)
  if (!disparador) return { mensajes: [], visitados: [], detenidoEn: null, motivo: 'huerfano' }
  return avanzarDesde(grafo, { nodoId: disparador.id, puerto: 'siguiente' })
}

const H_MS = 3600 * 1000
export const VENTANA_MS = 24 * H_MS

/** 'HH:MM' en hora de Ecuador (America/Guayaquil). */
export function horaEcuador(fecha) {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(fecha)
  const h = partes.find((p) => p.type === 'hour')?.value || '00'
  const m = partes.find((p) => p.type === 'minute')?.value || '00'
  // en-GB puede dar "24" a medianoche
  return `${h === '24' ? '00' : h}:${m}`
}

/**
 * Evalúa una Condición contra el contacto en ese momento. Cualquier cosa rara
 * (campo desconocido, rango de horas mal escrito) da FALSE: la rama "no" es la
 * segura, porque es la que el dueño dibujó para "no se cumplió".
 *  - temperatura: igual, sin mayúsculas ni acentos ('' del contacto nunca iguala)
 *  - tiene_venta: valor 'si'/'no' contra ctx.tieneVenta
 *  - bandeja: igual al estado de la conversación (pendiente/atendido/soporte/descartado)
 *  - hora: 'HH:MM-HH:MM' en hora de Ecuador; si el fin es menor que el inicio,
 *    el rango cruza la medianoche (22:00-06:00)
 */
export function evaluarCondicion(nodo, ctx) {
  const campo = String(nodo?.datos?.campo || '')
  const valor = normalizarTexto(nodo?.datos?.valor)
  if (campo === 'temperatura') return !!valor && normalizarTexto(ctx?.temperatura) === valor
  if (campo === 'tiene_venta') return valor === 'si' ? !!ctx?.tieneVenta : valor === 'no' ? !ctx?.tieneVenta : false
  if (campo === 'bandeja') return !!valor && normalizarTexto(ctx?.estado) === valor
  if (campo === 'hora') {
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(valor)
    if (!m) return false
    const ini = Number(m[1]) * 60 + Number(m[2])
    const fin = Number(m[3]) * 60 + Number(m[4])
    const [hh, mm] = horaEcuador(ctx?.ahora instanceof Date ? ctx.ahora : new Date()).split(':').map(Number)
    const ahora = hh * 60 + mm
    return ini <= fin ? (ahora >= ini && ahora < fin) : (ahora >= ini || ahora < fin)
  }
  return false
}

/**
 * Por qué puerto sigue el cliente según lo que mandó, parado en `nodo`:
 *  - con botones: el id `rc_N` del botón tocado → `btn_N`; si escribió el título
 *    del botón a mano ("sí") también cuenta; cualquier otra cosa → 'otra'.
 *  - esperando respuesta (sin botones): lo que sea → 'respuesta'.
 *  - nodo simple (no espera nada): null.
 */
export function puertoDeEntrante(nodo, { botonId = '', texto = '' } = {}) {
  const puertos = puertosDe(nodo)
  const botones = puertos.filter((p) => p.startsWith('btn_'))
  if (botones.length) {
    const m = /^rc_(\d+)$/.exec(String(botonId || '').trim())
    if (m && botones.includes(`btn_${m[1]}`)) return `btn_${m[1]}`
    const t = normalizarTexto(texto)
    const idx = normalizarBotones(nodo?.datos?.botones).findIndex((b) => normalizarTexto(b.title) === t)
    if (t && idx >= 0) return `btn_${idx + 1}`
    return 'otra'
  }
  if (puertos.includes('respuesta')) return 'respuesta'
  return null
}

/**
 * Qué estado hay que guardar cuando el camino se detuvo (o null si terminó y no
 * hay nada que esperar). Botones y respuesta esperan hasta el fin de la ventana
 * de 24 h del cliente; una espera en la línea, exactamente esperaMin.
 */
export function paradaDeCamino(camino, { ahora, ultimoEntranteAt }) {
  const t0 = ultimoEntranteAt ? Date.parse(ultimoEntranteAt) : NaN
  const finVentana = new Date((Number.isFinite(t0) ? t0 : ahora.getTime()) + VENTANA_MS).toISOString()
  if (camino?.motivo === 'botones') return { esperando: 'boton', nodoId: camino.detenidoEn, puertoTiempo: null, venceAt: finVentana }
  if (camino?.motivo === 'esperar_respuesta') return { esperando: 'respuesta', nodoId: camino.detenidoEn, puertoTiempo: null, venceAt: finVentana }
  if (camino?.motivo === 'espera') {
    return { esperando: 'tiempo', nodoId: camino.detenidoEn, puertoTiempo: camino.puertoEspera, venceAt: new Date(ahora.getTime() + camino.esperaMin * 60 * 1000).toISOString() }
  }
  return null
}

/** El wamid que cita la primera pieza de una tanda (spec §1: al disparar se cita el entrante). */
export function citaDeTanda({ nodos, esDisparo, wamidEntrante = '', ultimoWamid = '' }) {
  const primero = (Array.isArray(nodos) ? nodos : []).filter(Boolean)[0]
  if (!primero) return ''
  if (esDisparo) return String(wamidEntrante || '')
  return primero?.datos?.citarUltimaRespuesta ? String(ultimoWamid || '') : ''
}

/** ¿Sigue abierta la ventana de 24 h de Meta, con margen para que el envío alcance? */
export function ventanaAbierta(ultimoEntranteAt, ahora, margenMin = 5) {
  const t0 = ultimoEntranteAt ? Date.parse(ultimoEntranteAt) : NaN
  if (!Number.isFinite(t0)) return false
  return t0 + VENTANA_MS - margenMin * 60 * 1000 > ahora.getTime()
}
```
Notas: `TOPE_PASOS_CAMINO` y `esperaMinDe` ya existen más arriba en el archivo. El `import` de `./recetas.js` ya trae `normalizarBotones`.

- [ ] **Step 4: GREEN**

Run: `node --test tests/flujo.test.js tests/grafo-reactflow.test.js && npm test`
Expected: todo pasa (las 26 pruebas viejas + las 10 nuevas); lint 0 errores.

- [ ] **Step 5: Commit**
```bash
git add lib/flujo.js tests/flujo.test.js
git commit -m "feat(flujos): motor puro de la Fase B — avanzarDesde, condición, puerto del entrante, parada y cita"
```

---

### Task 3: Persistencia — `flujo_estado` y `flujo_pasos` en `lib/inbox-supabase.js` + capa `lib/flujos.js`

**Files:**
- Modify: `lib/inbox-supabase.js` (agregar al final, después de `borrarFlujoSupabase`)
- Modify: `lib/flujos.js` (agregar exports al final)
- Test: `tests/flujos-estado.test.js` (nuevo; prueba la forma pura `filaDeEstado`)

**Interfaces:**
- Consumes: `getSupabase`, `CUENTA`, `canonTel` de `./supabase.js` (ya importados en `inbox-supabase.js`).
- Produces en `inbox-supabase.js`:
  - `getFlujoEstadoSupabase(telefono)` → fila `{ telefono, flujo_id, nodo_id, esperando, puerto_tiempo, vence_at, ultimo_wamid, actualizado_at }` o `null`.
  - `setFlujoEstadoSupabase({ telefono, flujo_id, nodo_id, esperando, puerto_tiempo, vence_at, ultimo_wamid })` → `{ ok: true }` (upsert por `cuenta,telefono`).
  - `borrarFlujoEstadoSupabase(telefono)` → `{ ok: true, borrado: boolean }`.
  - `getFlujoEstadosVencidosSupabase(ahoraIso, limite = 200)` → filas con `esperando='tiempo'` y `vence_at <= ahoraIso`.
  - `borrarFlujoEstadosCaducadosSupabase(ahoraIso)` → `{ ok: true, borrados: number }` (`esperando in ('boton','respuesta')` y `vence_at < ahoraIso`).
  - `registrarPasosFlujoSupabase({ telefono, flujo_id, nodoIds })` → `{ ok: true }`.
  - `contarPasosFlujoSupabase(flujo_id, desdeIso)` → `{ [nodo_id]: n }`.
- Produces en `lib/flujos.js`: `filaDeEstado(telefono, parada, { flujo_id, ultimoWamid })` (PURO) y los async `getEstadoFlujo`, `guardarEstadoFlujo`, `borrarEstadoFlujo`, `getEstadosVencidos`, `borrarEstadosCaducados`, `registrarPasos`, `contarPasos` que delegan en `SB.*`.

- [ ] **Step 1: Prueba (RED)** — crear `tests/flujos-estado.test.js`:
```js
import test from 'node:test'
import assert from 'node:assert'
import { filaDeEstado } from '../lib/flujos.js'

test('filaDeEstado: convierte la parada del motor puro en la fila de inbox.flujo_estado', () => {
  const parada = { esperando: 'tiempo', nodoId: 'a', puertoTiempo: 'siguiente', venceAt: '2026-09-15T10:30:00.000Z' }
  assert.deepEqual(filaDeEstado('0999000111', parada, { flujo_id: 'f-1', ultimoWamid: 'w1' }), {
    telefono: '0999000111', flujo_id: 'f-1', nodo_id: 'a', esperando: 'tiempo', puerto_tiempo: 'siguiente',
    vence_at: '2026-09-15T10:30:00.000Z', ultimo_wamid: 'w1',
  })
  const botones = { esperando: 'boton', nodoId: 'preg', puertoTiempo: null, venceAt: '2026-09-16T09:00:00.000Z' }
  assert.equal(filaDeEstado('0999000111', botones, { flujo_id: 'f-1', ultimoWamid: '' }).puerto_tiempo, null)
})
```
Run: `node --test tests/flujos-estado.test.js` → FAIL (`filaDeEstado` no existe).

- [ ] **Step 2: Implementar en `lib/inbox-supabase.js`** (al final del bloque FLUJOS):
```js
// ── FLUJOS Fase B: estado por cliente + bitácora ────────────────────────────
// Un cliente está en UN flujo a la vez: PK (cuenta, telefono). El teléfono se
// guarda canónico, igual que conversaciones.telefono, para que el mismo cliente
// escrito con o sin 593 caiga en la misma fila.
const telEstado = (telefono) => canonTel(telefono) || String(telefono || '')
const COLS_ESTADO = 'telefono, flujo_id, nodo_id, esperando, puerto_tiempo, vence_at, ultimo_wamid, actualizado_at'

export async function getFlujoEstadoSupabase(telefono) {
  const sb = getSupabase()
  const { data, error } = await sb.from('flujo_estado').select(COLS_ESTADO)
    .eq('cuenta', CUENTA).eq('telefono', telEstado(telefono)).maybeSingle()
  if (error) throw error
  return data || null
}

export async function setFlujoEstadoSupabase({ telefono, flujo_id, nodo_id, esperando, puerto_tiempo = null, vence_at, ultimo_wamid = '' }) {
  const sb = getSupabase()
  const { error } = await sb.from('flujo_estado')
    .upsert({ cuenta: CUENTA, telefono: telEstado(telefono), flujo_id, nodo_id, esperando, puerto_tiempo, vence_at, ultimo_wamid: ultimo_wamid || null }, { onConflict: 'cuenta,telefono' })
  if (error) throw error
  return { ok: true }
}

export async function borrarFlujoEstadoSupabase(telefono) {
  const sb = getSupabase()
  const { data, error } = await sb.from('flujo_estado').delete()
    .eq('cuenta', CUENTA).eq('telefono', telEstado(telefono)).select('telefono')
  if (error) throw error
  return { ok: true, borrado: (data || []).length > 0 }
}

// Esperas en la línea que ya se cumplieron (las mira el cron). Con tope: si un
// día hay miles, mejor varias pasadas de 5 min que una función que se muere.
export async function getFlujoEstadosVencidosSupabase(ahoraIso, limite = 200) {
  const sb = getSupabase()
  const { data, error } = await sb.from('flujo_estado').select(COLS_ESTADO)
    .eq('cuenta', CUENTA).eq('esperando', 'tiempo').lte('vence_at', ahoraIso)
    .order('vence_at', { ascending: true }).limit(limite)
  if (error) throw error
  return data || []
}

// Un cliente que nunca tocó el botón ni contestó: pasada la ventana, ya no hay
// flujo que seguir (el chat sigue en PENDIENTES para una persona).
export async function borrarFlujoEstadosCaducadosSupabase(ahoraIso) {
  const sb = getSupabase()
  const { data, error } = await sb.from('flujo_estado').delete()
    .eq('cuenta', CUENTA).in('esperando', ['boton', 'respuesta']).lt('vence_at', ahoraIso).select('telefono')
  if (error) throw error
  return { ok: true, borrados: (data || []).length }
}

export async function registrarPasosFlujoSupabase({ telefono, flujo_id, nodoIds }) {
  const ids = (Array.isArray(nodoIds) ? nodoIds : []).filter(Boolean)
  if (!ids.length) return { ok: true }
  const sb = getSupabase()
  const tel = telEstado(telefono)
  const { error } = await sb.from('flujo_pasos').insert(ids.map((nodo_id) => ({ cuenta: CUENTA, telefono: tel, flujo_id, nodo_id })))
  if (error) throw error
  return { ok: true }
}

// Clientes DISTINTOS que pasaron por cada nodo desde `desdeIso` (función SQL de
// la migración inbox_flujo_estado_fase_b; PostgREST no agrupa solo).
export async function contarPasosFlujoSupabase(flujo_id, desdeIso) {
  const sb = getSupabase()
  const { data, error } = await sb.rpc('flujo_pasos_contar', { p_cuenta: CUENTA, p_flujo_id: flujo_id, p_desde: desdeIso })
  if (error) throw error
  const out = {}
  for (const fila of data || []) out[fila.nodo_id] = Number(fila.n) || 0
  return out
}
```

- [ ] **Step 3: Implementar en `lib/flujos.js`** (al final):
```js
// ── Fase B: estado por cliente ───────────────────────────────────────────────
/** PURO: la parada que devuelve lib/flujo.js (paradaDeCamino) → fila de inbox.flujo_estado. */
export function filaDeEstado(telefono, parada, { flujo_id, ultimoWamid = '' }) {
  return {
    telefono: String(telefono || ''),
    flujo_id,
    nodo_id: parada.nodoId,
    esperando: parada.esperando,
    puerto_tiempo: parada.puertoTiempo || null,
    vence_at: parada.venceAt,
    ultimo_wamid: ultimoWamid || '',
  }
}
export async function getEstadoFlujo(telefono) { return SB.getFlujoEstadoSupabase(telefono) }
export async function guardarEstadoFlujo(fila) { return SB.setFlujoEstadoSupabase(fila) }
export async function borrarEstadoFlujo(telefono) { return SB.borrarFlujoEstadoSupabase(telefono) }
export async function getEstadosVencidos(ahoraIso, limite) { return SB.getFlujoEstadosVencidosSupabase(ahoraIso, limite) }
export async function borrarEstadosCaducados(ahoraIso) { return SB.borrarFlujoEstadosCaducadosSupabase(ahoraIso) }
export async function registrarPasos(args) { return SB.registrarPasosFlujoSupabase(args) }
export async function contarPasos(flujo_id, desdeIso) { return SB.contarPasosFlujoSupabase(flujo_id, desdeIso) }
```

- [ ] **Step 4: GREEN + prueba real contra la base** — `npm test` en verde, y desde una consola Node con las variables de prod NO se puede (memoria: `vercel env pull` oculta los secretos). En su lugar, verificar por SQL después del deploy de la Task 5 (los controles están ahí).

- [ ] **Step 5: Commit**
```bash
git add lib/inbox-supabase.js lib/flujos.js tests/flujos-estado.test.js
git commit -m "feat(flujos): persistencia del estado por cliente y de la bitácora de pasos"
```

---

### Task 4: `lib/flujo-motor.js` — correr una tanda (mandar, marcar, guardar estado)

**Files:**
- Create: `lib/flujo-motor.js`
- Test: `tests/flujo-motor.test.js` (con dependencias inyectadas: sin red ni base)

**Interfaces:**
- Consumes: `avanzarDesde`, `evaluarCondicion`, `paradaDeCamino`, `citaDeTanda`, `piezasDeNodos`, `temperaturaAlPasar` de `./flujo.js`; `filaDeEstado` de `./flujos.js`.
- Produces: `correrTanda(deps, args)`:
  - `deps = { enviar(pieza)→Promise<{ok}>, guardarEstado(fila), borrarEstado(telefono), registrarPasos({telefono, flujo_id, nodoIds}), setTemperatura(telefono, temp), avisar(texto), ahora: () => Date, log }` — TODAS inyectadas para poder probarlo.
  - `args = { flujo: { flujo_id, nombre, grafo_vivo }, desde: { nodoId, puerto, saltarEsperaInicial }, esDisparo, contacto: { telefono, nombre, alias, phoneId, temperatura, tieneVenta, estado, ultimoEntranteAt }, wamidEntrante, ultimoWamid, respuestas }`
  - Devuelve `{ camino, piezas, parada, salieron }`. **Orden fijo:** caminar → guardar/borrar estado → registrar pasos → temperatura → mandar piezas (en ese orden, para que un cliente que contesta mientras se manda ya encuentre su estado).

- [ ] **Step 1: Pruebas (RED)** — `tests/flujo-motor.test.js`:
```js
import test from 'node:test'
import assert from 'node:assert'
import { correrTanda } from '../lib/flujo-motor.js'

const D = (datos) => ({ id: 'd', tipo: 'disparador', pos: { x: 0, y: 0 }, datos })
const M = (id, datos) => ({ id, tipo: 'mensaje', pos: { x: 0, y: 0 }, datos: { origen: 'texto', texto: 'hola ' + id, adjuntos: [], botones: [], esperarRespuesta: false, citarUltimaRespuesta: false, temperatura: '', ...datos } })
const F = { id: 'f', tipo: 'fin', pos: { x: 0, y: 0 }, datos: {} }
const L = (de, a, puerto = 'siguiente', esperaMin = 0) => ({ id: `${de}-${puerto}-${a}`, de, puerto, a, esperaMin })
const contacto = { telefono: '593999000111', nombre: 'Ana', alias: '', phoneId: '1024077200794372', temperatura: '', tieneVenta: false, estado: 'pendiente', ultimoEntranteAt: '2026-09-15T09:00:00Z' }

function depsFalsas() {
  const reg = { enviadas: [], estado: null, borrados: 0, pasos: [], temps: [], avisos: [] }
  const deps = {
    enviar: async (p) => { reg.enviadas.push(p); return { ok: true } },
    guardarEstado: async (f) => { reg.estado = f },
    borrarEstado: async () => { reg.borrados++ },
    registrarPasos: async (a) => { reg.pasos.push(a) },
    setTemperatura: async (_t, temp) => { reg.temps.push(temp) },
    avisar: async (t) => { reg.avisos.push(t) },
    ahora: () => new Date('2026-09-15T10:00:00Z'),
    log: () => {},
  }
  return { deps, reg }
}

test('correrTanda: disparo lineal → manda las piezas citando el entrante, registra pasos, borra estado (no hay nada que esperar)', async () => {
  const { deps, reg } = depsFalsas()
  const grafo = { nodos: [D({ tipo: 'organico' }), M('a', { temperatura: 'caliente' }), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b'), L('b', 'f')] }
  const r = await correrTanda(deps, { flujo: { flujo_id: 'f1', nombre: 'X', grafo_vivo: grafo }, desde: { nodoId: 'd', puerto: 'siguiente' }, esDisparo: true, contacto, wamidEntrante: 'w-in', ultimoWamid: 'w-in', respuestas: [] })
  assert.equal(r.salieron, 2)
  assert.equal(reg.enviadas[0].ContextoId, 'w-in')
  assert.equal(reg.enviadas[1].ContextoId, undefined)
  assert.deepEqual(reg.pasos[0].nodoIds, ['a', 'b', 'f'])
  assert.deepEqual(reg.temps, ['caliente'])
  assert.equal(reg.estado, null)
  assert.equal(reg.borrados, 1)
})

test('correrTanda: se detiene en botones → guarda estado esperando boton hasta el fin de la ventana, ANTES de mandar', async () => {
  const { deps, reg } = depsFalsas()
  const orden = []
  deps.guardarEstado = async (f) => { orden.push('estado'); reg.estado = f }
  deps.enviar = async (p) => { orden.push('enviar'); reg.enviadas.push(p); return { ok: true } }
  const grafo = { nodos: [D({ tipo: 'organico' }), M('preg', { botones: [{ title: 'Sí' }, { title: 'No' }] }), F], lineas: [L('d', 'preg')] }
  await correrTanda(deps, { flujo: { flujo_id: 'f1', nombre: 'X', grafo_vivo: grafo }, desde: { nodoId: 'd', puerto: 'siguiente' }, esDisparo: true, contacto, wamidEntrante: 'w-in', ultimoWamid: 'w-in', respuestas: [] })
  assert.equal(orden[0], 'estado')
  assert.deepEqual(reg.estado, { telefono: '593999000111', flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', puerto_tiempo: null, vence_at: '2026-09-16T09:00:00.000Z', ultimo_wamid: 'w-in' })
  assert.equal(reg.enviadas[0].TipoMensaje, 'interactive_buttons')
})

test('correrTanda: espera en la línea → estado esperando tiempo con el puerto a seguir', async () => {
  const { deps, reg } = depsFalsas()
  const grafo = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'siguiente', 30), L('b', 'f')] }
  await correrTanda(deps, { flujo: { flujo_id: 'f1', nombre: 'X', grafo_vivo: grafo }, desde: { nodoId: 'd', puerto: 'siguiente' }, esDisparo: true, contacto, wamidEntrante: 'w-in', ultimoWamid: 'w-in', respuestas: [] })
  assert.equal(reg.estado.esperando, 'tiempo')
  assert.equal(reg.estado.puerto_tiempo, 'siguiente')
  assert.equal(reg.estado.vence_at, '2026-09-15T10:30:00.000Z')
})

test('correrTanda: la Condición se evalúa con el contacto y sigue por la rama que toca', async () => {
  const { deps, reg } = depsFalsas()
  const grafo = {
    nodos: [D({ tipo: 'organico' }), { id: 'c', tipo: 'condicion', pos: { x: 0, y: 0 }, datos: { campo: 'temperatura', valor: 'caliente' } }, M('si', {}), M('no', {}), F],
    lineas: [L('d', 'c'), L('c', 'si', 'si'), L('c', 'no', 'no'), L('si', 'f'), L('no', 'f')],
  }
  await correrTanda(deps, { flujo: { flujo_id: 'f1', nombre: 'X', grafo_vivo: grafo }, desde: { nodoId: 'd', puerto: 'siguiente' }, esDisparo: true, contacto: { ...contacto, temperatura: 'caliente' }, wamidEntrante: 'w', ultimoWamid: 'w', respuestas: [] })
  assert.equal(reg.enviadas[0].Mensaje, 'hola si')
})

test('correrTanda: reanudar tras un botón cita solo si el nodo lo pide; 0/N piezas avisa por Telegram', async () => {
  const { deps, reg } = depsFalsas()
  deps.enviar = async () => ({ ok: false, status: 500 })
  const grafo = { nodos: [D({ tipo: 'organico' }), M('preg', { botones: [{ title: 'Sí' }] }), M('r', { citarUltimaRespuesta: true }), F], lineas: [L('d', 'preg'), L('preg', 'r', 'btn_1'), L('r', 'f')] }
  const r = await correrTanda(deps, { flujo: { flujo_id: 'f1', nombre: 'X', grafo_vivo: grafo }, desde: { nodoId: 'preg', puerto: 'btn_1' }, esDisparo: false, contacto, wamidEntrante: 'w-tap', ultimoWamid: 'w-tap', respuestas: [] })
  assert.equal(r.piezas[0].ContextoId, 'w-tap')
  assert.equal(r.salieron, 0)
  assert.equal(reg.avisos.length, 1)
})

test('correrTanda: camino huérfano o sin piezas → no manda, borra estado, devuelve salieron 0', async () => {
  const { deps, reg } = depsFalsas()
  const grafo = { nodos: [D({ tipo: 'organico' }), F], lineas: [L('d', 'zzz')] }
  const r = await correrTanda(deps, { flujo: { flujo_id: 'f1', nombre: 'X', grafo_vivo: grafo }, desde: { nodoId: 'd', puerto: 'siguiente' }, esDisparo: true, contacto, wamidEntrante: 'w', ultimoWamid: 'w', respuestas: [] })
  assert.equal(r.salieron, 0)
  assert.equal(reg.enviadas.length, 0)
  assert.equal(reg.borrados, 1)
})
```
Run: `node --test tests/flujo-motor.test.js` → FAIL (módulo no existe).

- [ ] **Step 2: Implementar `lib/flujo-motor.js`**:
```js
// lib/flujo-motor.js — FLUJOS Fase B: correr UNA tanda de un flujo para un cliente.
// Lo llaman el webhook (al disparar y al avanzar con un entrante) y el cron
// /api/cron/flujos (esperas vencidas). Es el ÚNICO sitio que manda piezas de un
// flujo y escribe inbox.flujo_estado. Todas las dependencias con red/base entran
// por `deps` para poder probarlo sin ninguna de las dos (tests/flujo-motor.test.js).
//
// Orden FIJO dentro de una tanda: caminar → guardar/borrar el estado → registrar
// pasos → temperatura → mandar. El estado va ANTES del envío: si el cliente toca
// el botón mientras todavía estamos mandando la tanda, su entrante ya encuentra
// dónde está parado.
import { avanzarDesde, evaluarCondicion, paradaDeCamino, citaDeTanda, piezasDeNodos, temperaturaAlPasar } from './flujo.js'
import { filaDeEstado } from './flujos.js'

export async function correrTanda(deps, { flujo, desde, esDisparo, contacto, wamidEntrante = '', ultimoWamid = '', respuestas = [] }) {
  const { enviar, guardarEstado, borrarEstado, registrarPasos, setTemperatura, avisar, ahora, log = console.log } = deps
  const grafo = flujo?.grafo_vivo
  const ctx = { temperatura: contacto?.temperatura || '', tieneVenta: !!contacto?.tieneVenta, estado: contacto?.estado || '', ahora: ahora() }
  const camino = avanzarDesde(grafo, {
    nodoId: desde.nodoId, puerto: desde.puerto, saltarEsperaInicial: !!desde.saltarEsperaInicial,
    evaluar: (nodo) => evaluarCondicion(nodo, ctx),
  })

  const piezas = piezasDeNodos({
    nodos: camino.mensajes, respuestas,
    contacto: { telefono: contacto.telefono, nombre: contacto.nombre, alias: contacto.alias || '', phoneId: contacto.phoneId },
    citaId: citaDeTanda({ nodos: camino.mensajes, esDisparo, wamidEntrante, ultimoWamid }),
  })

  const parada = paradaDeCamino(camino, { ahora: ahora(), ultimoEntranteAt: contacto?.ultimoEntranteAt || null })
  if (camino.motivo === 'huerfano') log('[flujo]', flujo?.nombre, 'camino huérfano en', camino.detenidoEn, '→ se corta (el chat sigue en Pendientes)')

  // 1) estado: si el camino se detuvo en algo que espera → guardar; si terminó
  //    (fin/huérfano) → borrar. Nunca se deja un estado viejo colgado.
  if (parada && camino.motivo !== 'huerfano') {
    await guardarEstado(filaDeEstado(contacto.telefono, parada, { flujo_id: flujo.flujo_id, ultimoWamid: wamidEntrante || ultimoWamid }))
  } else {
    await borrarEstado(contacto.telefono)
  }
  // 2) bitácora (contadores por nodo)
  await registrarPasos({ telefono: contacto.telefono, flujo_id: flujo.flujo_id, nodoIds: camino.visitados })
    .catch((e) => log('[flujo] pasos:', e.message))
  // 3) temperatura del nodo ("si llegas hasta acá eres 🔥")
  const temp = temperaturaAlPasar(camino.mensajes)
  if (temp) await setTemperatura(contacto.telefono, temp).catch((e) => log('[flujo] temperatura:', e.message))
  // 4) mandar
  let salieron = 0
  for (const p of piezas) {
    const r = await enviar(p)
    if (r?.ok) salieron++
    else log('[flujo]', flujo?.nombre, 'pieza rechazada', r?.status ?? 'red', contacto.telefono)
  }
  log('[flujo]', flujo?.nombre, 'a', contacto.telefono, `${salieron}/${piezas.length} piezas`, `(${camino.motivo})`)
  if (piezas.length && salieron === 0) {
    await avisar(`⚠️ <b>Flujo sin enviar</b>\nflujo ${flujo?.nombre} a ${contacto.telefono}: 0/${piezas.length} piezas salieron. Revisa /api/saliente en los logs de Vercel.`).catch(() => {})
  }
  return { camino, piezas, parada, salieron }
}
```

- [ ] **Step 3: GREEN**

Run: `node --test tests/flujo-motor.test.js && npm test`
Expected: 6 nuevas en verde; todo lo demás igual.

- [ ] **Step 4: Commit**
```bash
git add lib/flujo-motor.js tests/flujo-motor.test.js
git commit -m "feat(flujos): correrTanda — el único sitio que manda piezas y escribe el estado por cliente"
```

---

### Task 5: Webhook — disparar con el motor nuevo, AVANZAR con cada entrante, cancelar con salientes humanos

**Files:**
- Modify: `app/api/webhook/route.js` (imports líneas 1-21; `flujoSiCorresponde` líneas ~323-395; loop principal líneas ~509-513; `procesarEchoes` líneas ~572-589)
- Modify: `app/api/saliente/route.js` (líneas ~415-420, bloque `if (!body.auto)`)
- Modify: `lib/contactos.js` (nada) — el borrado va por `lib/flujos.js`.
- Test: `tests/webhook-flujo-decision.test.js` (nuevo, prueba la decisión pura `decidirEntranteEnFlujo` que se agrega a `lib/flujo.js`)

**Interfaces:**
- Consumes: `correrTanda` (Task 4), `getEstadoFlujo`, `borrarEstadoFlujo`, `guardarEstadoFlujo`, `registrarPasos` (Task 3), `puertoDeEntrante` (Task 2), `enviarSaliente`, `enviarTelegram`, `updateTemperatura`, `marcarReceta` (existen).
- Produces: en `lib/flujo.js`, `decidirEntranteEnFlujo({ estado, flujo, entrante, ahora })` → `{ accion: 'seguir', desde: { nodoId, puerto } } | { accion: 'borrar', motivo } | { accion: 'ignorar', motivo }` (PURO).

- [ ] **Step 1: Prueba de la decisión (RED)** — `tests/webhook-flujo-decision.test.js`:
```js
import test from 'node:test'
import assert from 'node:assert'
import { decidirEntranteEnFlujo } from '../lib/flujo.js'

const M = (id, datos) => ({ id, tipo: 'mensaje', pos: { x: 0, y: 0 }, datos: { origen: 'texto', texto: 'x', adjuntos: [], botones: [], esperarRespuesta: false, citarUltimaRespuesta: false, temperatura: '', ...datos } })
const grafo = { nodos: [{ id: 'd', tipo: 'disparador', pos: { x: 0, y: 0 }, datos: { tipo: 'organico' } }, M('preg', { botones: [{ title: 'Sí' }] }), M('e', { esperarRespuesta: true })], lineas: [] }
const flujo = { flujo_id: 'f1', nombre: 'X', publicado: true, grafo_vivo: grafo }
const ahora = new Date('2026-09-15T10:00:00Z')
const vivo = '2026-09-16T09:00:00Z'

test('decidirEntranteEnFlujo: botón tocado → seguir por su puerto', () => {
  const r = decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', vence_at: vivo }, flujo, entrante: { botonId: 'rc_1', texto: 'Sí' }, ahora })
  assert.deepEqual(r, { accion: 'seguir', desde: { nodoId: 'preg', puerto: 'btn_1' } })
})
test('decidirEntranteEnFlujo: texto libre en botones → otra; esperando respuesta → respuesta', () => {
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', vence_at: vivo }, flujo, entrante: { botonId: '', texto: 'fotos' }, ahora }).desde.puerto, 'otra')
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'e', esperando: 'respuesta', vence_at: vivo }, flujo, entrante: { botonId: '', texto: 'Ana Pérez, Quito' }, ahora }).desde.puerto, 'respuesta')
})
test('decidirEntranteEnFlujo: esperando tiempo → ignorar (el cron sigue); vencido, flujo despublicado o nodo que ya no existe → borrar', () => {
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'tiempo', vence_at: vivo }, flujo, entrante: { botonId: '', texto: 'hola' }, ahora }).accion, 'ignorar')
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', vence_at: '2026-09-15T09:59:00Z' }, flujo, entrante: { botonId: 'rc_1', texto: 'Sí' }, ahora }).accion, 'borrar')
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', vence_at: vivo }, flujo: null, entrante: { botonId: 'rc_1', texto: 'Sí' }, ahora }).accion, 'borrar')
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'nope', esperando: 'boton', vence_at: vivo }, flujo, entrante: { botonId: 'rc_1', texto: 'Sí' }, ahora }).accion, 'borrar')
})
```
Run: `node --test tests/webhook-flujo-decision.test.js` → FAIL.

- [ ] **Step 2: Agregar a `lib/flujo.js`** (después de `puertoDeEntrante`):
```js
/**
 * Qué hacer con un entrante de un cliente que YA está dentro de un flujo.
 *  - 'seguir' + desde: avanzar desde el nodo donde está parado por el puerto que
 *    le toca a lo que mandó.
 *  - 'ignorar': está en una espera de reloj (la sigue el cron); su mensaje va a
 *    PENDIENTES como cualquier otro y una persona decide.
 *  - 'borrar': el estado ya no sirve (venció, el flujo se despublicó, el nodo ya
 *    no existe, o el nodo no espera nada).
 */
export function decidirEntranteEnFlujo({ estado, flujo, entrante, ahora }) {
  if (!estado) return { accion: 'ignorar', motivo: 'sin estado' }
  const vence = Date.parse(estado.vence_at)
  if (!Number.isFinite(vence) || vence <= ahora.getTime()) return { accion: 'borrar', motivo: 'vencido' }
  if (!flujo?.publicado || !flujo?.grafo_vivo) return { accion: 'borrar', motivo: 'flujo no publicado' }
  if (estado.esperando === 'tiempo') return { accion: 'ignorar', motivo: 'esperando tiempo' }
  const nodo = (flujo.grafo_vivo.nodos || []).filter(Boolean).find((n) => n.id === estado.nodo_id)
  if (!nodo) return { accion: 'borrar', motivo: 'nodo ya no existe' }
  const puerto = puertoDeEntrante(nodo, entrante)
  if (!puerto) return { accion: 'borrar', motivo: 'el nodo no espera nada' }
  return { accion: 'seguir', desde: { nodoId: estado.nodo_id, puerto } }
}
```
Run: `node --test tests/webhook-flujo-decision.test.js` → PASS.

- [ ] **Step 3: Webhook — imports** (línea 5 y nuevas):
```js
import { elegirFlujo, caminoLineal, decidirEntranteEnFlujo } from '@/lib/flujo'
import { correrTanda } from '@/lib/flujo-motor'
import { getEstadoFlujo, guardarEstadoFlujo, borrarEstadoFlujo, registrarPasos } from '@/lib/flujos'
```
(`piezasDeNodos` y `temperaturaAlPasar` dejan de importarse acá: los usa `correrTanda`.)

- [ ] **Step 4: Webhook — el motor.** Dentro de `procesar`, justo debajo de `flujosPublicados`, agregar el armado de `deps` y la función de AVANCE; y reescribir `flujoSiCorresponde` para que dispare con `correrTanda`:
```js
  // Las dependencias con red/base del motor de flujos (lib/flujo-motor.js), una
  // vez por ciclo. `enviar` va por /api/saliente con auto:true, como todo lo
  // automático (así NO reinicia el enfriamiento del push ni borra el estado).
  const depsFlujo = {
    enviar: (p) => enviarSaliente(origin, p),
    guardarEstado: guardarEstadoFlujo,
    borrarEstado: borrarEstadoFlujo,
    registrarPasos,
    setTemperatura: updateTemperatura,
    avisar: (texto) => enviarTelegram(texto.replace('<b>Flujo sin enviar</b>', `<b>Flujo sin enviar en ${esc(CUENTA)}</b>`)),
    ahora: () => new Date(),
    log: console.log,
  }
  const contactoParaFlujo = (m) => {
    const c = contactos.find(x => tail9(x.telefono) === tail9(m.telefono)) || null
    return {
      telefono: m.telefono, nombre: m.nombre, alias: c?.alias || '', phoneId: m.phoneId,
      temperatura: c?.temperatura || '', tieneVenta: !!c?.idVenta, estado: c?.estado || 'pendiente',
      // El snapshot es de ANTES de este mensaje: el último entrante es ESTE, ahora.
      ultimoEntranteAt: new Date().toISOString(),
    }
  }

  // ── Fase B: el cliente YA está dentro de un flujo → avanzar ──────────────
  // Corre ANTES de evaluar disparadores (el que está gana, spec §4B). Una sola
  // lectura por clave primaria y solo si hay flujos publicados en el ciclo.
  async function flujoEnCursoSiCorresponde(m) {
    if (!auto?.flujos?.activo) return false
    const flujos = await flujosPublicados()
    if (!flujos.length) return false
    const estado = await getEstadoFlujo(m.telefono).catch(e => { console.error('[/api/webhook] estado de flujo:', e.message); return null })
    if (!estado) return false
    const flujo = flujos.find(f => String(f.flujo_id) === String(estado.flujo_id)) || null
    const entrante = { botonId: m.raw?.interactive?.button_reply?.id || '', texto: m.raw?.type === 'text' || m.raw?.type === 'interactive' ? m.contenido : '' }
    const d = decidirEntranteEnFlujo({ estado, flujo, entrante, ahora: new Date() })
    if (d.accion === 'borrar') {
      console.log('[/api/webhook] flujo en curso se borra:', d.motivo, m.telefono)
      await borrarEstadoFlujo(m.telefono).catch(() => {})
      return false
    }
    if (d.accion === 'ignorar') return false
    // Si la IA tomó el chat mientras tanto, el flujo se retira.
    if (modoIAde(m.telefono, m.phoneId)) { await borrarEstadoFlujo(m.telefono).catch(() => {}); return false }
    const respuestas = await respuestasRapidas()
    const contacto = contactoParaFlujo(m)
    waitUntil(correrTanda(depsFlujo, {
      flujo, desde: d.desde, esDisparo: false, contacto,
      wamidEntrante: m.wamid, ultimoWamid: m.wamid, respuestas,
    }).catch(e => console.error('[/api/webhook] flujo en curso falló:', e.message)))
    return true
  }
```
Y en `flujoSiCorresponde`, reemplazar TODO lo que va desde `const camino = caminoLineal(flujo.grafo_vivo)` hasta el `return true` final por:
```js
    // Guardia de forma (sin red): un flujo cuyo camino arranca huérfano no se marca.
    if (caminoLineal(flujo.grafo_vivo).motivo === 'huerfano' && !caminoLineal(flujo.grafo_vivo).mensajes.length) {
      console.warn('[/api/webhook] flujo', flujo.nombre, 'arranca huérfano, no se marca', m.telefono)
      return false
    }
    const { marcado } = await marcarReceta(m.telefono).catch(e => { console.error('[/api/webhook] marcar flujo:', e.message); return { marcado: false } })
    if (!marcado) return false
    recetados.add(t)
    saludados.add(t)
    const respuestas = await respuestasRapidas()
    const contacto = contactoParaFlujo(m)
    const disparador = flujo.grafo_vivo.nodos.filter(Boolean).find(n => n.tipo === 'disparador')
    waitUntil(correrTanda(depsFlujo, {
      flujo, desde: { nodoId: disparador.id, puerto: 'siguiente' }, esDisparo: true, contacto,
      wamidEntrante: m.wamid, ultimoWamid: m.wamid, respuestas,
    }).catch(e => console.error('[/api/webhook] flujo tarea falló:', e.message)))
    return true
```
(Se van de `flujoSiCorresponde`: `piezasDeNodos`, `temperaturaAlPasar`, el `for` de envío y la alarma; todo eso vive ahora en `correrTanda`.)

- [ ] **Step 5: Webhook — loop principal** (línea ~509): el avance va primero:
```js
    let conReceta = await flujoEnCursoSiCorresponde(m)
      .catch(e => { console.error('[/api/webhook] flujo en curso:', e.message); return false })
    if (!conReceta) {
      conReceta = await flujoSiCorresponde(m)
        .catch(e => { console.error('[/api/webhook] flujo:', e.message); return false })
    }
    if (!conReceta && auto?.recetas?.activo) {
      conReceta = await recetaSiCorresponde(m)
        .catch(e => { console.error('[/api/webhook] receta:', e.message); return false })
    }
```

- [ ] **Step 6: Salientes humanos cancelan el flujo.**
  - `app/api/saliente/route.js`, dentro del `if (!body.auto) { ... }` existente (línea ~418), agregar después de `limpiarPush`:
```js
      // Una persona contestó: el flujo automático de ese cliente se retira (spec §1:
      // "cualquier mensaje humano cancela el flujo"). Las piezas del propio flujo
      // vienen con auto:true y no pasan por acá.
      await borrarEstadoFlujo(telSal)
        .catch(e => console.error('[/api/saliente] borrar estado de flujo:', e.message))
```
  con `import { borrarEstadoFlujo } from '@/lib/flujos'` arriba.
  - `app/api/webhook/route.js`, en `procesarEchoes`, después de `guardarMensajeSupabase(...)`: el eco es un saliente escrito desde el CELULAR (coexistencia) — también es una persona:
```js
      // Escrito desde el celular = una persona contestó → se retira el flujo.
      await borrarEstadoFlujo(e.telefono).catch(() => {})
```

- [ ] **Step 7: `npm test` en verde, commit, push, verificar el deploy con el sha**
```bash
git add lib/flujo.js tests/webhook-flujo-decision.test.js app/api/webhook/route.js app/api/saliente/route.js
git commit -m "feat(flujos): el webhook avanza el flujo con cada entrante y los salientes humanos lo cancelan (Fase B)"
git push origin main
```
Después: `vercel ls --prod` → el deploy más nuevo `● Ready`, y confirmar el sha con la API (`curl -s https://api.vercel.com/v13/deployments/<url> -H "Authorization: Bearer <token de ~/AppData/Roaming/xdg.data/com.vercel.cli/auth.json>" | python -c "import sys,json;print(json.load(sys.stdin)['meta']['githubCommitSha'][:7])"` = `git rev-parse --short HEAD`).

- [ ] **Step 8: Control en la base tras el deploy** (con un flujo de prueba publicado con botones y un número de prueba — ver Task 9):
```sql
select telefono, nodo_id, esperando, vence_at, ultimo_wamid from inbox.flujo_estado where cuenta='MANDI';
select nodo_id, count(*) from inbox.flujo_pasos where cuenta='MANDI' group by 1;
```

---

### Task 6: Cron `/api/cron/flujos` — esperas vencidas (cada 5 min)

**Files:**
- Create: `app/api/cron/flujos/route.js`
- Modify: `vercel.json` (crons), `lib/rutas-publicas.js` (lista), `middleware.js` (matcher línea ~113)
- Test: `tests/rutas-publicas.test.js` ya exige los 3 lugares; sumar `'/api/cron/flujos'` a la lista PÚBLICAS de la prueba (línea ~12) y una prueba pura nueva en `tests/flujo.test.js` para `decidirVencido`.

**Interfaces:**
- Produces en `lib/flujo.js`: `decidirVencido({ estado, flujo, contacto, ahora })` → `{ accion: 'seguir', desde: { nodoId, puerto, saltarEsperaInicial: true } } | { accion: 'borrar', motivo }` (PURO).
- Consumes: `getEstadosVencidos`, `borrarEstadosCaducados`, `borrarEstadoFlujo`, `guardarEstadoFlujo`, `registrarPasos` (Task 3), `correrTanda` (Task 4), `getFlujosPublicadosSupabase`, `getContactos(null)`, `getRespuestas`, `enviarSaliente`, `enviarTelegram`, `updateTemperatura`, `getAutomatizaciones`.

- [ ] **Step 1: Prueba (RED)** — al final de `tests/flujo.test.js` (sumar `decidirVencido` al import):
```js
test('decidirVencido: ventana abierta y flujo vivo → seguir saltando la espera; ventana cerrada / despublicado / nodo perdido → borrar', () => {
  const ahora = new Date('2026-09-15T12:00:00Z')
  const estado = { flujo_id: 'f1', nodo_id: 'a', esperando: 'tiempo', puerto_tiempo: 'siguiente', vence_at: '2026-09-15T11:59:00Z' }
  const flujo = { flujo_id: 'f1', nombre: 'X', publicado: true, grafo_vivo: conEspera }
  assert.deepEqual(decidirVencido({ estado, flujo, contacto: { ultimoEntranteAt: '2026-09-15T09:00:00Z' }, ahora }), { accion: 'seguir', desde: { nodoId: 'a', puerto: 'siguiente', saltarEsperaInicial: true } })
  assert.equal(decidirVencido({ estado, flujo, contacto: { ultimoEntranteAt: '2026-09-14T11:00:00Z' }, ahora }).accion, 'borrar')
  assert.equal(decidirVencido({ estado, flujo: null, contacto: { ultimoEntranteAt: '2026-09-15T09:00:00Z' }, ahora }).accion, 'borrar')
  assert.equal(decidirVencido({ estado: { ...estado, nodo_id: 'zzz' }, flujo, contacto: { ultimoEntranteAt: '2026-09-15T09:00:00Z' }, ahora }).accion, 'borrar')
  assert.equal(decidirVencido({ estado, flujo, contacto: null, ahora }).accion, 'borrar')
})
```

- [ ] **Step 2: Implementar `decidirVencido` en `lib/flujo.js`** (después de `decidirEntranteEnFlujo`):
```js
/** Una espera de reloj que ya se cumplió: ¿se sigue o se borra? Nunca fuera de la ventana de 24 h. */
export function decidirVencido({ estado, flujo, contacto, ahora }) {
  if (!ventanaAbierta(contacto?.ultimoEntranteAt || null, ahora)) return { accion: 'borrar', motivo: 'ventana cerrada' }
  if (!flujo?.publicado || !flujo?.grafo_vivo) return { accion: 'borrar', motivo: 'flujo no publicado' }
  const nodo = (flujo.grafo_vivo.nodos || []).filter(Boolean).find((n) => n.id === estado?.nodo_id)
  if (!nodo || !estado?.puerto_tiempo) return { accion: 'borrar', motivo: 'nodo o puerto perdido' }
  return { accion: 'seguir', desde: { nodoId: estado.nodo_id, puerto: estado.puerto_tiempo, saltarEsperaInicial: true } }
}
```

- [ ] **Step 3: La ruta `app/api/cron/flujos/route.js`**:
```js
import { NextResponse } from 'next/server'
import { getContactos, updateTemperatura } from '@/lib/contactos'
import { getAutomatizaciones } from '@/lib/automatizaciones'
import { getRespuestas } from '@/lib/respuestas'
import { getFlujosPublicadosSupabase } from '@/lib/inbox-supabase'
import { getEstadosVencidos, borrarEstadosCaducados, borrarEstadoFlujo, guardarEstadoFlujo, registrarPasos } from '@/lib/flujos'
import { decidirVencido } from '@/lib/flujo'
import { correrTanda } from '@/lib/flujo-motor'
import { enviarSaliente } from '@/lib/responder-ia'
import { enviarTelegram } from '@/lib/telegram'
import { CUENTA } from '@/lib/supabase'

// Cron de FLUJOS (Fase B): sigue las esperas en las líneas que ya se cumplieron
// y limpia los estados que caducaron sin respuesta. Cada 5 min (vercel.json).
//
// ⚠️ Está en los TRES lugares (vercel.json, lib/rutas-publicas.js, matcher de
// middleware.js): un cron detrás del candado da 401 igual que uno vivo y no
// corre nunca. tests/rutas-publicas.test.js lo exige.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const tail9 = (s) => String(s || '').replace(/\D/g, '').replace(/^593/, '').replace(/^0+/, '').slice(-9)

function autorizado(req) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isVercelCron = req.headers.get('x-vercel-cron') != null
  const keyQ = new URL(req.url).searchParams.get('key')
  if (isVercelCron) return true
  if (secret && (auth === `Bearer ${secret}` || keyQ === secret)) return true
  return false
}

export async function GET(req) {
  if (!autorizado(req)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })

  const cfg = await getAutomatizaciones().catch(() => null)
  if (!cfg?.flujos?.activo) return NextResponse.json({ ok: true, skipped: 'flujos apagados (interruptor general)' })

  const origin = new URL(req.url).origin
  const ahora = new Date()
  const caducados = await borrarEstadosCaducados(ahora.toISOString()).catch(e => ({ borrados: -1, error: e.message }))
  const vencidos = await getEstadosVencidos(ahora.toISOString()).catch(() => [])
  if (!vencidos.length) return NextResponse.json({ ok: true, vencidos: 0, caducados: caducados.borrados })

  const flujos = await getFlujosPublicadosSupabase().catch(() => [])
  const contactos = await getContactos(null).catch(() => [])
  const respuestas = await getRespuestas().catch(() => [])
  const deps = {
    enviar: (p) => enviarSaliente(origin, p),
    guardarEstado: guardarEstadoFlujo, borrarEstado: borrarEstadoFlujo, registrarPasos,
    setTemperatura: updateTemperatura,
    avisar: (texto) => enviarTelegram(texto.replace('<b>Flujo sin enviar</b>', `<b>Flujo sin enviar en ${CUENTA}</b>`)),
    ahora: () => new Date(), log: console.log,
  }

  const seguidos = []
  const borrados = []
  for (const estado of vencidos) {
    const flujo = flujos.find(f => String(f.flujo_id) === String(estado.flujo_id)) || null
    const c = contactos.find(x => tail9(x.telefono) === tail9(estado.telefono)) || null
    const d = decidirVencido({ estado, flujo, contacto: c, ahora })
    if (d.accion === 'borrar') {
      await borrarEstadoFlujo(estado.telefono).catch(() => {})
      borrados.push({ telefono: estado.telefono, motivo: d.motivo })
      continue
    }
    try {
      const r = await correrTanda(deps, {
        flujo, desde: d.desde, esDisparo: false,
        contacto: { telefono: c.telefono, nombre: c.nombre, alias: c.alias || '', phoneId: c.phoneId, temperatura: c.temperatura, tieneVenta: !!c.idVenta, estado: c.estado, ultimoEntranteAt: c.ultimoEntranteAt },
        wamidEntrante: '', ultimoWamid: estado.ultimo_wamid || '', respuestas,
      })
      seguidos.push({ telefono: estado.telefono, piezas: `${r.salieron}/${r.piezas.length}`, motivo: r.camino.motivo })
    } catch (e) {
      console.error('[/api/cron/flujos]', estado.telefono, e.message)
      borrados.push({ telefono: estado.telefono, motivo: 'error: ' + e.message })
      await borrarEstadoFlujo(estado.telefono).catch(() => {})
    }
  }
  console.log('[/api/cron/flujos]', `vencidos ${vencidos.length} · seguidos ${seguidos.length} · borrados ${borrados.length} · caducados ${caducados.borrados}`)
  return NextResponse.json({ ok: true, vencidos: vencidos.length, seguidos, borrados, caducados: caducados.borrados })
}
```
Nota: `c.phoneId` es el canal por el que habla ese cliente (`toContacto` en `inbox-supabase.js`). Si `c` fuera null, `decidirVencido` ya devolvió `borrar` (ventana cerrada), así que acá `c` siempre existe.

- [ ] **Step 4: Los tres lugares**
  - `vercel.json`: agregar `{ "path": "/api/cron/flujos", "schedule": "*/5 * * * *" }` a `crons`.
  - `lib/rutas-publicas.js`: agregar `'/api/cron/flujos',` a `RUTAS_PUBLICAS` con el comentario `// esperas de los FLUJOS (Fase B), cada 5 min`; y sumar la línea `//   /api/cron/flujos      → CRON_SECRET` al bloque de arriba.
  - `middleware.js`: en el matcher, `...|api/cron/pagos|api/cron/flujos|api/pago-dlocal|...`.
  - `tests/rutas-publicas.test.js` línea ~12-16: agregar `'/api/cron/flujos',       // cron de Vercel, cada 5 min — esperas de los flujos` a la lista PÚBLICAS.

- [ ] **Step 5: GREEN, commit, push, verificar que el cron VIVE**
```bash
npm test
git add app/api/cron/flujos/route.js vercel.json lib/rutas-publicas.js middleware.js tests/rutas-publicas.test.js lib/flujo.js tests/flujo.test.js
git commit -m "feat(flujos): cron cada 5 min que sigue las esperas vencidas y limpia los estados caducados"
git push origin main
```
Tras el deploy (sha verificado): `curl -s "https://inbox.apps.mandarinaec.com/api/cron/flujos?key=<CRON_SECRET>"` → `{"ok":true,"vencidos":0,...}`. ☠️ Mirar el CUERPO: `{"error":"sin-sesion"}` = el candado lo atrapó (falta en middleware/rutas) · `{"error":"no autorizado"}` = la ruta vive y la clave está mal. Sin la clave: `401` con `no autorizado`.

---

### Task 7: El lienzo — quitar "corre desde la Fase B" y mostrar contadores por nodo

**Files:**
- Modify: `components/flujos/nodos.jsx` (borrar `EtiquetaFaseB` líneas ~63-71 y sus usos; `CtxLienzo` línea 21 suma `pasos`; el armazón común muestra el contador)
- Modify: `components/flujos/PanelEdicion.jsx` (borrar el aviso "las esperas corren desde la Fase B", líneas ~326-328)
- Modify: `components/flujos/Flujos.jsx` (cargar `pasos` al abrir un flujo; `ctx` línea ~549 los pasa)
- Create: `app/api/flujos/pasos/route.js` (GET, detrás del login)
- Modify: `lib/api-client.js` (línea ~838, bloque FLUJOS: sumar `getPasosFlujo`)
- Modify: `tests/rutas-publicas.test.js` (línea 21: sumar `'/api/flujos/pasos'` a PROTEGIDAS)

**Interfaces:**
- Produces: `GET /api/flujos/pasos?flujo_id=&dias=30` → `{ ok, porNodo: { [nodoId]: n }, dias }`; `getPasosFlujo(flujo_id)` en `lib/api-client.js` → mismo objeto o `{ ok:false, porNodo:{} }`.
- Consumes: `contarPasos(flujo_id, desdeIso)` (Task 3).

- [ ] **Step 1: Ruta `app/api/flujos/pasos/route.js`** (mismo estilo que `app/api/flujos/route.js`: mirar cómo lee query y responde):
```js
import { NextResponse } from 'next/server'
import { contarPasos } from '@/lib/flujos'

export const dynamic = 'force-dynamic'

// Contadores por nodo: clientes DISTINTOS que pasaron por cada nodo en los
// últimos `dias` (30 por defecto). Detrás del login como todo /api/flujos.
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const flujo_id = String(searchParams.get('flujo_id') || '').trim()
  const dias = Math.min(365, Math.max(1, Number(searchParams.get('dias')) || 30))
  if (!flujo_id) return NextResponse.json({ ok: false, error: 'falta flujo_id' }, { status: 400 })
  try {
    const desde = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString()
    const porNodo = await contarPasos(flujo_id, desde)
    return NextResponse.json({ ok: true, porNodo, dias })
  } catch (e) {
    console.error('[/api/flujos/pasos]', e.message)
    return NextResponse.json({ ok: false, error: e.message, porNodo: {} }, { status: 500 })
  }
}
```
Y en `tests/rutas-publicas.test.js` línea 21 sumar `'/api/flujos/pasos'` a la lista PROTEGIDAS. `npm test` → verde.

- [ ] **Step 2: `lib/api-client.js`** (junto a `getFlujos`, misma forma con `cache: 'no-store'` y `t=Date.now()`):
```js
export async function getPasosFlujo(flujo_id, dias = 30) {
  try {
    const res = await fetch(`/api/flujos/pasos?flujo_id=${encodeURIComponent(flujo_id)}&dias=${dias}&t=${Date.now()}`, { cache: 'no-store' })
    return await res.json()
  } catch {
    return { ok: false, porNodo: {} }
  }
}
```

- [ ] **Step 3: `Flujos.jsx`** — estado `const [pasos, setPasos] = useState({})`; en el `useEffect` que se dispara al cambiar el flujo abierto (`actual?.flujo_id`, cerca de la línea 183), cargar `getPasosFlujo(actual.flujo_id).then(r => setPasos(r?.porNodo || {}))` y `setPasos({})` si no hay flujo; en `ctx` (línea ~549, el `useMemo` que arma el valor del Provider) sumar `pasos`. Importar `getPasosFlujo` en la línea 22.

- [ ] **Step 4: `nodos.jsx`** — línea 21: `createContext({ erroresPorNodo: {}, respuestas: [], anuncios: [], pasos: {} })`. Borrar `EtiquetaFaseB` y TODOS sus `<EtiquetaFaseB />` (en `NodoMensaje` cuando `faseB`, y en Condición); borrar la variable `faseB` si queda sin uso. En el armazón común (la función que recibe `nodo` y pinta título + puertos, línea ~75), leer `const { erroresPorNodo, pasos } = useContext(CtxLienzo)` y, debajo del título, si `pasos[id] > 0`:
```jsx
<div title="clientes distintos que pasaron por acá en los últimos 30 días"
  style={{ fontSize: 9, fontWeight: 800, color: '#a78bfa', marginTop: 2 }}>👤 {pasos[id]}</div>
```
(el `id` del nodo llega por props de React Flow a cada nodo: ver cómo `NodoMensaje({ id, data, selected })` lo recibe y pasarlo al armazón).

- [ ] **Step 5: `PanelEdicion.jsx`** — borrar el `<div>` "las esperas corren desde la Fase B" (líneas ~326-328). Nada más cambia.

- [ ] **Step 6: Verificar en el navegador y commit** — `npm run dev`, abrir FLUJOS, un flujo publicado con pasos: se ve `👤 N` en los nodos por los que pasó alguien; los nodos con botones ya no dicen "corre desde la Fase B".
```bash
npm test
git add app/api/flujos/pasos/route.js lib/api-client.js components/flujos/Flujos.jsx components/flujos/nodos.jsx components/flujos/PanelEdicion.jsx tests/rutas-publicas.test.js
git commit -m "feat(flujos): contadores por nodo en el lienzo; fuera las notas de 'corre desde la Fase B'"
git push origin main
```

---

### Task 8: Retirar el motor de recetas

⚠️ **Precondición (controlador):** solo se ejecuta cuando Rodrigo YA importó las recetas. Control:
```sql
select (select count(*) from inbox.flujos where cuenta='MANDI') flujos,
       (select config->'recetas'->>'activo' from inbox.automatizaciones where cuenta='MANDI') recetas_activo;
```
Si `recetas_activo` es `true` o `flujos` es 0 → **NO hacer esta tarea**; dejar el commit para otra sesión y decirlo en el reporte.

**Files:**
- Modify: `app/api/webhook/route.js` (borrar `recetaSiCorresponde` entero, líneas ~243-297, y su llamada en el loop; borrar `decidirReceta, piezasDeReceta` del import de `@/lib/recetas` — quedan `textoAvisoAnuncioNuevo, esc`)
- Modify: `components/Automatizaciones.jsx` (borrar el bloque del interruptor de recetas "solo tiene sentido mientras quede algo por importar", líneas ~400-430, y `togRcG`)
- Modify: `lib/recetas.js` — NO se borra: `pieza`, `interactivo`, `normalizarBotones`, `MAX_*`, `textoAvisoAnuncioNuevo`, `esc` los usan `flujo.js` y el webhook. Se borran solo `decidirReceta` y `piezasDeReceta` si ninguna prueba las usa (mirar `tests/recetas.test.js`: si las prueba, se dejan con un comentario `// retirado del webhook el <fecha>; queda por la importación`).
- Modify: `lib/flujos.js` `importarRecetas` sigue (es la conversión única) y `lib/automatizaciones.js` `DEFAULTS.recetas` sigue (config vieja en la base).

- [ ] **Step 1:** hacer los borrados, `npm test` en verde (ajustar `tests/recetas.test.js` solo si prueba funciones borradas: entonces se dejan las funciones).
- [ ] **Step 2: Commit + push + sha**
```bash
git add app/api/webhook/route.js components/Automatizaciones.jsx lib/recetas.js
git commit -m "refactor(flujos): el webhook ya no corre recetas; el motor de flujos las reemplaza"
git push origin main
```

---

### Task 9: Documentación, memoria y prueba real

**Files:**
- Create: `docs/HANDOFF-2026-09-XX-flujos-fase-b.md` (fecha real del día)
- Modify: `docs/HANDOFF-2026-09-15-flujos-fase-a.md` (una línea arriba: "⚠️ superado por HANDOFF-…-fase-b")
- Modify: memoria de Claude `inbox-flujos-lienzo.md` + línea del índice.
- Modify: skill `inbox-mandarina` (3 copias: `wa-inbox-next/.claude/skills/`, `ind-inbox-next/.claude/skills/`, `~/.claude/skills/`) — una trampa nueva: **"un cliente que contesta un flujo llega como `tipo:'texto'`; el id del botón está en `raw.interactive.button_reply.id`"**.

- [ ] **Step 1: Handoff** con: qué corre ahora (tabla como la del handoff A, todo en "sí"), dónde vive cada cosa (`lib/flujo-motor.js`, `flujo_estado`, `flujo_pasos`, cron), controles SQL:
```sql
select telefono, nodo_id, esperando, puerto_tiempo, vence_at from inbox.flujo_estado where cuenta='MANDI' order by actualizado_at desc;
select f.nombre, p.nodo_id, count(distinct p.telefono) clientes from inbox.flujo_pasos p join inbox.flujos f using (flujo_id) where p.cuenta='MANDI' and p.pasado_at > now() - interval '7 days' group by 1,2 order by 1,3 desc;
```
y logs: `[flujo] <nombre> a <tel> N/M piezas (motivo)` · `[/api/cron/flujos] vencidos … seguidos … borrados …`.

- [ ] **Step 2: Prueba real (Rodrigo + controlador)**
  1. En FLUJOS: flujo "PRUEBA B" con Disparador **palabra** `pruebaflujo` → Mensaje con botones "Sí"/"No" → [Sí] Mensaje "Perfecto 🧡" ─(espera 2 min)→ Mensaje "¿Sigues ahí?" (citar última respuesta) → Fin · [No] Mensaje "Listo" → Fin · [otra] Condición hora 09:00-20:00 → [si] "Te escribo ya" / [no] "Mañana te escribo" → Fin. Publicar.
  2. Desde un número que NO tenga un mensaje nuestro en las últimas 24 h, escribir `pruebaflujo` → llega la pregunta con botones citando el mensaje. SQL: una fila `esperando='boton'`.
  3. Tocar **Sí** → llega "Perfecto 🧡"; SQL: `esperando='tiempo'`, `vence_at` a +2 min. Esperar ≤7 min → llega "¿Sigues ahí?" citando el "Sí". SQL: la fila desapareció; `flujo_pasos` tiene los nodos.
  4. Repetir con otro número escribiendo texto libre en vez de tocar → entra por "otra" y la Condición de hora elige la rama.
  5. Repetir y, en la espera, contestarle a mano desde el inbox → SQL: la fila desapareció (el cron no manda nada después).
  6. Despublicar "PRUEBA B".

- [ ] **Step 3: Memoria y skill** actualizadas; commit de docs:
```bash
git add docs/HANDOFF-2026-09-XX-flujos-fase-b.md docs/HANDOFF-2026-09-15-flujos-fase-a.md .claude/skills/inbox-mandarina/SKILL.md
git commit -m "docs(flujos): handoff de la Fase B y trampa del botón tocado en la skill"
git push origin main
```

---

## Self-review

- **Cobertura de la spec §4 Fase B:** estado al detenerse → Task 4 (`correrTanda` + `paradaDeCamino`) · avanzar con el entrante antes de los disparadores → Task 5 (`flujoEnCursoSiCorresponde`, `decidirEntranteEnFlujo`) · citar última respuesta → Task 2 (`citaDeTanda`) · cron de esperas con ventana → Task 6 · saliente humano borra estado → Task 5 Step 6 (inbox + celular) · Condición al pasar → Task 2 (`evaluarCondicion`) + Task 4 · el que está gana → Task 5 Step 5 (orden del loop) · contadores por nodo → Tasks 1, 3, 7 · retirar recetas → Task 8. §3 tabla → Task 1 (más `flujo_pasos`). §8 "cliente atrapado" → `vence_at` + `borrarEstadosCaducados` (Task 6) + saliente humano.
- **Tipos:** `parada = { esperando, nodoId, puertoTiempo, venceAt }` (Task 2) → `filaDeEstado` (Task 3) → fila `{ telefono, flujo_id, nodo_id, esperando, puerto_tiempo, vence_at, ultimo_wamid }` (Tasks 3, 4, 5, 6). `desde = { nodoId, puerto, saltarEsperaInicial? }` en `avanzarDesde`, `decidirEntranteEnFlujo`, `decidirVencido`, `correrTanda`. `contacto` del motor = `{ telefono, nombre, alias, phoneId, temperatura, tieneVenta, estado, ultimoEntranteAt }` en Tasks 4, 5 (`contactoParaFlujo`) y 6. `deps` del motor idénticas en Task 5 y Task 6.
- **Decisiones que no están en la spec y se tomaron acá:** el cron es cada **5 min** (una espera de 10 min con cron horario no tiene sentido; están en Vercel Pro); un entrante durante una espera de reloj **no cancela** el flujo (va a PENDIENTES; si una persona contesta, eso sí lo cancela); `vence_at` de una espera de reloj es exacto y la ventana se comprueba al vencer (`ventanaAbierta`, margen 5 min) en vez de guardar el mínimo; **escribir el título del botón** cuenta como tocarlo.
- **Fuera de este plan:** port a IND (plan aparte, mismo código), plantillas fuera de la ventana, "comenzar otro flujo".
