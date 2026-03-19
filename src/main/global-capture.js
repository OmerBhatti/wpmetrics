const APP_REFRESH_INTERVAL_MS = 1200;
const { execFile } = require("child_process");

const NAME_TO_KEY = {
  Backspace: "Backspace",
  Tab: "Tab",
  Enter: "Enter",
  Space: " ",
  Semicolon: ";",
  Equal: "=",
  Comma: ",",
  Minus: "-",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  BracketLeft: "[",
  Backslash: "\\",
  BracketRight: "]",
  Quote: "'",
  NumpadDecimal: ".",
  NumpadDivide: "/",
  NumpadMultiply: "*",
  NumpadSubtract: "-",
  NumpadAdd: "+",
};

function buildKeyLookup(UiohookKey) {
  const keyLookup = {};
  if (!UiohookKey) return keyLookup;

  Object.entries(UiohookKey).forEach(([name, code]) => {
    if (!Number.isFinite(code)) return;

    if (/^[A-Z]$/.test(name)) {
      keyLookup[code] = name.toLowerCase();
      return;
    }

    if (/^[0-9]$/.test(name)) {
      keyLookup[code] = name;
      return;
    }

    if (/^Numpad[0-9]$/.test(name)) {
      keyLookup[code] = name.slice(-1);
      return;
    }

    const mapped = NAME_TO_KEY[name];
    if (mapped) keyLookup[code] = mapped;
  });

  return keyLookup;
}

function resolveUiohookPackage() {
  try {
    const pkg = require("uiohook-napi");
    return {
      hook: pkg.uIOhook || pkg,
      keyLookup: buildKeyLookup(pkg.UiohookKey || {}),
    };
  } catch (error) {
    return { error };
  }
}

function createMacAppDetector() {
  return () =>
    new Promise((resolve) => {
      execFile(
        "osascript",
        [
          "-e",
          'tell application "System Events" to get name of first application process whose frontmost is true',
        ],
        { timeout: 1500 },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }

          const name = String(stdout || "").trim();
          if (!name) {
            resolve(null);
            return;
          }

          resolve({ owner: { name } });
        }
      );
    });
}

function toKey(event, keyLookup) {
  if (!event) return "";

  const mapped = keyLookup[event.keycode];
  if (mapped) return mapped;

  const keychar = Number(event.keychar);
  if (Number.isFinite(keychar) && keychar > 0) {
    if (keychar === 13) return "Enter";
    try {
      return String.fromCodePoint(keychar);
    } catch {
      return "";
    }
  }

  return "";
}

class GlobalCapture {
  constructor(options) {
    this.onKeypress = options.onKeypress;
    this.onStatusChange = options.onStatusChange;
    this.hook = null;
    this.keyLookup = {};
    this.activeWinFn = null;
    this.listener = null;
    this.running = false;
    this.appName = "Unknown App";
    this.lastAppRefresh = 0;
    this.appRefreshInFlight = false;
    this.status = {
      available: false,
      active: false,
      reason: "Not initialized",
    };
  }

  updateStatus(nextStatus) {
    this.status = { ...this.status, ...nextStatus };
    this.onStatusChange(this.getStatus());
  }

  getStatus() {
    return { ...this.status };
  }

  async loadDependencies() {
    const hookPkg = resolveUiohookPackage();
    if (hookPkg.error) {
      this.updateStatus({
        available: false,
        active: false,
        reason: "uiohook-napi not available",
      });
      return false;
    }

    this.hook = hookPkg.hook;
    this.keyLookup = hookPkg.keyLookup || {};

    try {
      const activeWinModule = await import("active-win");
      this.activeWinFn = activeWinModule.default || activeWinModule;
    } catch {
      this.activeWinFn = process.platform === "darwin" ? createMacAppDetector() : null;
    }

    this.updateStatus({
      available: true,
      reason: this.activeWinFn
        ? "Ready"
        : "Ready (app detection unavailable)",
    });
    return true;
  }

  maybeRefreshAppName(now = Date.now()) {
    if (!this.activeWinFn) return;
    if (this.appRefreshInFlight) return;
    if (now - this.lastAppRefresh < APP_REFRESH_INTERVAL_MS) return;

    this.appRefreshInFlight = true;
    this.lastAppRefresh = now;
    Promise.resolve()
      .then(() => this.activeWinFn())
      .then((result) => {
        if (!result) return;
        this.appName = result.owner?.name || result.title || "Unknown App";
      })
      .catch(() => {
        this.appName = this.appName || "Unknown App";
      })
      .finally(() => {
        this.appRefreshInFlight = false;
      });
  }

  async start() {
    if (this.running) return this.getStatus();
    const loaded = await this.loadDependencies();
    if (!loaded || !this.hook) return this.getStatus();

    this.listener = (event) => {
      if (!event) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = toKey(event, this.keyLookup);
      if (!key) return;

      this.maybeRefreshAppName();
      this.onKeypress({
        key,
        code: event.keycode,
        timestamp: Date.now(),
        appName: this.appName || "Unknown App",
      });
    };

    try {
      this.hook.on("keydown", this.listener);
      this.hook.start();
      this.running = true;
      this.updateStatus({
        available: true,
        active: true,
        reason: this.activeWinFn
          ? "Global capture active"
          : "Global capture active (app detection unavailable)",
      });
    } catch {
      this.running = false;
      this.updateStatus({
        available: false,
        active: false,
        reason: "Failed to start global capture",
      });
    }

    return this.getStatus();
  }

  stop(reason = "Global capture disabled") {
    if (this.running && this.hook && this.listener) {
      try {
        this.hook.removeListener("keydown", this.listener);
        this.hook.stop();
      } catch {
        // no-op
      }
    }

    this.listener = null;
    this.running = false;
    this.updateStatus({
      active: false,
      reason,
    });

    return this.getStatus();
  }
}

module.exports = GlobalCapture;
