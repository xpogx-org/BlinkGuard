# Index: IPC / API

- **What:** Contracts between main, preload, renderer, and popups (channels, payloads, `contextBridge`).
- **Where:** `shared/ipc-channels`, `electron/preload.ts`, `src/shared/ipc/`, popup `popupAPI`.
- **When to open:** Changing IPC channels, request/response shapes, or preload bridges. Rules `ipc-contract` and `electron-security`.
