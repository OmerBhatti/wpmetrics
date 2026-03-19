<img width="72" height="72" alt="image" align="center" src="https://github.com/user-attachments/assets/30cc95f8-aec5-49d8-9edf-4b97cd7c9e26" />
<h1>WPMetrics</h1>

WPMetrics is an Electron + React desktop app for typing analytics.

It tracks:
- Live WPM
- Today and 7-day word totals
- Productive typing hours
- App breakdown
- Hot keys
- Goal progress and milestone notifications

<img width="1256" height="621" alt="image" src="https://github.com/user-attachments/assets/f340411a-a24c-4462-b261-70fc9278ad0c" />


## Tech Stack

- Electron (main process + tray)
- React + Vite (renderer)
- Local JSON persistence (`typing-stats.json` in Electron `userData`)
- Optional global keyboard capture (`uiohook-napi`)

## Project Structure

```text
src/
  index.html
  main.jsx
  App.jsx
  styles.css
  main/
    main.js
    preload.js
    tracker.js
    global-capture.js
  assets/
    icons/
```

## Requirements

- Node.js 18+ (Node 20 recommended)
- npm
- macOS permissions for global tracking:
  - Input Monitoring
  - Accessibility/System Events (for app name detection)

## Install

```bash
npm install
```

## Run (Development)

```bash
npm run dev
```

This starts:
- Vite dev server (`http://127.0.0.1:5173`)
- Electron app with auto-restart for main process changes

## Build Renderer

```bash
npm run build
```

## Run Built App

```bash
npm start
```

## Notes

- If app names show as `Unknown App`, check macOS permissions.
- Tray icon and app icon files are under `src/assets/icons`.
- Global capture can be toggled from the app UI or tray menu.
