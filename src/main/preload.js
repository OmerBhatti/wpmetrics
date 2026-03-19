const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("typing", {
  sendKeypress: (payload) => ipcRenderer.send("typing:keypress", payload),
  getSnapshot: () => ipcRenderer.invoke("typing:getSnapshot"),
  setGoal: (goalWords) => ipcRenderer.invoke("typing:setGoal", goalWords),
  setPaused: (paused) => ipcRenderer.invoke("typing:setPaused", paused),
  clearProgress: () => ipcRenderer.invoke("typing:clearProgress"),
  setGlobalCapturePreferred: (preferred) =>
    ipcRenderer.invoke("typing:setGlobalCapturePreferred", preferred),
  onSnapshot: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("typing:snapshot", listener);
    return () => ipcRenderer.removeListener("typing:snapshot", listener);
  },
});
