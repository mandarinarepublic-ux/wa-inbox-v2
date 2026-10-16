# HANDOFF 16-oct-2026 — Archivos de diseño (.ai/.psd/.eps) que no se podían descargar

Aplicado en **los dos inbox** (IND y MANDI). Este archivo está igual en `ind-inbox-next/docs/` y `wa-inbox-next/docs/`.

## El síntoma
"Me envían archivos de Illustrator y no puedo descargarlos" (IND).

## Las causas (eran tres)

1. **El nombre se perdía.** Meta manda .ai y .eps como `application/postscript`. Ese MIME no estaba en la tabla de `lib/media-archive.js` y se archivaban como `wamid.HBgM….bin` (en MANDI, `.postscript`). El botón "Documento adjunto" abría esa URL tal cual y el navegador bajaba un `.bin` sin nombre que Windows no sabe abrir. **El archivo sí estaba completo:** `Conejo.ai`, 1,4 MB.
2. **El bucket rechazaba el tipo.** `inbox-media` tiene lista de MIMEs permitidos. Un .psd (`image/vnd.adobe.photoshop`) o una fuente (`application/font-sfnt`) no se archivaban y quedaban colgando del `media_id`, que Meta borra a los ~30 días.
3. **El bucket tenía tope de 25 MB.** Los .psd pesan más. Ojo: WhatsApp acepta documentos de hasta 100 MB.

## Hecho (producción, los dos repos)

| IND | MANDI | Qué |
|---|---|---|
| `657df15` | `996b2b8` | `lib/descarga.js` nuevo: el botón descarga con el **nombre original** (`?download=<nombre>` de Supabase Storage → `Content-Disposition: attachment`). Sirve también para los `.bin` ya guardados. La burbuja muestra el nombre del archivo + ⬇. Al archivar, la extensión sale del **nombre** del documento. Si el bucket rechaza el MIME, se reintenta como `application/octet-stream`. |
| `c0105f0` | `f01d2e2` | `/api/rescatar-media` dice **por qué** falla cada archivo. Antes `no_estaban_en_meta` contaba CUALQUIER fallo y tres .psd que Meta sí tenía parecían perdidos. Ahora: `perdidos_en_meta` (400/404, sin arreglo), `fallaron_con_arreglo`, `fallos_por_motivo` y `motivo` por archivo (`muy_grande_para_el_bucket`, `tipo_rechazado_por_el_bucket`, `meta_respondio_401`…). `archivarMedia` sigue devolviendo `url\|null`; la variante con motivo es `archivarMediaDetalle`. |
| — | — | **Base (x1):** `storage.buckets.file_size_limit` de `inbox-media` de 25 MB → **100 MB** (`104857600`). Cambio directo con SQL; no hay archivo de migración. |

Pruebas: `tests/descarga.test.js` y `tests/motivos-archivo.test.js` en los dos. Suites verdes: IND 800, MANDI 927.

**Verificado:**
- `curl -I …/Conejo-wamid.bin?download=Conejo.ai` → `Content-Disposition: attachment; filename=Conejo.ai`.
- Rescate en IND: se salvaron los 3 .psd del 13-oct (`Diseño HAMC Nomads002_2026_*.psd`, ahora con `media_url` `.psd`).
- Los otros 5 (la .ttf del 29-sep, documentos del 17 al 23-sep y una imagen del 18-sep) dieron `lookup 400` en los logs: Meta ya los borró. Si hacen falta, hay que pedírselos al cliente otra vez.

## Para diagnosticar la próxima vez
- Logs de Vercel con `[media-archive]`:
  - `lookup 400` = Meta lo borró.
  - `exceeded the maximum allowed size` = el bucket es chico para ese archivo.
  - `mime type … not supported` = la lista de MIMEs del bucket (ahora se reintenta solo).
- El rescate pide sesión: se abre en el navegador desde **el dominio propio** (`ind-inbox.apps.mandarinaec.com/api/rescatar-media?dias=30`). En `*.vercel.app` responde `No autenticado`.

## Todavía NO
- No se ha probado de punta a punta con un .ai NUEVO que llegue después del deploy. Se verá en el próximo que mande un cliente: debe guardarse como `.ai` y bajar con su nombre.
- Cambio de comportamiento: los PDF y Excel ahora **se descargan** en vez de abrirse en una pestaña. Si Rodrigo prefiere verlos en el navegador, se puede excluir `pdf` de la descarga forzada.
- MANDI tiene 2 PDF y 1 PNG entrantes sin archivar (últimos 120 días). No se corrió el rescate en MANDI.
