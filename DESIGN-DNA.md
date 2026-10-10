# Turnwise — DNA v2 · "Bitácora"

Estado: v2 (2026-10-10). Sustituye al v1 "chat con inspector", que el usuario juzgó demasiado básico frente a Claude Code desktop. Pendiente de ratificar: la firma (recibo del turno) y la paleta grafito.

## 0. Mundo y tarea
Un agente trabaja sobre un proyecto mientras el usuario supervisa. El objeto principal no es el mensaje, sino el **turno**: un pedido, los pasos que dio el agente y el resultado en ficheros. El usuario hace tres cosas: pedir, vigilar y revisar o deshacer. La UI es un registro de trabajo legible, no un chat.

## 1. Referencias (evidencia del 2026-10-10: capturas del usuario de Claude Code desktop)
- Densidad de herramienta: pasos de una línea con la duración alineada a la derecha, agrupados en bloques plegables, y el canal de números (§3).
- Claude Code desktop: composer como objeto único con chips (permisos, modelo) dentro; franja de rama y diffstat `+N −M` anclada sobre el composer; sidebar por fechas. **Se toma** la anatomía del composer y la franja de contexto.
- Suelo vigente: cromo que se retira, superficies neutras grafito, una sola tinta de acento, tipografía ajustada y propia. **Moda saturada que se evita**: burbujas de chat (el usuario juzgó la burbuja gris "ChatGPT de hace unos años"), degradados, sparkle de "IA".
- Desviación propia: el **recibo del turno** (§3). Ninguna de las referencias cierra cada turno con su resultado en ficheros.

## 2. Macroestructura
Hay tres zonas. Carril de proyectos (izq.) · Bitácora (centro, columna de lectura de 48rem) · Revisión (der., bajo demanda: Diff / Plan / Fuentes). El usuario confirmó el 2026-10-10 la columna centrada con la revisión a demanda: comparado con Claude Code desktop, lo que envejecía la app eran las tarjetas y el cromo, no el centrado.
Barra de la app propia: la barra nativa de Windows se oculta (`titleBarStyle: 'hidden'`) y sus controles se superponen a la cabecera más a la derecha, que les reserva el hueco con `env(titlebar-area-*)` y toma su color del tema. Las cabeceras son zonas de arrastre; sus controles, no. El smoke falla si los controles solapan la barra.
Alternativas descartadas: (a) diff como lienzo central, porque la mayoría de los turnos son de lectura y no producen cambios; (b) consola a pantalla completa, porque pierde la revisión lado a lado.
Responsive: ≤1180px la revisión pasa a capa sobre la bitácora; ≤820px el carril pasa a capa con botón propio.

## 3. Firma
- **Recibo del turno**: cierra cada turno que tocó ficheros. Es una **franja de una línea, sin tarjeta** (2026-10-10, a propuesta aceptada por el usuario tras compararlo con Claude Code): chevron, diffstat en 5 bloques (proporción real añadido/eliminado), `+N −M` en negrita, los nombres de fichero ("stream.ts, llm.ts y 1 más") y la duración. La línea despliega todos los ficheros con su `+/−`; las acciones **Revisar** y **Deshacer turno** quedan fuera del despliegue para no plegarlo al pulsarlas. Su entrada es el único momento lento: los bloques se llenan escalonados, 40ms cada uno.
- **Marca "Bloques"** (elegida por el usuario el 2026-10-10 entre tres direcciones; ver `review/logo/sheet.png`): una T hecha con los 5 bloques del diffstat del recibo, en una sola tinta. Retícula bloque 4 / hueco 1. En la app va como `#i-mark` en el acento junto al wordmark "Turnwise" con mayúscula (Schibsted Grotesk 600, 15px, −1,5%). El icono es la T en `--accent` oscuro sobre una placa `--bg` oscuro con radio del 20%; por debajo de 64px la T se ajusta a píxel entero y casi a sangre. Se genera con `npm run icons`, que lee los colores de `styles.css`.
- **Canal de numeración**: cada paso lleva `turno.paso` (`2.3`) en el margen, en mono, pequeño y en tono terciario, y el pedido lleva su número de turno igual (nunca junto al titular con su peso, que se leía como lista de Markdown). La mono solo vive en el margen, en rutas, comandos y código: cifras, duraciones y atajos van en Schibsted con `tabular-nums`.

