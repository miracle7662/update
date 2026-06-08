const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getBills: (date) => ipcRenderer.invoke("get-bills", date),
  getBillDetails: (txnId) =>
    ipcRenderer.invoke("get-bill-details", txnId),
});