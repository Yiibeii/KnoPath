const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow = null;
let backendProcess = null;
let spawnedPids = [];
let isCleaningUp = false;

function killProcessTree(pid) {
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } catch (e) {
      try { process.kill(pid); } catch (_) {}
    }
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (_) {
      try { process.kill(pid, 'SIGKILL'); } catch (__) {}
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, 'assets/icon256.png'),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3010');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startBackendServer() {
  const appPath = app.getAppPath();
  let backendPath;
  let pythonEmbedPath;

  if (isDev) {
    backendPath = path.join(appPath, '..', 'app');
    pythonEmbedPath = path.join(appPath, '..', 'python-embed');
  } else {
    backendPath = path.join(process.resourcesPath, 'app');
    pythonEmbedPath = path.join(process.resourcesPath, 'python-embed');
  }

  console.log(`[Electron] App path: ${appPath}`);
  console.log(`[Electron] Backend path: ${backendPath}`);
  console.log(`[Electron] Python embed path: ${pythonEmbedPath}`);

  const uvicornArgs = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'];

  const pythonExePath = path.join(pythonEmbedPath, 'python.exe');
  const hasEmbedPython = fs.existsSync(pythonExePath);

  console.log(`[Electron] Embedded Python exists: ${hasEmbedPython}`);

  if (hasEmbedPython) {
    const markerFile = path.join(pythonEmbedPath, '.knopath-deps-installed');
    if (!fs.existsSync(markerFile)) {
      console.log('[Electron] First run detected - installing dependencies...');
      const requirementsFile = path.join(backendPath, 'requirements.txt');
      if (fs.existsSync(requirementsFile)) {
        try {
          const pipPath = path.join(pythonEmbedPath, 'Scripts', 'pip.exe');
          const pipCmd = fs.existsSync(pipPath) ? pipPath : pythonExePath;
          const pipArgs = fs.existsSync(pipPath)
            ? ['install', '-r', requirementsFile, '--no-warn-script-location']
            : ['-m', 'pip', 'install', '-r', requirementsFile, '--no-warn-script-location'];
          
          const result = require('child_process').spawnSync(pipCmd, pipArgs, {
            cwd: pythonEmbedPath,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
            stdio: 'pipe',
            timeout: 300000,
          });

          if (result.status === 0) {
            fs.writeFileSync(markerFile, new Date().toISOString());
            console.log('[Electron] Dependencies installed successfully.');
          } else {
            console.error('[Electron] Failed to install dependencies:', result.stderr?.toString());
          }
        } catch (err) {
          console.error('[Electron] Error installing dependencies:', err);
        }
      }
    }
  }

  // Only use Embedded Python - no fallback to system Python
  if (!hasEmbedPython) {
    console.error('[Electron] Embedded Python not found at:', pythonExePath);
    if (mainWindow) {
      mainWindow.webContents.send('backend-status', {
        ready: false,
        error: 'Embedded Python not found. Please rebuild the application.'
      });
    }
    return;
  }

  const pythonCommands = [{ cmd: pythonExePath, args: uvicornArgs, isEmbed: true }];

  let currentPythonIndex = 0;
  let backendReady = false;

  function tryStartWithPython(index) {
    if (index >= pythonCommands.length) {
      console.error('[Electron] Embedded Python failed to start. Backend will not start.');
      if (mainWindow) {
        mainWindow.webContents.send('backend-status', {
          ready: false,
          error: 'Embedded Python failed to start. Please rebuild the application.'
        });
      }
      return;
    }

    const { cmd, args } = pythonCommands[index];
    currentPythonIndex = index;
    console.log(`[Electron] Trying command: ${cmd} ${args.join(' ')}`);

    const embedDir = path.dirname(cmd);
    const spawnEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONPATH: `${backendPath};${path.join(embedDir, 'Lib', 'site-packages')}`,
      PATH: `${embedDir};${process.env.PATH || ''}`
    };

    backendProcess = spawn(cmd, args, {
      cwd: backendPath,
      env: spawnEnv,
      shell: false,
    });

    spawnedPids.push(backendProcess.pid);
    console.log(`[Electron] Spawned process PID: ${backendProcess.pid}`);

    let hasOutput = false;

    backendProcess.stdout.on('data', (data) => {
      const output = typeof data === 'string' ? data : data.toString('utf-8');
      console.log(`[Backend] ${output}`);
      if (output.includes('Uvicorn running') || output.includes('Application startup complete')) {
        backendReady = true;
        if (mainWindow) {
          mainWindow.webContents.send('backend-status', { ready: true });
        }
      }
      hasOutput = true;
    });

    backendProcess.stderr.on('data', (data) => {
      const output = typeof data === 'string' ? data : data.toString('utf-8');
      console.error(`[Backend Error] ${output}`);
      if (output.includes('Uvicorn running') || output.includes('Application startup complete')) {
        backendReady = true;
        if (mainWindow) {
          mainWindow.webContents.send('backend-status', { ready: true });
        }
      }
      hasOutput = true;
    });

    backendProcess.on('error', (err) => {
      console.error(`[Backend] Failed with command '${cmd}': ${err.message}`);
      if (backendProcess) {
        spawnedPids = spawnedPids.filter(p => p !== backendProcess.pid);
      }
      backendProcess = null;
      if (index < pythonCommands.length - 1) {
        console.log(`[Electron] Trying next Python command...`);
        tryStartWithPython(index + 1);
      }
    });

    backendProcess.on('close', (code) => {
      console.log(`[Backend] Process exited with code ${code}`);
      spawnedPids = spawnedPids.filter(p => p !== backendProcess.pid);
      backendProcess = null;
      
      if (!backendReady && code !== 0 && index < pythonCommands.length - 1) {
        console.log(`[Electron] Backend failed to start, trying next Python command...`);
        tryStartWithPython(index + 1);
      } else if (!backendReady) {
        console.error('[Electron] All Python commands failed. Backend will not start.');
        if (mainWindow) {
          mainWindow.webContents.send('backend-status', { 
            ready: false, 
            error: 'Backend failed to start. Check console for details.' 
          });
        }
      }
    });
  }

  tryStartWithPython(0);
}

