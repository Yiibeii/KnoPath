export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>
  readDirectory: (dirPath: string) => Promise<Array<{ name: string; path: string; fullPath: string; content: string }>>
  writeFile: (filePath: string, content: string) => Promise<boolean>
  deleteFile: (filePath: string) => Promise<boolean>
  fileExists: (filePath: string) => Promise<boolean>
  getAppPath: () => Promise<string>
  isElectron: boolean
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.isElectron === true
}

export async function selectDirectoryElectron(): Promise<string | null> {
  if (!isElectron()) throw new Error('Not in Electron environment')
  return window.electronAPI!.selectDirectory()
}

export async function readDirectoryRecursiveElectron(dirPath: string): Promise<Array<{
  name: string
  path: string
  fullPath: string
  content: string
}>> {
  if (!isElectron()) throw new Error('Not in Electron environment')
  return window.electronAPI!.readDirectory(dirPath)
}

export async function writeFileElectron(filePath: string, content: string): Promise<boolean> {
  if (!isElectron()) throw new Error('Not in Electron environment')
  return window.electronAPI!.writeFile(filePath, content)
}

export async function deleteFileElectron(filePath: string): Promise<boolean> {
  if (!isElectron()) throw new Error('Not in Electron environment')
  return window.electronAPI!.deleteFile(filePath)
}

export async function pathExistsElectron(path: string): Promise<boolean> {
  if (!isElectron()) throw new Error('Not in Electron environment')
  return window.electronAPI!.fileExists(path)
}
