import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LEGACY_PHOTOS_KEY = 'photo_galaxy_user_nodes_v1'
const MIGRATION_KEY = 'legacy-localstorage-migrated-v1'

class FakeRequest<T = unknown> {
  result!: T
  error: DOMException | null = null
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
}

class FakeDatabase {
  stores = new Map<string, Map<IDBValidKey, unknown>>()
  imageGetAllCount = 0
  corruptImageGetAllAt?: number
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  }

  createObjectStore(name: string, _options?: IDBObjectStoreParameters) {
    this.stores.set(name, new Map())
  }

  transaction(names: string | string[], mode: IDBTransactionMode) {
    return new FakeTransaction(
      this,
      typeof names === 'string' ? [names] : names,
      mode,
    )
  }

  close() {}
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  error: DOMException | null = null
  active = true
  pending = 0
  private completionScheduled = false

  constructor(
    readonly database: FakeDatabase,
    private readonly allowedStores: string[],
    private readonly mode: IDBTransactionMode,
  ) {
    queueMicrotask(() => {
      if (this.pending === 0) this.scheduleCompletion()
    })
  }

  objectStore(name: string) {
    if (!this.active)
      throw new DOMException('Transaction inactive', 'TransactionInactiveError')
    if (!this.allowedStores.includes(name))
      throw new DOMException('Store not in transaction', 'NotFoundError')
    return new FakeObjectStore(this, name)
  }

  request<T>(_name: string, operation: () => T) {
    if (!this.active)
      throw new DOMException('Transaction inactive', 'TransactionInactiveError')
    this.pending++
    const request = new FakeRequest<T>()
    setTimeout(() => {
      try {
        request.result = operation()
        request.onsuccess?.(new Event('success'))
      } catch (error) {
        request.error = error as DOMException
        request.onerror?.(new Event('error'))
        this.error = request.error
        this.onabort?.(new Event('abort'))
        this.active = false
        return
      }
      this.pending--
      if (this.pending === 0) this.scheduleCompletion()
    }, 0)
    return request
  }

  private scheduleCompletion() {
    if (this.completionScheduled) return
    this.completionScheduled = true
    setTimeout(() => {
      if (this.pending !== 0) {
        this.completionScheduled = false
        return
      }
      this.active = false
      this.oncomplete?.(new Event('complete'))
    }, 0)
  }

  getStore(name: string) {
    const store = this.database.stores.get(name)
    if (!store) throw new DOMException('Missing object store', 'NotFoundError')
    return store
  }

  get modeValue() {
    return this.mode
  }
}

class FakeObjectStore {
  constructor(
    private readonly transaction: FakeTransaction,
    private readonly name: string,
  ) {}

  get(key: IDBValidKey) {
    return this.transaction.request(this.name, () =>
      this.transaction.getStore(this.name).get(key),
    )
  }

  getAll() {
    return this.transaction.request(this.name, () => {
      let records = [...this.transaction.getStore(this.name).values()]
      if (this.name === 'images') {
        this.transaction.database.imageGetAllCount++
        if (
          this.transaction.database.imageGetAllCount ===
          this.transaction.database.corruptImageGetAllAt
        ) {
          records = records.map((record, index) =>
            index === 0
              ? {
                  ...(record as { id: number; blob: Blob }),
                  blob: delayedBlob(
                    'x'.repeat((record as { blob: Blob }).blob.size),
                    (record as { blob: Blob }).blob.type,
                  ),
                }
              : record,
          )
        }
      }
      return records
    })
  }

  add(value: { id?: IDBValidKey; key?: IDBValidKey }) {
    return this.write(value, true)
  }

  put(value: { id?: IDBValidKey; key?: IDBValidKey }) {
    return this.write(value, false)
  }

  delete(key: IDBValidKey) {
    return this.transaction.request(this.name, () =>
      this.transaction.getStore(this.name).delete(key),
    )
  }