## 4. Sistema
- Tipo (ratificado por el usuario el 2026-10-10 entre tres parejas renderizadas en la app real; ver `review/type/shots/`): **Schibsted Grotesk** variable para interfaz, prosa y titulares, una grotesca editorial nacida en una redacción, el oficio de llevar un registro. **IBM Plex Mono** 400/600 para rutas, comandos, números y diff; sus remates dan textura al código sin pesar. Ambas son OFL, van empaquetadas en `dist/renderer/fonts/` con su licencia y el smoke falla si no cargan. Descartadas: Segoe UI ("genérica"), Instrument Sans (apretada a 14px) y IBM Plex Sans (es la fuente de interfaz por defecto de Zed). Escala 12 · 14 · 15 · 17 · 20 · 30 px; 17px es el pedido, el titular del turno. Pesos 400 y 600. Prosa a 15px con interlineado 1.6 y medida de 68ch. Cifras siempre `tabular-nums`. El título del vacío va a 30px con tracking −1.5%.
- Paleta grafito neutra; el azul petróleo es la única tinta y se reserva a selección, acción primaria y estado en curso.
  Claro: lienzo #f5f6f7 · carril #eef0f2 · superficie #fbfcfc · elevado #e9edf0 · borde #d9dee2 · borde de control #7f8a93 · texto #1b2227 / #56626b / #626e77 · acento #24658c.
  Oscuro: lienzo #13171a · carril #0f1215 · superficie #1a1f23 · elevado #22282d · borde #2b3238 · borde de control #67727a · texto #e4e8eb / #9ba6ae / #87929a · acento #86c3e6.
  Estados: añadido, eliminado y aviso con tinta y fondo del mismo tono (ver §10). El estado normal es silencioso; solo hablan los errores, las aprobaciones y lo que está en curso.
- Espacio: 4 · 8 · 12 · 16 · 24 · 32 · 48 px (en rem). Densidad de herramienta: filas de paso de 28px.
- Radios por rol: controles y chips 8px; objetos (recibo) 12px; composer y diálogos 16px; costuras estructurales (carril, cabeceras) rectas.
- Profundidad: elevación = un escalón de luminosidad. En oscuro, los objetos llevan una luz de canto superior de 1px; sombra de reposo (`--shadow-rest`) solo en el composer, y sombras de capa solo en los flotantes.
- Iconos: una familia lineal propia de 16/20px y trazo 1.6, uno por clase de paso (leer, editar, ejecutar, buscar, plan, web, MCP).
- Estado del turno en la barra superior, no en la bitácora: Trabajando (punto que pulsa) · Esperando permiso (tinta de aviso) · Hecho / Detenido / Falló con su duración, quieto. Al abrir una conversación muestra cómo terminó su último turno.
- **Menús de elección** (permisos, modelo, esfuerzo; 2026-10-10, el usuario pidió quitar los selects nativos): popover propio en la capa superior, anclado a su chip con anchor positioning (se abre hacia arriba y se gira solo si no cabe), radio de objeto y sombra de capa. La opción en uso lleva check y peso 600; los permisos dicen su consecuencia en una línea; el de modelo tiene búsqueda sin tildes y un pie con el host del endpoint y «Cambiar…». Teclado: flechas, Enter, Escape; el foco vuelve al chip.
- Movimiento: 140ms con ease-out para los estados; el recibo es el único momento orquestado; solo lo que está pasando pulsa (1.2s). `prefers-reduced-motion` elimina ambas cosas.

## 5. Contratos de pantalla
- **Bitácora.** Llega quien acaba de pedir algo o vuelve a una conversación. Ya conoce el proyecto y lo que pidió, así que no se le repite. Necesita saber qué hizo el agente (verbo + objeto), qué falló, qué espera su permiso y qué ficheros cambiaron. Acciones: 1) aprobar o denegar inline, 2) revisar el recibo, 3) seguir pidiendo.
- **Revisión.** Llega desde un recibo. Ya sabe en qué turno está. Necesita ver los ficheros con su `+/−`, y el diff con números de línea. Acciones: deshacer un fichero o el turno. La lista no se reordena al seleccionar.
- **Carril.** Nueva conversación (Ctrl N, en la carpeta de la conversación actual), Abrir carpeta… (Ctrl O, diálogo nativo) y búsqueda (Ctrl K, sin tildes ni mayúsculas; Escape limpia). Cada proyecto tiene su `+` para empezar ahí, y la ruta del dock también abre otra carpeta. Cada conversación trabaja en la carpeta de su proyecto. El menú de modelo se llena con `GET /models` del endpoint; si falla, se avisa y quedan el modelo del .env y `TURNWISE_MODELS`. Modelo, esfuerzo, permisos y última carpeta se guardan en `settings.json`. Agrupa por proyecto con la última actividad del proyecto en su cabecera, y cada conversación con su hora relativa o el punto de "en curso".

- **Configuración.** Llega quien quiere cambiar de proveedor o arreglar uno que no conecta. Necesita elegir el protocolo (compatible con OpenAI o con Anthropic, conmutador de dos), la URL base con /v1 y la clave, y saber si conecta antes de guardar («Probar conexión» → «Conecta · N modelos» o el error del endpoint). La clave se guarda cifrada por Windows (safeStorage) y nunca vuelve a la interfaz: solo de dónde viene y sus 4 últimos caracteres. Si el modelo en uso no existe en el endpoint nuevo, se avisa; no se cambia solo.

