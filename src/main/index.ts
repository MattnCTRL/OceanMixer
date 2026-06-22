import { app, shell, BrowserWindow, session, Menu, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'

// Set the app name as early as possible so the macOS menu bar, About panel, and
// dock show "OceanMixer" instead of the bundle default ("Electron") in dev.
// Packaged builds also get this from electron-builder's productName.
app.setName('OceanMixer')
if (process.platform === 'darwin') process.title = 'OceanMixer'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/** Build a macOS-style application menu titled with the app name. */
function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: 'appMenu' as const }]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'OceanMixer on GitHub',
          click: () => shell.openExternal('https://github.com/MattnCTRL/OceanMixer')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0e14',
    title: 'OceanMixer',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // WebCodecs + large media decode happen in the renderer; keep it capable.
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    win.loadURL(rendererUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  app.setName('OceanMixer')
  app.setAboutPanelOptions({
    applicationName: 'OceanMixer',
    applicationVersion: app.getVersion(),
    credits: 'A free, local AI-assisted video/image/music mixer.'
  })
  buildAppMenu()

  // In dev we run the prebuilt Electron binary, so the dock shows Electron's
  // icon. Override it with the OceanMixer icon at runtime. (Packaged builds get
  // the icon from the bundle via electron-builder, so this is dev-focused.)
  if (process.platform === 'darwin' && app.dock) {
    try {
      const iconPath = join(app.getAppPath(), 'build', 'icon.png')
      if (existsSync(iconPath)) app.dock.setIcon(nativeImage.createFromPath(iconPath))
    } catch {
      /* non-fatal */
    }
  }

  // Allow microphone / audio capture for the in-app recorder. getUserMedia in
  // the renderer requests the 'media' permission; grant it (the OS still shows
  // its own microphone prompt on first use).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media'
  })

  // Local media files are loaded via custom protocol / file paths; register
  // all IPC handlers before any window can call them.
  registerIpcHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Allow the renderer to load local file:// media without tripping security in dev.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowed = process.env['ELECTRON_RENDERER_URL']
    if (allowed && url.startsWith(allowed)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
  })
})

void isDev
