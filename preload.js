const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  name: "Project 1",
  env: process.env.NODE_ENV || "development",
});
