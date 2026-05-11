# Agnipariksha — Tauri Desktop Wrapper

Tauri 2 shell that bundles the Next.js frontend as a native desktop app
(Windows, macOS, Linux). The shell adds a Rust-side raw-TCP SCPI command
so the UI can keep working when the FastAPI backend is offline.

## Layout

```
frontend/src-tauri/
├── Cargo.toml              # Tauri 2.x crates
├── build.rs                # tauri-build entry point
├── tauri.conf.json         # window + bundle config
├── capabilities/
│   └── default.json        # permission set for the main window
├── icons/                  # app icons (32, 128, 128@2x, .icns, .ico)
└── src/
    └── main.rs             # invoke handlers + `scpi_send`
```

## Frontend prerequisite — static export

Tauri serves the production UI from `frontend/out`, so Next.js must be
built in **static-export** mode. Add (or confirm) the following in
`frontend/next.config.ts`:

```ts
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};
export default nextConfig;
```

`npm run build` will then emit `frontend/out/`, which is what
`tauri.conf.json#build.frontendDist` points at.

Dev mode loads `http://localhost:3000` directly — `next.config.ts` is
not consulted for `npm run dev`, so the static-export options only
affect production builds.

## Rust commands exposed to the webview

```rust
#[tauri::command]
fn scpi_send(cmd: String, ip: String, port: u16) -> Result<String, String>
```

Opens a raw TCP socket to `<ip>:<port>`, writes `<cmd>\n`, and returns
the trimmed response for queries (commands ending in `?`) or `"OK"`
for set/write commands. Used as a fallback path from the UI when the
FastAPI WebSocket is unreachable. From the JS side:

```ts
import { invoke } from "@tauri-apps/api/core";

const idn = await invoke<string>("scpi_send", {
  cmd: "*IDN?",
  ip: "192.168.200.100",
  port: 30000,
});
```

`get_device_identity(ip, port)` is a thin wrapper that issues `*IDN?`.

## Build instructions

### One-time setup

1. Install the Rust toolchain — <https://rustup.rs>.
2. Install Tauri 2 prerequisites for your OS (WebView2 on Windows,
   `webkit2gtk` + `libssl` + `libsoup` on Linux, Xcode CLT on macOS):
   <https://v2.tauri.app/start/prerequisites/>.
3. Install the Tauri CLI:

   ```bash
   npm install -g @tauri-apps/cli@^2
   # or, project-local: npm i -D @tauri-apps/cli@^2
   ```

4. From `frontend/`, install JS deps:

   ```bash
   cd frontend
   npm install
   ```

### Dev

```bash
cd frontend
npm run tauri dev
```

This runs `npm run dev` (Next.js on :3000) and opens the Tauri window
against it. Hot-reload applies to the UI; Rust changes recompile the
shell automatically.

### Production build

```bash
cd frontend
npm run tauri build
```

Artifacts land in `frontend/src-tauri/target/release/bundle/`
(`.msi`/`.exe` on Windows, `.dmg`/`.app` on macOS, `.AppImage`/`.deb`
on Linux).

## Icons

`icons/` must contain `32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.icns`, and `icon.ico`. The Tauri CLI can generate them from a
1024×1024 source PNG:

```bash
cd frontend/src-tauri
npx @tauri-apps/cli@^2 icon ../app-icon.png
```

## Notes

- The `capabilities/default.json` set is intentionally minimal —
  add `tauri-plugin-fs` or other permissions there if the UI starts
  needing them.
- The Rust `scpi_send` command is a thin fallback only. The primary
  data path remains the FastAPI WebSocket; prefer that when the
  backend is up.
