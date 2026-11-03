const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('relayDesktop', {
  platform: process.platform,
})