  private write(
    value: { id?: IDBValidKey; key?: IDBValidKey },
    addOnly: boolean,
  ) {
    if (this.transaction.modeValue !== 'readwrite')
      throw new DOMException('Readonly transaction', 'ReadOnlyError')
    return this.transaction.request(this.name, () => {
      const key = value.id ?? value.key
      if (key === undefined) throw new DOMException('Missing key', 'DataError')
      const store = this.transaction.getStore(this.name)
      if (addOnly && store.has(key))
        throw new DOMException('Key exists', 'ConstraintError')
      store.set(key, value)
      return key
    })
  }
}

class FakeIndexedDB {
  database?: FakeDatabase
  corruptImageGetAllAt?: number

  open() {
    const request =
      new FakeRequest<FakeDatabase>() as FakeRequest<FakeDatabase> & {
        onupgradeneeded?: (event: Event) => void
      }
    setTimeout(() => {
      if (!this.database) {
        this.database = new FakeDatabase()
        this.database.corruptImageGetAllAt = this.corruptImageGetAllAt
        request.result = this.database
        request.onupgradeneeded?.(new Event('upgradeneeded'))
      } else {
        request.result = this.database
      }
      request.onsuccess?.(new Event('success'))
    }, 0)
    return request
  }
}

const delayedBlob = (value: string, type: string) => {
  const blob = new Blob([value], { type })
  const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0))
  Object.defineProperty(blob, 'arrayBuffer', {
    value: () =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        setTimeout(() => {
          try {
            resolve(bytes.buffer.slice(0) as ArrayBuffer)
          } catch (error) {
            reject(error)
          }
        }, 0)
      }),
  })
  return blob
}

const legacyPhotos = [1, 2].map((id) => ({
  id,
  title: `Photo ${id}`,
  caption: undefined,
  imageUrl: `data:image/jpeg;base64,photo-${id}`,
  tags: ['Test'],
  date: '2026-01-01',
}))

describe('IndexedDB photo migration verification', () => {
  let fakeIndexedDB: FakeIndexedDB
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    fakeIndexedDB = new FakeIndexedDB()
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      blob: async () => delayedBlob(url, 'image/jpeg'),
    }))
    vi.stubGlobal('indexedDB', fakeIndexedDB)
    vi.stubGlobal('fetch', fetchMock)
    const TestURL = class extends URL {}
    Object.assign(TestURL, {
      createObjectURL: vi.fn((blob: Blob) => `blob:test-${blob.size}`),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('URL', TestURL)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('migrates and byte-verifies multiple images before removing legacy data', async () => {
    localStorage.setItem(LEGACY_PHOTOS_KEY, JSON.stringify(legacyPhotos))
    const { initializeStoredPhotos } = await import('./photo-storage')

    const photos = await initializeStoredPhotos()

    expect(photos).toHaveLength(2)
    expect(photos.map((photo) => photo.id)).toEqual([1, 2])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fakeIndexedDB.database?.stores.get('images')?.size).toBe(2)
    expect(fakeIndexedDB.database?.stores.get('meta')?.has(MIGRATION_KEY)).toBe(
      true,
    )
    expect(localStorage.getItem(LEGACY_PHOTOS_KEY)).toBeNull()
  })

  it('keeps legacy data on verification failure and succeeds on retry', async () => {
    localStorage.setItem(LEGACY_PHOTOS_KEY, JSON.stringify(legacyPhotos))
    const { initializeStoredPhotos } = await import('./photo-storage')
    fakeIndexedDB.corruptImageGetAllAt = 2

    await expect(initializeStoredPhotos()).rejects.toThrow(
      'Photo migration verification failed',
    )
    const database = fakeIndexedDB.database
    expect(database).toBeDefined()
    expect(localStorage.getItem(LEGACY_PHOTOS_KEY)).not.toBeNull()
    expect(database?.stores.get('photos')?.size).toBe(2)
    expect(database?.stores.get('images')?.size).toBe(2)
    expect(database?.stores.get('meta')?.has(MIGRATION_KEY)).toBe(false)

    const photos = await initializeStoredPhotos()

    expect(photos).toHaveLength(2)
    expect(localStorage.getItem(LEGACY_PHOTOS_KEY)).toBeNull()
    expect(database?.stores.get('meta')?.has(MIGRATION_KEY)).toBe(true)
  })
})