function stopBackendServer() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  if (backendProcess) {
    killProcessTree(backendProcess.pid);
    backendProcess = null;
  }

  for (const pid of spawnedPids) {
    killProcessTree(pid);
  }
  spawnedPids = [];

  isCleaningUp = false;
}

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Repository Directory',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('read-directory', async (event, dirPath) => {
  try {
    const files = [];

    function readDirRecursive(currentPath, basePath = '') {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          readDirRecursive(fullPath, relativePath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            files.push({ name: entry.name, path: relativePath, fullPath, content });
          } catch (err) {
            console.error(`Error reading file ${fullPath}:`, err);
          }
        }
      }
    }

    readDirRecursive(dirPath);
    return files;
  } catch (error) {
    console.error('Error reading directory:', error);
    throw error;
  }
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Error writing file:', error);
    throw error;
  }
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
});

ipcMain.handle('file-exists', async (event, filePath) => {
  return fs.existsSync(filePath);
});

ipcMain.handle('get-app-path', () => {
  return app.getPath('userData');
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

app.whenReady().then(() => {
  createWindow();
  startBackendServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackendServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackendServer();
});

process.on('SIGINT', () => {
  stopBackendServer();
  app.quit();
});

process.on('SIGTERM', () => {
  stopBackendServer();
  app.quit();
});

process.on('exit', () => {
  if (backendProcess || spawnedPids.length > 0) {
    if (backendProcess) {
      killProcessTree(backendProcess.pid);
    }
    for (const pid of spawnedPids) {
      killProcessTree(pid);
    }
  }
});