## 6. Voz
Español, verbos en pasado para lo hecho ("Leyó", "Editó", "Ejecutó") y en gerundio para lo que está en curso ("Leyendo…"). Las acciones se nombran por su resultado ("Deshacer turno", "Permitir una vez"). Sin narraciones ni capacidades explicadas dentro de la app.

## 7. Guardas
Default rechazado: burbujas de chat (el pedido es un titular de turno sin fondo, separado por una costura de 1px), una tarjeta por herramienta, JSON crudo de argumentos, selects nativos como cabecera, contadores que repiten la lista. Sin degradados ni brillos; solo el recibo tiene material propio. Nada de z-index literales: los flotantes usan `<dialog>` o una capa de layout.

## 10. Contraste
Medido con `contrast.py` el 2026-10-10 sobre esta paleta (`review/contrast-pairs.csv`). Pasan 38/38 pares (ver tabla generada abajo). Cualquier cambio de token de color invalida esta tabla.

| Pair (fg on bg) | Ratio | Threshold | Verdict / exception & alternative |
|---|---|---|---|
| claro texto sobre lienzo (#1b2227 on #f5f6f7) | 14.88:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro texto sobre superficie (#1b2227 on #fbfcfc) | 15.66:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro texto sobre elevado (#1b2227 on #e9edf0) | 13.67:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro texto sobre carril (#1b2227 on #eef0f2) | 14.09:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro secundario sobre lienzo (#56626b on #f5f6f7) | 5.78:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro secundario sobre elevado (#56626b on #e9edf0) | 5.32:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro secundario sobre carril (#56626b on #eef0f2) | 5.48:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro terciario (gutter) sobre lienzo (#626e77 on #f5f6f7) | 4.83:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro acento texto sobre lienzo (#24658c on #f5f6f7) | 5.85:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro acento texto sobre elevado (#24658c on #e9edf0) | 5.38:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro etiqueta sobre acento (#f3f8fb on #24658c) | 5.92:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro anadido sobre superficie (#23693f on #fbfcfc) | 6.46:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro eliminado sobre superficie (#a3352c on #fbfcfc) | 6.58:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro anadido sobre fondo diff (#23693f on #e3f1e8) | 5.69:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro eliminado sobre fondo diff (#a3352c on #f8e7e5) | 5.66:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro texto sobre fondo diff anadido (#1b2227 on #e3f1e8) | 13.81:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro aviso sobre fondo aviso (#7a5810 on #f4ead3) | 5.43:1 | 4.5:1 | PASS (measured 2026-10-10) |
| claro foco no texto (#24658c on #f5f6f7) | 5.85:1 | 3:1 | PASS (measured 2026-10-10) |
| claro borde control no texto (#7f8a93 on #fbfcfc) | 3.43:1 | 3:1 | PASS (measured 2026-10-10) |
| oscuro texto sobre lienzo (#e4e8eb on #13171a) | 14.63:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro texto sobre superficie (#e4e8eb on #1a1f23) | 13.48:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro texto sobre elevado (#e4e8eb on #22282d) | 12.09:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro texto sobre carril (#e4e8eb on #0f1215) | 15.25:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro secundario sobre lienzo (#9ba6ae on #13171a) | 7.26:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro secundario sobre elevado (#9ba6ae on #22282d) | 6.00:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro secundario sobre carril (#9ba6ae on #0f1215) | 7.57:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro terciario (gutter) sobre lienzo (#87929a on #13171a) | 5.67:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro acento texto sobre lienzo (#86c3e6 on #13171a) | 9.41:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro acento texto sobre elevado (#86c3e6 on #22282d) | 7.78:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro etiqueta sobre acento (#0e1d27 on #86c3e6) | 8.96:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro anadido sobre superficie (#7fcb9c on #1a1f23) | 8.64:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro eliminado sobre superficie (#ec8f86 on #1a1f23) | 6.99:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro anadido sobre fondo diff (#7fcb9c on #1b2e23) | 7.47:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro eliminado sobre fondo diff (#ec8f86 on #33201e) | 6.47:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro texto sobre fondo diff anadido (#e4e8eb on #1b2e23) | 11.66:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro aviso sobre fondo aviso (#d8b46a on #352c1b) | 6.98:1 | 4.5:1 | PASS (measured 2026-10-10) |
| oscuro foco no texto (#86c3e6 on #13171a) | 9.41:1 | 3:1 | PASS (measured 2026-10-10) |
| oscuro borde control no texto (#67727a on #1a1f23) | 3.37:1 | 3:1 | PASS (measured 2026-10-10) |

QA visual: capturas headless deterministas (`node scripts/ui-shot.mjs`: bridge simulado, datos sembrados, sin credenciales) en `review/shots/`, a 1440×900 claro y oscuro, a 375px, y con un turno en curso con aprobación pendiente.
