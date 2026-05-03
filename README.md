# UmbraWeave

<p align="center">
  <img src="logo/logo.png" width="120" alt="UmbraWeave Logo" />
</p>

<p align="center">
  <strong>A lightweight Weave mod manager for Lunar Client — Windows only</strong><br/>
  Built and maintained by <strong>Slxrdd</strong>
</p>

---

> ⚠️ **Windows only.** UmbraWeave is designed exclusively for Windows x64 and will not run on macOS or Linux.

---

## What is UmbraWeave?

UmbraWeave is a free, open-use Electron-based launcher that simplifies loading Weave mods into Lunar Client. No account, no license key, no server connection — just pick your Weave Loader, drop your mods, and launch.

### Features

- Load any `weave-agent.jar` directly from your filesystem
- Visual mod manager — lists all `.jar` files in `~/.weave/mods/`
- Open the mods folder in Explorer with one click
- Remove mods from the UI
- Relaunch Lunar Client with the Weave agent injected — one click

---

## Requirements

- Windows 10 or 11 (x64)
- [Node.js](https://nodejs.org) v18+ (development only)
- Lunar Client installed and running at least once
- A `weave-agent.jar` from [Weave-MC/Weave-Loader](https://github.com/Weave-MC/Weave-Loader/releases)

---

## Getting started (development)

```bash
# 1. Install dependencies
cd "umbra weave"
npm install

# 2. Run
npm start
```

---

## Building the installer

```bash
npm run build
```

Output files will be in the `dist/` folder:
- `UmbraWeave Setup 1.0.0.exe` — NSIS one-click installer
- `UmbraWeave 1.0.0.exe` — Standalone portable executable

---

## How to use

### 1. Load Weave Loader

Click **Browse...** next to "Weave Loader" and select your `weave-agent.jar`.  
It will be copied to `~/.weave/weave-agent.jar` and remembered for future launches.

You can download the latest Weave Loader here:  
👉 https://github.com/Weave-MC/Weave-Loader/releases

### 2. Add mods

Drop your mod `.jar` files into:
```
C:\Users\<YourName>\.weave\mods\
```

Or click **📂 Open folder** to open this directory directly in Windows Explorer.

### 3. Launch Lunar with Weave

1. Start Lunar Client normally and wait for it to fully load
2. Click **LOAD WEAVE** in UmbraWeave
3. The launcher will find Lunar, stop it, and relaunch it with the Weave agent attached
4. Your mods will be active on the next game session

---

## How it works

```
User clicks "LOAD WEAVE"
        ↓
Launcher scans for running javaw.exe (Lunar Client / Genesis)
        ↓
Kills the process
        ↓
Relaunches with: -javaagent:"~/.weave/weave-agent.jar"
(DisableAttachMechanism flag stripped automatically)
        ↓
Lunar Client starts with all mods in ~/.weave/mods/ loaded
```

---

## Project structure

```
umbra weave/
├── main.js       # Electron main process (IPC handlers, launch logic)
├── index.html    # UI + renderer (mod list, agent picker, launch button)
├── assets/
│   └── icon.ico
└── logo/
    └── logo.png
```

---

## Notes

- UmbraWeave does **not** connect to any server. Everything runs locally.
- The launcher does **not** modify any Lunar Client files permanently.
- Mods are loaded by Weave Loader — UmbraWeave only handles the injection of the agent.
- If Lunar Client updates and breaks `-javaagent` injection, update your `weave-agent.jar`.

---

## License

MIT — free to use and modify.

---

*Developed by **Slxrdd***
