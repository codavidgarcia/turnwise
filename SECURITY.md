# Security

Turnwise runs a model that can read files, write files and execute commands in the folder you open. Treat that as the threat model.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's [private vulnerability reporting](https://github.com/codavidgarcia/turnwise/security/advisories/new) with steps to reproduce. You'll get an answer within a week.

## In scope

- Escaping the project folder (path traversal, symlinks) from any tool.
- Running a write or a command without approval in Read-only or Ask mode.
- Script execution in the renderer from model output, files, attachments or web pages.
- The API key leaving the main process, or being stored unencrypted when saved from Settings.

## Known and by design

- **No-confirmation mode** lets the agent write and run commands without asking, with no OS-level isolation.
- Keys in `.env` are plain text on your disk; keys saved from Settings are encrypted with Windows DPAPI.
