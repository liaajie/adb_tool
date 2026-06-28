const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('adb', {
  devices:      ()           => ipcRenderer.invoke('adb:devices'),
  run:          (cmd, serial)=> ipcRenderer.invoke('adb:run', { cmd, serial }),
  setPath:      (p)          => ipcRenderer.invoke('adb:setPath', p),
  loadConfig:   ()           => ipcRenderer.invoke('config:load'),
  saveConfig:   (cfg)        => ipcRenderer.invoke('config:save', cfg),
  exportConfig: ()           => ipcRenderer.invoke('config:export'),
  importConfig: ()           => ipcRenderer.invoke('config:import'),
  resetConfig:  ()           => ipcRenderer.invoke('config:reset'),
  stream: (id, cmd, serial, onData) => {
    ipcRenderer.on(`adb:stream:${id}`, (_, msg) => onData(msg))
    ipcRenderer.send('adb:stream', { id, cmd, serial })
  },
  streamKill: (id) => {
    ipcRenderer.removeAllListeners(`adb:stream:${id}`)
    ipcRenderer.send('adb:stream:kill', id)
  },
  probe: (hosts, port, timeoutMs) => ipcRenderer.invoke('net:probe', { hosts, port, timeoutMs }),
})
