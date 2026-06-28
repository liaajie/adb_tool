const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { exec, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const CONFIG_PATH = path.join(app.getPath('userData'), 'commands.json')

function getDefaultConfig() {
  const local = path.join(__dirname, 'default-commands.json')
  if (fs.existsSync(local)) return local
  // packaged path
  return path.join(process.resourcesPath, 'default-commands.json')
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadFile('index.html')
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// Sanitize user-supplied param values to prevent shell injection
function sanitize(v) {
  return String(v).replace(/[;&|`$<>\\]/g, '')
}

let adbPath = 'adb'

ipcMain.handle('adb:setPath', (_, p) => { adbPath = p || 'adb' })

ipcMain.handle('adb:devices', () => new Promise(resolve => {
  exec(`"${adbPath}" devices`, (err, stdout) => {
    if (err) return resolve([])
    const devices = stdout.trim().split('\n').slice(1)
      .filter(l => l.includes('\tdevice'))
      .map(l => ({ serial: l.split('\t')[0].trim() }))
    resolve(devices)
  })
}))

ipcMain.handle('adb:run', (_, { cmd, serial }) => new Promise(resolve => {
  const s = serial ? `-s "${sanitize(serial)}"` : ''
  const full = `"${adbPath}" ${s} ${cmd}`
  exec(full, { timeout: 30000 }, (err, stdout, stderr) => {
    resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', cmd: full })
  })
}))

// ponytail: global map for active streams, per-window kill on close is fine for MVP
const activeStreams = new Map()

ipcMain.on('adb:stream', (event, { id, cmd, serial }) => {
  const s = serial ? `-s "${sanitize(serial)}"` : ''
  const proc = spawn(`"${adbPath}" ${s} ${cmd}`, { shell: true })
  activeStreams.set(id, proc)
  const send = (type, data) => { try { event.sender.send(`adb:stream:${id}`, { type, data }) } catch {} }
  proc.stdout.on('data', d => send('data', d.toString()))
  proc.stderr.on('data', d => send('err', d.toString()))
  proc.on('close', () => { activeStreams.delete(id); send('end', '') })
})

ipcMain.on('adb:stream:kill', (_, id) => { activeStreams.get(id)?.kill(); activeStreams.delete(id) })

ipcMain.handle('config:load', () => {
  const src = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : getDefaultConfig()
  return JSON.parse(fs.readFileSync(src, 'utf8'))
})

ipcMain.handle('config:save', (_, config) => {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  return true
})

ipcMain.handle('config:export', async () => {
  const { filePath } = await dialog.showSaveDialog({
    title: '导出配置',
    defaultPath: 'adb-commands.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (!filePath) return false
  const src = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : getDefaultConfig()
  fs.copyFileSync(src, filePath)
  return true
})

ipcMain.handle('config:import', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: '导入配置',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (!filePaths?.[0]) return null
  const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'))
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8')
  return data
})

ipcMain.handle('config:reset', () => {
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH)
  return JSON.parse(fs.readFileSync(getDefaultConfig(), 'utf8'))
})
