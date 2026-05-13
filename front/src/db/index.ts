import Dexie, { Table } from 'dexie'
import type { AppSettings } from '../types'

interface SettingRecord {
  key: string
  value: AppSettings
}

export class KnoPathDB extends Dexie {
  settings!: Table<SettingRecord>

  constructor() {
    super('KnoPathDB')
    this.version(1).stores({
      settings: 'key',
    })
    this.version(2).stores({
      settings: 'key',
    })
  }
}

export const db = new KnoPathDB()

export async function loadSettings(): Promise<AppSettings | undefined> {
  const record = await db.settings.get('app')
  return record?.value
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put({ key: 'app', value: settings })
}
