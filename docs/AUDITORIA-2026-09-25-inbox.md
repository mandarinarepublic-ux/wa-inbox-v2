# Auditoría del inbox MANDI — 25-sep-2026

Cuatro auditorías de solo lectura, hechas el día en que REPUBLIC pasó a Cloud API pura
(phone_id `1367772133078101`, en la misma WABA que MANDI `1250794910496982`). Con los dos
números vivos otra vez aparecieron bugs que llevaban semanas escondidos.

## Ya arreglado ese mismo día

| Commit | Qué |
|---|---|
| `ace4cc5` | Push en GENERAL ya no cambia de pestaña · `?tel=` se consume una vez · respuesta de sync atrasada se descarta · ◉ de GENERAL marca el número del chat · aviso de versión nueva |
| `7b53b9d` | Solo se recuerda la pestaña elegida con clic (un push de REPUBLIC dejaba la app arrancando en REPUBLIC) |
| `9d7ffc2` | Volver de CONTACTOS/AUTOS/SOCIAL/FLUJOS a un número suelta el chat (se veía el hilo de MANDI y salía por REPUBLIC) · `/api/saliente` responde 409 con un `Canal` desconocido en vez de mandar por MANDI |

## Pendiente, por gravedad

### 🚨 Seguridad
1. **Repo PÚBLICO con `META_TOKEN` en el historial** (commits `2db099e` 5-jul y `fb32928` 9-jul). Pasar a privado y revocar el token.
2. **El webhook no exige la firma de Meta** (`lib/firma-meta.js` solo observa). En 6 h de logs: 100 % `[firma] coincide` → exigirla es seguro (401 solo en `NO-coincide`/`sin-cabecera`).
3. **`/api/media?url=` manda el `META_TOKEN` a cualquier dominio.** Lista blanca de hosts de Meta.
4. **`/api/admin/meta-waba` y `conectar-whatsapp`**: acciones que escriben van por GET y no exigen rol admin → POST + `rol === 'admin'`.

### Número equivocado / estado equivocado
5. **`changeStatus` lee el canal DESPUÉS del `await` del envío** (`App.jsx` ~1604): enviar en GENERAL y abrir otro chat antes de que termine marca ATENDIDO la fila del otro número. Congelar el canal al encolar.
6. **Burbuja optimista y `pendingRef` van solo por teléfono**: en GENERAL el mensaje aparece en las dos filas de la persona hasta 90 s (47 personas en los dos números).
7. **La lista se pide por `CANAL_ACTIVO` (canal de ENVÍO) y no por la pestaña**; el guardia de `ace4cc5` compara contra `CANAL_ACTIVO` → legitima una desalineación. Pedir por `phoneIdDeCanal(linea)`.
8. **El pedido de un push no caduca**: si el cliente no está en la lista, horas después te cambia de chat (con borrador escrito). Guardar `{tel, phoneId, at}` con caducidad y mandar `phoneId` en el push.
9. **Plantilla desde el chat** sale por `CANAL_ACTIVO`, no por el canal del chat.
10. **Subida de fotos (`/api/media/upload`) y confirmación de dLocal usan siempre MANDI.**

### Datos que no se ven o se ven viejos
11. **Fotos: 266 errores 502 en 6 h.** `MediaContent` (`Components.jsx:425`) pide a Meta aunque exista `media_url` archivada (5.974/6.021 en MANDI, 877/898 en REPUBLIC). Usar `media_url` primero; 404 cacheable para lo perdido.
12. **La "ventana de 3000" es de 1000** (PostgREST): 44 h / 80 teléfonos hoy.
13. **La lista tiene tope 4000** y va en 2.518 creciendo ~620/mes → se llena a mediados de diciembre y los chats viejos desaparecen de GENERAL.
14. **`getConversacionSupabase` (historial de la IA) sin paginar** → llegan los 1000 más viejos.
15. **`load()` sin número de secuencia**: una respuesta vieja pisa una nueva y hace retroceder el ETag.
16. **"Sync hh:mm:ss" miente**: se actualiza aunque el fetch falle.
17. **Aviso de versión no llega con el inbox quieto** (el 304 no trae `build`).

### Ceguera operativa
18. **`account_update`, calidad y plantillas se guardan pero nadie avisa** — así pasaron semanas sin ver la caída de REPUBLIC y del 9804.
19. **El webhook responde 200 aunque falle el guardado** → si Supabase se cae, Meta no reintenta.
20. Falta un **cron de salud** (Telegram): número sin entrantes X h, picos de fallidos por código, `account_update`, token por vencer, crons que no corren. Consulta base probada en el informe del agente.

### Proceso (por qué las revisiones no lo cazan)
- `components/` tiene **0 %** de cobertura; `App.jsx` (3.297 líneas, 28 `useEffect`) no lo ejecuta ninguna prueba. De 23 `fix` sobre `App.jsx`, 5 traen prueba.
- **Sin CI, sin pre-commit**; el lint no corre en Vercel. `react-hooks/exhaustive-deps` apagada en todo el proyecto.
- El canal vive en 4-5 lugares escritos por separado (`linea`, `CANAL_ACTIVO`, `canalArmado`, `activeCanal`, localStorage) y cada capa tiene un respaldo silencioso a MANDI.
- **IND tiene los mismos bugs de hoy** (`?tel=`, pestaña guardada en saltos automáticos, sin aviso de versión).

## Plan
- **P0 (medio día):** CI en GitHub Actions (`npm test` + lint) · pre-commit `.githooks` · `exhaustive-deps` en `warn` para `components/`.
- **P1:** sacar la máquina pestaña/canal a `lib/navegacion.js` (reducer puro) + `lib/merge-sync.js`, con los 12 escenarios (persona en los dos números, push en GENERAL, cambio de pestaña con sync en vuelo, recarga, bundle viejo…). Regla: mutar el arreglo y ver que una prueba muerde.
- **P1:** checklist de revisión (de dónde sale el canal · qué se lee tras un `await` · qué se persiste · ¿se portó a IND? · ¿qué prueba falla si lo reviertes?) para todo fix en `App.jsx`/`api-client`/`canales`/`saliente`.
- **P2:** Playwright con `/api/*` simulado (no hace falta modo demo) · portar a IND.
- **P3:** cron de salud + alertas de `account_update`.
