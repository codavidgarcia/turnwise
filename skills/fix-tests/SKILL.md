---
name: fix-tests
description: Diagnostica y arregla tests fallando: reproduce el fallo, corrige la causa raíz y verifica.
---

# Fix tests

Cuando la tarea sea arreglar tests o un build roto:

1. Reproduce el fallo con `run_shell` y guarda la salida exacta.
2. Identifica la causa raíz (no parches sintomáticos): lee el código implicado con `read_file`/`search_files`.
3. Aplica el arreglo con `edit_file` y vuelve a ejecutar el mismo comando hasta que pase.
4. Si el fallo revela un problema más amplio, añade tareas con `manage_tasks` y comunícalo al final.
