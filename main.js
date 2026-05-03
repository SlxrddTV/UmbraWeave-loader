const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const WEAVE_DIR = path.join(os.homedir(), '.weave')
const WEAVE_MODS_DIR = path.join(WEAVE_DIR, 'mods')

let win = null
let tray = null

function createWindow() {
  win = new BrowserWindow({
    width: 520, height: 620,
    resizable: false, frame: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, devTools: false },
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'assets', 'icon.ico')
  })
  win.loadFile('index.html')
  win.webContents.on('devtools-opened', () => win.webContents.closeDevTools())
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
}

app.whenReady().then(() => {
  createWindow()
  tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'))
  tray.setToolTip('UmbraWeave')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir', click: () => win?.show() },
    { label: 'Quitter', click: () => app.quit() }
  ]))
  tray.on('click', () => win?.show())
})

app.on('window-all-closed', () => {})
ipcMain.on('close-app', () => win?.hide())
ipcMain.on('minimize-app', () => win?.minimize())

// Ouvrir le dossier mods dans l'explorateur
ipcMain.on('open-mods-dir', () => {
  fs.mkdirSync(WEAVE_MODS_DIR, { recursive: true })
  shell.openPath(WEAVE_MODS_DIR)
})

// Lister les mods
ipcMain.handle('list-mods', () => {
  try {
    fs.mkdirSync(WEAVE_MODS_DIR, { recursive: true })
    return fs.readdirSync(WEAVE_MODS_DIR)
      .filter(f => f.endsWith('.jar'))
      .map(f => {
        const fp = path.join(WEAVE_MODS_DIR, f)
        const stat = fs.statSync(fp)
        return { name: f, size: stat.size, mtime: stat.mtimeMs }
      })
  } catch (_) { return [] }
})

// Supprimer un mod
ipcMain.handle('delete-mod', (_, name) => {
  try {
    const safe = path.basename(name)
    fs.unlinkSync(path.join(WEAVE_MODS_DIR, safe))
    return true
  } catch (_) { return false }
})

// Choisir le weave-agent.jar via dialog
ipcMain.handle('pick-weave-agent', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Sélectionner Weave Loader (weave-agent.jar)',
    filters: [{ name: 'JAR', extensions: ['jar'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return null
  const src = result.filePaths[0]
  const dst = path.join(WEAVE_DIR, 'weave-agent.jar')
  fs.mkdirSync(WEAVE_DIR, { recursive: true })
  fs.copyFileSync(src, dst)
  return path.basename(src)
})

// Vérifier si weave-agent.jar existe
ipcMain.handle('check-weave-agent', () => {
  const p = path.join(WEAVE_DIR, 'weave-agent.jar')
  if (!fs.existsSync(p)) return null
  const stat = fs.statSync(p)
  return { size: stat.size, mtime: stat.mtimeMs }
})

// Launch Lunar with Weave agent
ipcMain.handle('launch-weave', async () => {
  const { exec } = require('child_process')
  const weaveAgent = path.join(WEAVE_DIR, 'weave-agent.jar')

  if (!fs.existsSync(weaveAgent)) {
    return { ok: false, error: 'Weave Loader not found — please load it first' }
  }

  return new Promise((resolve) => {
    // Find Lunar process
    const ps = `Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'javaw.exe' } | Select-Object ProcessId,CommandLine,ExecutablePath | ForEach-Object { $_.ProcessId.ToString() + '|||' + $_.ExecutablePath + '|||' + $_.CommandLine }`
    exec(`powershell -NoProfile -Command "${ps}"`, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: 'Could not read process list' })

      let lunarInfo = null
      for (const line of stdout.split('\n').map(l => l.trim()).filter(Boolean)) {
        const parts = line.split('|||')
        if (parts.length < 3) continue
        const cmdline = parts.slice(2).join('|||').trim()
        if (!cmdline.includes('com.moonsworth.lunar.genesis.Genesis')) continue
        lunarInfo = { pid: parts[0].trim(), execPath: parts[1].trim(), cmdline }
        break
      }

      if (!lunarInfo) return resolve({ ok: false, error: 'Lunar not found — please launch it first' })

      // Kill Lunar
      exec(`taskkill /PID ${lunarInfo.pid} /F`, () => {
        setTimeout(() => {
          // Relaunch with weave agent
          const agentArg = `-javaagent:"${weaveAgent}"`
          const patched = lunarInfo.cmdline
            .replace(/-XX:\+DisableAttachMechanism\s*/g, '')
            .replace('com.moonsworth.lunar.genesis.Genesis', `${agentArg} com.moonsworth.lunar.genesis.Genesis`)

          // Get work dir
          const normalized = lunarInfo.execPath.replace(/\\/g, '/')
          const idx = normalized.toLowerCase().indexOf('/.lunarclient/')
          const workDir = idx !== -1
            ? path.join(lunarInfo.execPath.slice(0, idx + 13), 'offline', 'multiver')
            : path.join(os.homedir(), '.lunarclient', 'offline', 'multiver')

          const tmpBat = path.join(os.tmpdir(), 'umbra-weave-launch.bat')
          const tmpVbs = path.join(os.tmpdir(), 'umbra-weave-launch.vbs')
          fs.writeFileSync(tmpBat, `@echo off\r\ncd /d "${workDir}"\r\n${patched}\r\n`, 'ascii')
          const safeBat = tmpBat.replace(/\\/g, '\\\\')
          fs.writeFileSync(tmpVbs, `Set sh = CreateObject("WScript.Shell")\r\nsh.Run Chr(34) & "${safeBat}" & Chr(34), 0, False\r\n`, 'ascii')

          const child = require('child_process').spawn('wscript.exe', [tmpVbs], { detached: true, stdio: 'ignore' })
          child.unref()
          setTimeout(() => {
            try { fs.unlinkSync(tmpBat) } catch (_) {}
            try { fs.unlinkSync(tmpVbs) } catch (_) {}
            resolve({ ok: true })
          }, 3000)
        }, 1500)
      })
    })
  })
})
