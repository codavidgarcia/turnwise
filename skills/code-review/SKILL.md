---
name: code-review
description: Revisa un diff o fichero en busca de bugs, seguridad y claridad antes de considerar una tarea terminada.
---

# Code review

Cuando la tarea implique crear o modificar código, antes de responder "hecho":

1. Relee los ficheros cambiados con `read_file` y revisa:
   - Errores de lógica, casos límite y manejo de errores.
   - Seguridad: inyección de comandos, rutas fuera del workspace, secretos en claro.
   - Nombres y estructura claros; sin código muerto.
2. Ejecuta lo que tenga sentido con `run_shell` (build, tests, lint).
3. Corrige los problemas que encuentres y vuelve a comprobar.
4. Resume: qué revisaste, qué corregiste y qué riesgos quedan.
