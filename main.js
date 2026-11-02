const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile, spawn } = require('child_process')

const WEAVE_DIR = path.join(os.homedir(), '.weave')
const WEAVE_MODS_DIR = path.join(WEAVE_DIR, 'mods')
const WEAVE_MODS_DISABLED_DIR = path.join(WEAVE_DIR, 'mods-disabled')
const MOD_DISABLED_SUFFIX = '.disabled'

function listModsInDir(dir, legacy = false) {
  try {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .map(file => {
        const lowerName = file.toLowerCase()
        const disabledBySuffix = !legacy && lowerName.endsWith(`.jar${MOD_DISABLED_SUFFIX}`)
        if (legacy ? !lowerName.endsWith('.jar') : !disabledBySuffix && !lowerName.endsWith('.jar')) return null

        const disabled = legacy || disabledBySuffix
        const name = disabledBySuffix ? file.slice(0, -MOD_DISABLED_SUFFIX.length) : file
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) return null
        return { name, size: stat.size, mtime: stat.mtimeMs, enabled: !disabled, legacy }
      })
      .filter(Boolean)
  } catch (_) { return [] }
}

function getWorkDir(execPath) {
  const normalized = execPath.replace(/\\/g, '/')
  const idx = normalized.toLowerCase().indexOf('/.lunarclient/')
  return idx !== -1
    ? path.join(execPath.slice(0, idx + 13), 'offline', 'multiver')
    : path.join(os.homedir(), '.lunarclient', 'offline', 'multiver')
}

function patchCommandLine(cmdline) {
  const weaveAgent = path.join(WEAVE_DIR, 'weave-agent.jar')
  const agentArg = `-javaagent:"${weaveAgent}"`
  return cmdline
    .replace(/-XX:\+DisableAttachMechanism\s*/g, '')
    .replace(/-javaagent:"?[^"\s]*weave-agent\.jar"?\s*/gi, '')
    .replace('com.moonsworth.lunar.genesis.Genesis', `${agentArg} com.moonsworth.lunar.genesis.Genesis`)
}

function findLunarProcesses() {
  const ps = `
    Get-CimInstance Win32_Process -Filter "Name = 'javaw.exe'" |
      Where-Object { $_.CommandLine -like '*com.moonsworth.lunar.genesis.Genesis*' } |
      Sort-Object CreationDate -Descending |
      Select-Object ProcessId, CommandLine, ExecutablePath |
      ConvertTo-Json -Compress
  `

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { maxBuffer: 1024 * 1024 * 20 }, (err, stdout) => {
      if (err) return reject(new Error('Could not read process list'))

      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : []
        const processes = Array.isArray(parsed) ? parsed : [parsed]
        resolve(processes
          .filter(proc => proc && proc.ProcessId && proc.CommandLine && proc.ExecutablePath)
          .map(proc => ({
            pid: String(proc.ProcessId),
            execPath: String(proc.ExecutablePath),
            cmdline: String(proc.CommandLine)
          })))
      } catch (_) {
        reject(new Error('Could not parse process list'))
      }
    })
  })
}

function launchHiddenBatch(commandLine, workDir, id = Date.now()) {
  return new Promise((resolve) => {
    const tmpBat = path.join(os.tmpdir(), `umbra-weave-launch-${id}.bat`)
    const tmpVbs = path.join(os.tmpdir(), `umbra-weave-launch-${id}.vbs`)
    const cleanup = () => {
      try { fs.unlinkSync(tmpBat) } catch (_) {}
      try { fs.unlinkSync(tmpVbs) } catch (_) {}
    }

    try {
      fs.writeFileSync(tmpBat, `@echo off\r\ncd /d "${workDir}"\r\n${commandLine}\r\n`, 'ascii')
      const safeBat = tmpBat.replace(/\\/g, '\\\\')
      fs.writeFileSync(tmpVbs, `Set sh = CreateObject("WScript.Shell")\r\nsh.Run Chr(34) & "${safeBat}" & Chr(34), 0, False\r\n`, 'ascii')

      const child = spawn('wscript.exe', [tmpVbs], { detached: true, stdio: 'ignore' })
      child.once('error', () => {
        cleanup()
        resolve({ ok: false, error: 'Could not start Lunar' })
      })
      child.unref()
      setTimeout(() => {
        cleanup()
        resolve({ ok: true })
      }, 3000)
    } catch (_) {
      cleanup()
      resolve({ ok: false, error: 'Could not prepare Lunar launch' })
    }
  })
}

