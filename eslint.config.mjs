// eslint.config.mjs — el revisor que falta antes de subir.
//
// ⚠️ POR QUÉ EXISTE. Dos veces se subió a producción una palabra que no existía
// en ningún lado, y las dos veces pasó el build y las pruebas:
//
//   · `ORANGE`  — copiado de MANDI, donde la paleta se llama distinto
//   · `antesDe` — usado en el cuerpo de una función cuya firma no lo declaraba;
//                 dejó `/api/hilo` de IND devolviendo 500 en TODA carga de hilo
//
// Los dos son `ReferenceError` de EJECUCIÓN: el compilador los deja pasar
// porque no sabe si esa palabra va a existir cuando el código corra, y las
// pruebas no los ven porque nadie llama a esa línea. `no-undef` los caza en un
// segundo, antes de que salgan de la compu.
//
// ☠️ ESTO NO CORRE EN VERCEL A PROPÓSITO. `next build` lintea solo si encuentra
// esta configuración, y eso alarga cada despliegue — que es justo el gasto que
// se está bajando (Build CPU llegó a ser el 29% de la factura). Por eso
// `next.config.js` lleva `eslint.ignoreDuringBuilds`. Corre con `npm test`.

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'scripts/**'] },
  // Los `eslint-disable` que ya viven en el código quedan como están: sacarlos
  // no arregla nada y el aviso taparía a los hallazgos que sí importan.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      // Todo junto (navegador + servidor) a propósito: separar por carpeta
      // suena más prolijo pero se rompe apenas alguien mueva un archivo, y el
      // costo de equivocarse ahí es un aviso FALSO — que es lo único capaz de
      // hacer que alguien empiece a ignorar al revisor.
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // La razón de ser de todo esto.
      'no-undef': 'error',

      // Apagadas a propósito, no por pereza: este código las usa de forma
      // deliberada y dejarlas prendidas llenaría la salida de ruido. Un
      // revisor ruidoso se ignora, y entonces no revisa nada.
      'no-unused-vars': 'off',   // props e imports que se dejan a la vista
      'no-empty': 'off',         // `catch {}` es el patrón de best-effort de acá

      // El BOM invisible que Vercel le pega a las variables se limpia con una
      // regex que lo lleva escrito adentro (ver `lib/env.js`). Es a propósito y
      // hay que dejarlo, pero la regla sigue prendida para el resto del código:
      // un espacio raro ENTRE dos instrucciones sí sería un problema real.
      'no-irregular-whitespace': ['error', { skipRegExps: true }],

      // Estas dos las apaga el propio Next con su config; acá se declaran para
      // que los `eslint-disable` que ya existen en el código no den error de
      // "regla desconocida".
      'react-hooks/exhaustive-deps': 'off',
      // 🟡 AVISO, no error, y con nombre y apellido: `MultiImgEditor` en
      // RightPanel.jsx llama `useRef` dentro de un `Array.from(...)`. Es una
      // violación de verdad, pero HOY no rompe nada porque la cantidad
      // (`MAX_IMGS`) es constante y el orden de los hooks no varía entre
      // renders. Arreglarlo toca el editor de adjuntos, donde el ORDEN es el
      // que ve el cliente — no se hace de paso ni sin pedirlo. Queda anotado
      // para cuando alguien entre ahí a propósito.
      'react-hooks/rules-of-hooks': 'warn',
    },
  },
]
