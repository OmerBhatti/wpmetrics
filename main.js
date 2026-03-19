const path = require("path");
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
} = require("electron");
const TypingTracker = require("./tracker");
const GlobalCapture = require("./global-capture");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const trayIcon =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZQn0AAAAASUVORK5CYII=";

let mainWindow = null;
let tray = null;
let tracker = null;
let globalCapture = null;
let tickInterval = null;
let isQuitting = false;
let runtimeState = {
  globalCapturePreferred: true,
  globalCaptureAvailable: false,
  globalCaptureActive: false,
  globalCaptureReason: "Initializing",
  captureMode: "window",
};

function notifyMilestone(milestone) {
  if (!Notification.isSupported()) return;
  const title = milestone.level === "full" ? "Goal reached" : "Halfway there";
  const body =
    milestone.level === "full"
      ? `You reached ${milestone.goal} words today.`
      : `You crossed ${Math.round(milestone.goal * 0.5)} words today.`;
  new Notification({ title, body }).show();
}

function buildSnapshot() {
  if (!tracker) return null;
  return {
    ...tracker.getSnapshot(),
    runtime: { ...runtimeState },
  };
}

function refreshRuntimeState() {
  if (!tracker) return;
  const settings = tracker.getSettings();
  const captureStatus = globalCapture?.getStatus() || {
    available: false,
    active: false,
    reason: "Global capture unavailable",
  };

  runtimeState = {
    globalCapturePreferred: settings.preferGlobalCapture,
    globalCaptureAvailable: captureStatus.available,
    globalCaptureActive: captureStatus.active,
    globalCaptureReason: captureStatus.reason,
    captureMode: captureStatus.active ? "global" : "window",
  };
}

function getTrayTitle() {
  if (!tracker) return "WPM: 0";
  const wpm = Math.round(tracker.getLiveWpm());
  return `WPM: ${wpm}`;
}

function updateTrayDisplay() {
  if (!tray) return;
  if (process.platform === "darwin") tray.setTitle(getTrayTitle());
  tray.setToolTip(`Typing Stats - ${getTrayTitle()}`);
}

function sendSnapshotToWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const snapshot = buildSnapshot();
  if (!snapshot) return;
  mainWindow.webContents.send("typing:snapshot", snapshot);
}

async function applyGlobalCapturePreference(enabled) {
  if (!tracker || !globalCapture) return buildSnapshot();
  tracker.setPreferGlobalCapture(Boolean(enabled));

  if (enabled) {
    await globalCapture.start();
  } else {
    globalCapture.stop("Disabled by user");
  }

  refreshRuntimeState();
  rebuildTrayMenu();
  updateTrayDisplay();
  sendSnapshotToWindow();
  return buildSnapshot();
}

function rebuildTrayMenu() {
  if (!tray || !tracker) return;
  const snapshot = buildSnapshot();
  if (!snapshot) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: snapshot.trackingPaused ? "Resume Tracking" : "Pause Tracking",
      click: () => {
        tracker.setPaused(!snapshot.trackingPaused);
        sendSnapshotToWindow();
        updateTrayDisplay();
        rebuildTrayMenu();
      },
    },
    {
      label: "Use Global Capture",
      type: "checkbox",
      checked: snapshot.runtime.globalCapturePreferred,
      click: (menuItem) => {
        applyGlobalCapturePreference(menuItem.checked);
      },
    },
    {
      label: snapshot.runtime.globalCaptureActive
        ? "Global capture is active"
        : `Global capture: ${snapshot.runtime.globalCaptureReason}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function loadWindow(mainWindowRef) {
  if (devServerUrl) {
    mainWindowRef.loadURL(devServerUrl);
    return;
  }
  mainWindowRef.loadFile(path.join(__dirname, "dist", "index.html"));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    show: false,
    backgroundColor: "#eef2ff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadWindow(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  const icon = nativeImage.createFromDataURL(trayIcon);
  tray = new Tray(icon);
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
  updateTrayDisplay();
  rebuildTrayMenu();
}

function setupIpc() {
  ipcMain.on("typing:keypress", (_event, payload) => {
    if (runtimeState.globalCaptureActive) return;
    tracker.recordKeypress(payload);
    sendSnapshotToWindow();
    updateTrayDisplay();
  });

  ipcMain.handle("typing:getSnapshot", () => buildSnapshot());
  ipcMain.handle("typing:setGoal", (_event, goalWords) => {
    tracker.setGoalWords(goalWords);
    sendSnapshotToWindow();
    rebuildTrayMenu();
    return buildSnapshot();
  });
  ipcMain.handle("typing:setPaused", (_event, paused) => {
    tracker.setPaused(paused);
    sendSnapshotToWindow();
    updateTrayDisplay();
    rebuildTrayMenu();
    return buildSnapshot();
  });
  ipcMain.handle("typing:setGlobalCapturePreferred", (_event, preferred) =>
    applyGlobalCapturePreference(Boolean(preferred))
  );
}

function startTicker() {
  tickInterval = setInterval(() => {
    updateTrayDisplay();
    sendSnapshotToWindow();
  }, 1000);
}

app.whenReady().then(async () => {
  tracker = new TypingTracker({
    userDataPath: app.getPath("userData"),
    onMilestone: notifyMilestone,
  });

  globalCapture = new GlobalCapture({
    onKeypress: (payload) => {
      tracker.recordKeypress(payload);
      sendSnapshotToWindow();
      updateTrayDisplay();
    },
    onStatusChange: () => {
      refreshRuntimeState();
      rebuildTrayMenu();
      updateTrayDisplay();
      sendSnapshotToWindow();
    },
  });

  refreshRuntimeState();
  await applyGlobalCapturePreference(tracker.getSettings().preferGlobalCapture);

  createWindow();
  createTray();
  setupIpc();
  startTicker();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    if (mainWindow) mainWindow.show();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (tickInterval) clearInterval(tickInterval);
  if (globalCapture) globalCapture.stop("App quitting");
  if (tracker) tracker.flush();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
