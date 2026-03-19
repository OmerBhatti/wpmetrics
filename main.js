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
const appIconPath = path.join(__dirname, "assets", "icons", "app-icon-512.png");
const trayIconPath = path.join(__dirname, "assets", "icons", "tray-icon.png");

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

function formatMetricNumber(value) {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  return safeValue.toLocaleString("en-US");
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

function getTrayTitle(snapshot) {
  if (!snapshot) return "WPM: 0";
  return `WPM: ${formatMetricNumber(snapshot.liveWpm)}`;
}

function getTrayTooltip(snapshot) {
  if (!snapshot) return "WPMetrics\nWPM: 0";

  const wpm = formatMetricNumber(snapshot.liveWpm);
  const todayWords = formatMetricNumber(snapshot.today.words);
  const weekWords = formatMetricNumber(snapshot.week.words);
  const goalWords = formatMetricNumber(snapshot.goal.words);
  const goalProgress = formatMetricNumber(snapshot.goal.progressPercent);
  const captureMode = snapshot.runtime.captureMode === "global" ? "Global" : "Window";
  const trackingStatus = snapshot.trackingPaused ? "Paused" : "Active";

  return [
    "WPMetrics",
    `WPM: ${wpm} (total ${todayWords} words today)`,
    `7-day: ${weekWords} words`,
    `Goal: ${goalProgress}% of ${goalWords} words`,
    `Capture: ${captureMode} | Tracking: ${trackingStatus}`,
  ].join("\n");
}

function updateTrayDisplay() {
  if (!tray) return;
  const snapshot = buildSnapshot();
  if (process.platform === "darwin") tray.setTitle(getTrayTitle(snapshot));
  tray.setToolTip(getTrayTooltip(snapshot));
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
    icon: appIconPath,
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
  let icon = nativeImage.createFromPath(trayIconPath);
  if (process.platform === "darwin") {
    icon = icon.resize({ width: 14, height: 14 });
    icon.setTemplateImage(true);
  }
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
  if (app.dock && typeof app.dock.setIcon === "function") {
    app.dock.setIcon(appIconPath);
  }

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
