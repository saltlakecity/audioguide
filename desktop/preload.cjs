const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('presenter', {
  windows: () => ipcRenderer.invoke('windows'),
  arm: target => ipcRenderer.invoke('arm', target),
  stop: () => ipcRenderer.invoke('stop'),
  send: command => ipcRenderer.invoke('send', command),
  probe: () => ipcRenderer.invoke('probe'),
  capture: allowed => ipcRenderer.invoke('capture', allowed),
  onStop: callback => { const listener=()=>callback(); ipcRenderer.on('emergency-stop',listener); return ()=>ipcRenderer.removeListener('emergency-stop',listener) },
})
