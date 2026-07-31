# 🖼️ Slideshow App

A simple image slideshow desktop app built with Electron.

## Features

- Choose an image directory (subdirectories supported)
- Customizable transition interval (seconds)
- Random order, looping playback, and fade in/out effects
- Full-screen immersive playback
- Supported formats: jpg, jpeg, png, gif, webp, bmp

## Exiting Playback

During playback, you can exit in any of these ways:

- **Double-click** the left mouse button
- Press the **middle mouse button**
- (Extra) Press `Esc`

## Installation & Running

Install [Node.js](https://nodejs.org/) first. Open a terminal in this folder:

```bash
npm install
npm start
```

## Packaging into an exe (optional)

```bash
npm install --save-dev electron-builder
npx electron-builder --win
```

## File Structure

- `main.js` — Main process: window management, directory selection, image loading, full-screen playback window
- `preload.js` — Secure bridge (contextIsolation)
- `index.html` / `renderer.js` — Settings screen
- `slideshow.html` / `slideshow.js` — Playback screen (double-buffered fade in/out, exit logic)