let win = null
let tray = null

function createWindow() {
  win = new BrowserWindow({
    width: 520, height: 700,
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

app.on('window-all-closed', () => { app.quit() })
ipcMain.on('close-app', () => { if (win) { win.destroy(); win = null } app.quit() })
ipcMain.on('minimize-app', () => win?.minimize())

// Ouvrir le dossier mods dans l'explorateur
ipcMain.on('open-mods-dir', () => {
  fs.mkdirSync(WEAVE_MODS_DIR, { recursive: true })
  shell.openPath(WEAVE_MODS_DIR)
})

// List active mods and mods disabled by renaming their JAR files.
ipcMain.handle('list-mods', () => {
  return [...listModsInDir(WEAVE_MODS_DIR), ...listModsInDir(WEAVE_MODS_DISABLED_DIR, true)]
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return a.name.localeCompare(b.name)
    })
})

// Toggle a mod by renaming it in place; keep mods disabled by older versions usable.
ipcMain.handle('toggle-mod', (_, name, enable, legacy = false) => {
  try {
    const safe = path.basename(name)
    if (!safe.toLowerCase().endsWith('.jar')) return false

    const src = enable
      ? path.join(legacy ? WEAVE_MODS_DISABLED_DIR : WEAVE_MODS_DIR, legacy ? safe : `${safe}${MOD_DISABLED_SUFFIX}`)
      : path.join(WEAVE_MODS_DIR, safe)
    const dst = enable
      ? path.join(WEAVE_MODS_DIR, safe)
      : path.join(WEAVE_MODS_DIR, `${safe}${MOD_DISABLED_SUFFIX}`)
    if (!fs.existsSync(src) || fs.existsSync(dst) || !fs.statSync(src).isFile()) return false
    fs.renameSync(src, dst)
    return true
  } catch (_) { return false }
})

// Delete an active or disabled mod.
ipcMain.handle('delete-mod', (_, name, enabled, legacy = false) => {
  try {
    const safe = path.basename(name)
    if (!safe.toLowerCase().endsWith('.jar')) return false
    const filePath = legacy
      ? path.join(WEAVE_MODS_DISABLED_DIR, safe)
      : path.join(WEAVE_MODS_DIR, enabled ? safe : `${safe}${MOD_DISABLED_SUFFIX}`)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false
    fs.unlinkSync(filePath)
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

// Restart the newest Lunar process with the Weave agent attached.
ipcMain.handle('launch-weave', async () => {
  const weaveAgent = path.join(WEAVE_DIR, 'weave-agent.jar')

  if (!fs.existsSync(weaveAgent)) {
    return { ok: false, error: 'Weave Loader not found — please load it first' }
  }

  let lunarProcesses
  try {
    lunarProcesses = await findLunarProcesses()
  } catch (error) {
    return { ok: false, error: error.message }
  }

  const lunarInfo = lunarProcesses[0]
  if (!lunarInfo) return { ok: false, error: 'Lunar not found — please launch it first' }

  const workDir = getWorkDir(lunarInfo.execPath)
  const stopped = await new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', lunarInfo.pid, '/F'], error => resolve(!error))
  })
  if (!stopped) return { ok: false, error: 'Could not stop the current Lunar process' }

  await new Promise(resolve => setTimeout(resolve, 1500))
  return launchHiddenBatch(patchCommandLine(lunarInfo.cmdline), workDir, lunarInfo.pid)
})

// Start another instance from the live Lunar process without stopping it.
ipcMain.handle('launch-lunar-weave', async () => {
  const weaveAgent = path.join(WEAVE_DIR, 'weave-agent.jar')
  if (!fs.existsSync(weaveAgent)) {
    return { ok: false, error: 'Weave Loader not found — please load it first' }
  }

  let lunarProcesses
  try {
    lunarProcesses = await findLunarProcesses()
  } catch (error) {
    return { ok: false, error: error.message }
  }

  const lunarInfo = lunarProcesses[0]
  if (!lunarInfo) return { ok: false, error: 'Lunar not found — please launch it first' }

  const workDir = getWorkDir(lunarInfo.execPath)
  return launchHiddenBatch(patchCommandLine(lunarInfo.cmdline), workDir, `second-${Date.now()}`)
})
