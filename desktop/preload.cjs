const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jubenDesktop', {
  getSession: () => ipcRenderer.invoke('desktop:session'),
  getConfig: () => ipcRenderer.invoke('desktop:config'),
  saveConfig: values => ipcRenderer.invoke('desktop:save-config', values),
});
