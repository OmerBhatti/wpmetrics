const fs = require("fs");
const path = require("path");

const SAVE_DEBOUNCE_MS = 1000;
const LIVE_WINDOW_MS = 60_000;
const RETENTION_DAYS = 90;

function getDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function roundWords(chars) {
  return Number((chars / 5).toFixed(1));
}

function addDays(dateKey, delta) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return getDateKey(date.getTime());
}

function keyLabel(key) {
  if (key === " ") return "Space";
  if (typeof key !== "string" || key.length === 0) return "Unknown";
  return key.length === 1 ? key.toUpperCase() : key;
}

function estimateChars(key) {
  if (key === "Enter") return 1;
  if (typeof key !== "string") return 0;
  if (key.length === 1) return 1;
  return 0;
}

function newDay() {
  return {
    chars: 0,
    words: 0,
    apps: {},
    hours: {},
    keys: {},
  };
}

function defaultState() {
  return {
    days: {},
    settings: {
      paused: false,
      goalWords: 1000,
      preferGlobalCapture: true,
    },
    milestones: {},
  };
}

class TypingTracker {
  constructor(options) {
    this.filePath = path.join(options.userDataPath, "typing-stats.json");
    this.onMilestone = options.onMilestone;
    this.state = this.loadState();
    this.liveEvents = [];
    this.saveTimer = null;
  }

  loadState() {
    try {
      if (!fs.existsSync(this.filePath)) return defaultState();
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        ...defaultState(),
        ...parsed,
        settings: {
          ...defaultState().settings,
          ...(parsed.settings || {}),
        },
      };
    } catch {
      return defaultState();
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  flush() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  ensureDay(dateKey) {
    if (!this.state.days[dateKey]) this.state.days[dateKey] = newDay();
    return this.state.days[dateKey];
  }

  pruneOldDays(todayKey) {
    const minKeepKey = addDays(todayKey, -RETENTION_DAYS);
    Object.keys(this.state.days).forEach((dateKey) => {
      if (dateKey < minKeepKey) delete this.state.days[dateKey];
    });
  }

  pruneLive(now = Date.now()) {
    const cutoff = now - LIVE_WINDOW_MS;
    while (this.liveEvents.length > 0 && this.liveEvents[0].timestamp < cutoff) {
      this.liveEvents.shift();
    }
  }

  getLiveWpm(now = Date.now()) {
    this.pruneLive(now);
    const chars = this.liveEvents.reduce((sum, event) => sum + event.chars, 0);
    return Number((chars / 5).toFixed(1));
  }

  getTodayWords(dateKey) {
    return this.state.days[dateKey]?.words || 0;
  }

  checkMilestones(dateKey) {
    const goal = Math.max(1, Number(this.state.settings.goalWords) || 1);
    const words = this.getTodayWords(dateKey);
    if (!this.state.milestones[dateKey]) {
      this.state.milestones[dateKey] = { half: false, full: false };
    }

    const dayMilestones = this.state.milestones[dateKey];
    if (!dayMilestones.half && words >= goal * 0.5) {
      dayMilestones.half = true;
      this.onMilestone({
        level: "half",
        goal,
        words,
      });
    }

    if (!dayMilestones.full && words >= goal) {
      dayMilestones.full = true;
      this.onMilestone({
        level: "full",
        goal,
        words,
      });
    }
  }

  recordKeypress(payload) {
    if (this.state.settings.paused) return;

    const timestamp = Number(payload?.timestamp) || Date.now();
    const key = payload?.key || "";
    const appName = payload?.appName || "WPMetrics";
    const chars = estimateChars(key);
    const dateKey = getDateKey(timestamp);
    const day = this.ensureDay(dateKey);
    const hour = String(new Date(timestamp).getHours());

    const label = keyLabel(key);
    day.keys[label] = (day.keys[label] || 0) + 1;

    if (chars > 0) {
      day.chars += chars;
      day.words = roundWords(day.chars);
      day.apps[appName] = (day.apps[appName] || 0) + chars;
      day.hours[hour] = (day.hours[hour] || 0) + chars;
      this.liveEvents.push({ timestamp, chars });
      this.pruneLive(timestamp);
      this.checkMilestones(dateKey);
    }

    this.pruneOldDays(dateKey);
    this.scheduleSave();
  }

  setGoalWords(goalWords) {
    const parsed = Number(goalWords);
    if (!Number.isFinite(parsed) || parsed <= 0) return this.getSnapshot();
    this.state.settings.goalWords = Math.round(parsed);
    this.scheduleSave();
    return this.getSnapshot();
  }

  setPaused(paused) {
    this.state.settings.paused = Boolean(paused);
    this.scheduleSave();
    return this.getSnapshot();
  }

  setPreferGlobalCapture(preferGlobalCapture) {
    this.state.settings.preferGlobalCapture = Boolean(preferGlobalCapture);
    this.scheduleSave();
  }

  clearProgress() {
    this.state.days = {};
    this.state.milestones = {};
    this.liveEvents = [];
    this.scheduleSave();
    return this.getSnapshot();
  }

  getSettings() {
    return { ...this.state.settings };
  }

  getWeekSummary(todayKey) {
    let weekChars = 0;
    for (let i = 0; i < 7; i += 1) {
      const key = addDays(todayKey, -i);
      weekChars += this.state.days[key]?.chars || 0;
    }
    return {
      chars: weekChars,
      words: roundWords(weekChars),
    };
  }

  getSnapshot() {
    const now = Date.now();
    const todayKey = getDateKey(now);
    const day = this.ensureDay(todayKey);
    const week = this.getWeekSummary(todayKey);
    const goalWords = this.state.settings.goalWords;
    const progress = Math.min(100, Number(((day.words / goalWords) * 100).toFixed(1)));

    const appBreakdown = Object.entries(day.apps)
      .map(([name, chars]) => ({ name, chars, words: roundWords(chars) }))
      .sort((a, b) => b.chars - a.chars);

    const productiveHours = Object.entries(day.hours)
      .map(([hour, chars]) => ({ hour: Number(hour), chars, words: roundWords(chars) }))
      .sort((a, b) => a.hour - b.hour);

    const keyHeatmap = Object.entries(day.keys)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 40);

    const topHour =
      productiveHours.length === 0
        ? null
        : productiveHours.reduce((best, hour) => (hour.chars > best.chars ? hour : best));

    return {
      trackingPaused: this.state.settings.paused,
      liveWpm: this.getLiveWpm(now),
      today: {
        date: todayKey,
        chars: day.chars,
        words: day.words,
      },
      week,
      goal: {
        words: goalWords,
        progressPercent: Number.isFinite(progress) ? progress : 0,
      },
      appBreakdown,
      productiveHours,
      topHour,
      keyHeatmap,
    };
  }
}

module.exports = TypingTracker;
