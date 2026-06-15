# Windows Distribution & Startup (foundation)

This documents Orbit's Windows usability + packaging foundation and, honestly,
what is *not* yet done (production signing, auto-update, GUI-verified startup).

## Single-instance

`tauri-plugin-single-instance` is registered **first** in the Tauri builder
(`lib.rs`). If Orbit is already running, launching it again does **not** start a
second process — the plugin fires its callback in the existing instance, which
surfaces the launcher (`focus_launcher`: show + unminimize + focus). This keeps
one tray icon, one hotkey registration, and one SQLite handle.

## Launch at login

`tauri-plugin-autostart` provides OS-native autostart (registry `Run` key on
Windows; LaunchAgent on macOS; autostart desktop entry on Linux). It is wired
through two IPC commands — `get_autostart` / `set_autostart` — using the plugin's
**Rust manager API**, so no extra frontend capability is required. The user
controls it from **Settings → General → "Launch Orbit at login"** (off by
default; the previous placeholder toggle is gone). No privileged access is used
and no security settings are touched.

## Diagnostics export

**Settings → Developer → "Copy diagnostics"** copies a small JSON blob (app name,
version, platform, data dir, db path, export timestamp) to the clipboard for bug
reports. It contains **no secrets** and never logs clipboard or keystroke data.

## Installer

`tauri.conf.json` already configures the bundle:

- Targets: `msi`, `nsis` (Windows), `dmg`/`app` (macOS).
- NSIS `installMode: currentUser` (no admin/UAC elevation required to install).
- Publisher, copyright, category, short/long descriptions, and the full icon set
  (`.ico`/`.png`/`.icns`) are set. Stable identifier: `dev.orbitlauncher.app`.

Build an **unsigned** developer/test installer with:

```bash
npm run build --workspace @orbit/desktop   # runs `tauri build` (vite build + cargo release + bundlers)
```

> ⚠️ Not built or run in this environment. `tauri build` does a full release
> compile and invokes WiX (MSI) / NSIS, which are heavy and were intentionally
> skipped here. The single-instance and launch-at-login wiring is **compiled and
> verified via `cargo check`**, but the *runtime* behaviour (second-launch
> focusing; the login entry actually being created) has **not** been GUI-verified
> in this environment — verify on a real `tauri build` / installed run.

## Code signing (required for production — not configured)

An unsigned Windows installer triggers SmartScreen ("Unknown publisher") and a
scary UAC prompt. Production distribution needs:

1. An **Authenticode code-signing certificate** — either an OV certificate (cheap,
   but SmartScreen reputation must be earned over time/downloads) or, preferably,
   an **EV certificate** on a hardware token / cloud HSM (immediate SmartScreen
   trust).
2. Tauri signing config: set `bundle.windows.certificateThumbprint` (or use
   `signCommand` with a cloud-HSM signing tool such as Azure Trusted Signing /
   DigiCert KeyLocker). The private key must live in a token/HSM — **never** in
   the repo or `.env`.
3. Timestamping (`bundle.windows.timestampUrl`) so signatures remain valid after
   the cert expires.

These credentials are **not available** in this environment, so signing is left
unconfigured and documented here rather than faked.

## Auto-update — intentionally deferred

Auto-update is **not** enabled. A safe updater requires a signed update artifact
plus an update-signature public key in the app (`plugins.updater`), and a hosting
endpoint. Shipping an updater without that verification model would be a remote
code-execution risk, so it is deferred until signing (above) exists.

## Dependency audit (dev-only)

`npm audit` reports **5 advisories (2 moderate, 2 high, 1 critical)**, all in the
**dev** toolchain dependency chain (`esbuild` → `vite` → `vitest`/`vite-node`/
`@vitest/mocker`). None ship in the application bundle. Per project policy we do
**not** run `npm audit fix --force` (it pulls breaking major bumps of vite/
vitest). Re-evaluate when upgrading the Vite/Vitest majors deliberately.

## Remaining (future)

- Code-signing + notarization config (above).
- Auto-update with signature verification.
- CI workflow to build/sign/publish installers.
- GUI verification of single-instance focusing and the created login entry on a
  real installed build.
