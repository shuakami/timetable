import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { Store, localStoragePersistence } from '../domain/store'
import { createSqlitePersistence } from '../domain/persistence/sqlite'

export function useStore() {
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.state,
  )
}
 
export let store: Store
 
export async function initStore(): Promise<Store> {
  if (store) return store
  if (Capacitor.isNativePlatform()) {
    try {
      store = new Store(await createSqlitePersistence())
      return store
    } catch (e) {
      console.error('sqlite init failed, falling back to localStorage', e)
    }
  }
  store = new Store(localStoragePersistence)
  return store
}
