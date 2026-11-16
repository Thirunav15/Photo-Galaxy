import { type PhotoNode, SEED_PHOTOS } from './photos'

const DATABASE_NAME = 'photo-galaxy-storage'
const DATABASE_VERSION = 1
const PHOTO_STORE = 'photos'
const IMAGE_STORE = 'images'
const META_STORE = 'meta'
const MIGRATION_KEY = 'legacy-localstorage-migrated-v1'

export const LEGACY_PHOTOS_KEY = 'photo_galaxy_user_nodes_v1'

type StoredPhoto = Omit<PhotoNode, 'imageUrl'> & {
  imageUrl?: string
  imageKind: 'blob' | 'url'
}

type StoredImage = { id: number; blob: Blob }
type PhotoMeta = { key: string; value: boolean }
export type NewPhotoRecord = Omit<PhotoNode, 'id' | 'imageUrl'> & {
  imageBlob: Blob
}

let databasePromise: Promise<IDBDatabase> | undefined
const imageObjectUrls = new Map<number, string>()

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const url of imageObjectUrls.values()) URL.revokeObjectURL(url)
    imageObjectUrls.clear()
  })
}

const openDatabase = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new Error('IndexedDB is unavailable in this browser.'),
    )
  }
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PHOTO_STORE))
        db.createObjectStore(PHOTO_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(IMAGE_STORE))
        db.createObjectStore(IMAGE_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META_STORE))
        db.createObjectStore(META_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        databasePromise = undefined
      }
      resolve(db)
    }
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open photo storage.'))
    request.onblocked = () =>
      reject(
        new Error(
          'Photo storage is busy in another tab. Close other Photo Galaxy tabs and retry.',
        ),
      )
  })
  databasePromise.catch(() => {
    databasePromise = undefined
  })
  return databasePromise
}

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error('Photo storage transaction was aborted.'),
      )
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error('Photo storage transaction failed.'),
      )
  })

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Photo storage request failed.'))
  })

const storageError = (error: unknown): Error => {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new Error(
      'Photo storage is full. Your saved photos are safe. Free space used by other sites or files without clearing Photo Galaxy data, then retry.',
    )
  }
  if (error instanceof Error) return error
  return new Error(
    'Photo storage could not be updated. Your existing photos were kept.',
  )
}

const parseLegacyPhotos = (raw: string | null): PhotoNode[] => {
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed))
    throw new Error(
      'The saved gallery data is invalid. It has been left untouched.',
    )
  const legacy = parsed.filter((entry) => {
    const photo = entry as Partial<PhotoNode> | null
    return !SEED_PHOTOS.some(
      (seed) =>
        seed.title === photo?.title && seed.imageUrl === photo?.imageUrl,
    )
  })
  if (
    legacy.some((entry) => {
      const photo = entry as Partial<PhotoNode> | null
      return (
        typeof photo?.id !== 'number' ||
        typeof photo?.title !== 'string' ||
        typeof photo?.imageUrl !== 'string' ||
        photo.imageUrl.startsWith('blob:') ||
        !Array.isArray(photo?.tags) ||
        typeof photo?.date !== 'string'
      )
    })
  ) {
    throw new Error(
      'A saved photo record is incomplete or references a temporary image. The original gallery has been left untouched.',
    )
  }
  return legacy as PhotoNode[]
}

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  if (!/^data:[^,]+,/i.test(dataUrl)) {
    throw new Error(
      'A saved photo has an unsupported data URL. The original gallery is still intact.',
    )
  }
  const response = await fetch(dataUrl)
  if (!response.ok)
    throw new Error(
      'A saved photo could not be read. The original gallery is still intact.',
    )
  return response.blob()
}

const blobsMatch = async (left: Blob, right: Blob): Promise<boolean> => {
  if (left.size !== right.size || left.type !== right.type) return false
  const [leftBuffer, rightBuffer] = await Promise.all([
    left.arrayBuffer(),
    right.arrayBuffer(),
  ])
  const leftBytes = new Uint8Array(leftBuffer)
  const rightBytes = new Uint8Array(rightBuffer)
  return leftBytes.every((byte, index) => byte === rightBytes[index])
}

const asStoredPhoto = (photo: PhotoNode): StoredPhoto => {
  const { imageUrl, ...metadata } = photo
  const isObjectUrl = imageUrl.startsWith('blob:')
  return {
    ...metadata,
    imageKind: isObjectUrl ? 'blob' : 'url',
    ...(isObjectUrl ? {} : { imageUrl }),
  }
}

const migrateLegacyPhotos = async (db: IDBDatabase): Promise<void> => {
  const raw = localStorage.getItem(LEGACY_PHOTOS_KEY)
  if (!raw) return

  const checkTx = db.transaction(META_STORE, 'readonly')
  const checkDone = transactionDone(checkTx)
  const migration = await requestResult<PhotoMeta | undefined>(
    checkTx.objectStore(META_STORE).get(MIGRATION_KEY),
  )
  await checkDone
  if (migration?.value) {
    localStorage.removeItem(LEGACY_PHOTOS_KEY)
    return
  }

  const legacyPhotos = parseLegacyPhotos(raw)
  const converted = await Promise.all(
    legacyPhotos.map(async (photo) => ({
      photo,
      blob: photo.imageUrl.startsWith('data:')
        ? await dataUrlToBlob(photo.imageUrl)
        : undefined,
    })),
  )

  const existingTx = db.transaction([PHOTO_STORE, IMAGE_STORE], 'readonly')
  const existingDone = transactionDone(existingTx)
  const [existingPhotos, existingImages] = await Promise.all([
    requestResult<StoredPhoto[]>(existingTx.objectStore(PHOTO_STORE).getAll()),
    requestResult<StoredImage[]>(existingTx.objectStore(IMAGE_STORE).getAll()),
  ])
  await existingDone
  const photosById = new Map(existingPhotos.map((photo) => [photo.id, photo]))
  const imagesById = new Map(
    existingImages.map((image) => [image.id, image.blob]),
  )
  const recordsToWrite: Array<{
    photo: StoredPhoto
    imageBlob?: Blob
  }> = []
  for (const { photo, blob } of converted) {
    const expected: StoredPhoto = blob
      ? {
          ...asStoredPhoto({ ...photo, imageUrl: 'blob:migrated' }),
          imageKind: 'blob',
        }
      : { ...photo, imageKind: 'url' }
    const existingPhoto = photosById.get(photo.id)
    const existingBlob = imagesById.get(photo.id)
    if (existingPhoto || existingBlob) {
      const matchingImage = blob
        ? existingBlob
          ? await blobsMatch(existingBlob, blob)
          : false
        : !existingBlob
      if (
        !existingPhoto ||
        JSON.stringify(existingPhoto) !== JSON.stringify(expected) ||
        !matchingImage
      ) {
        throw new Error(
          `Photo ID ${photo.id} already exists in IndexedDB with different data. The original gallery was left untouched.`,
        )
      }
      continue
    }
    recordsToWrite.push({ photo: expected, imageBlob: blob })
  }

  const tx = db.transaction([PHOTO_STORE, IMAGE_STORE], 'readwrite')
  const done = transactionDone(tx)
  const photos = tx.objectStore(PHOTO_STORE)
  const images = tx.objectStore(IMAGE_STORE)
  for (const { photo, imageBlob } of recordsToWrite) {
    photos.add(photo)
    if (imageBlob)
      images.add({ id: photo.id, blob: imageBlob } satisfies StoredImage)
  }
  await done

  // Read every migrated image back before recording success or touching legacy data.
  const verifyTx = db.transaction(IMAGE_STORE, 'readonly')
  const verifyDone = transactionDone(verifyTx)
  const verifyStore = verifyTx.objectStore(IMAGE_STORE)
  let verified = true
  for (const { photo, blob } of converted) {
    if (!blob) continue
    const stored = await requestResult<StoredImage | undefined>(
      verifyStore.get(photo.id),
    )
    if (
      !stored?.blob ||
      stored.blob.size !== blob.size ||
      stored.blob.type !== blob.type
    ) {
      verified = false
      break
    }
    if (!(await blobsMatch(blob, stored.blob))) {
      verified = false
      break
    }
  }
  await verifyDone
  if (!verified) {
    throw new Error(
      'Photo migration verification failed. Your original saved gallery is still intact; retry to continue.',
    )
  }

  const markTx = db.transaction(META_STORE, 'readwrite')
  const markDone = transactionDone(markTx)
  markTx
    .objectStore(META_STORE)
    .put({ key: MIGRATION_KEY, value: true } satisfies PhotoMeta)
  await markDone
  localStorage.removeItem(LEGACY_PHOTOS_KEY)
}

const loadAllPhotos = async (db: IDBDatabase): Promise<PhotoNode[]> => {
  const tx = db.transaction([PHOTO_STORE, IMAGE_STORE], 'readonly')
  const done = transactionDone(tx)
  const [storedPhotos, storedImages] = await Promise.all([
    requestResult<StoredPhoto[]>(tx.objectStore(PHOTO_STORE).getAll()),
    requestResult<StoredImage[]>(tx.objectStore(IMAGE_STORE).getAll()),
  ])
  await done
  const images = new Map(storedImages.map((image) => [image.id, image.blob]))
  const missing = storedPhotos.find(
    (stored) => stored.imageKind === 'blob' && !images.has(stored.id),
  )
  if (missing) {
    throw new Error(
      `The saved image for “${missing.title}” is missing. The remaining gallery data was kept.`,
    )
  }

  return storedPhotos.map((stored) => {
    if (stored.imageKind === 'url' && stored.imageUrl)
      return stored as PhotoNode
    const blob = images.get(stored.id)
    if (!blob)
      throw new Error(
        `The saved image for “${stored.title}” is missing. The remaining gallery data was kept.`,
      )
    const previousUrl = imageObjectUrls.get(stored.id)
    const imageUrl = previousUrl ?? URL.createObjectURL(blob)
    imageObjectUrls.set(stored.id, imageUrl)
    const { imageKind: _imageKind, ...metadata } = stored
    return { ...metadata, imageUrl }
  })
}

export const initializeStoredPhotos = async (): Promise<PhotoNode[]> => {
  try {
    const db = await openDatabase()
    await migrateLegacyPhotos(db)
    return await loadAllPhotos(db)
  } catch (error) {
    throw storageError(error)
  }
}

export const persistNewPhotos = async (
  photos: Array<{ photo: PhotoNode; imageBlob?: Blob }>,
): Promise<PhotoNode[]> => {
  let prepared: Array<{
    photo: PhotoNode
    imageBlob?: Blob
    imageUrl: string
  }> = []
  try {
    const db = await openDatabase()
    prepared = photos.map(({ photo, imageBlob }) => ({
      photo,
      imageBlob,
      imageUrl: imageBlob ? URL.createObjectURL(imageBlob) : photo.imageUrl,
    }))
    const tx = db.transaction([PHOTO_STORE, IMAGE_STORE], 'readwrite')
    const done = transactionDone(tx)
    const photoStore = tx.objectStore(PHOTO_STORE)
    const imageStore = tx.objectStore(IMAGE_STORE)
    for (const { photo, imageBlob } of prepared) {
      const stored = imageBlob
        ? {
            ...asStoredPhoto({ ...photo, imageUrl: 'blob:pending' }),
            imageKind: 'blob' as const,
          }
        : asStoredPhoto(photo)
      photoStore.put(stored)
      if (imageBlob)
        imageStore.put({ id: photo.id, blob: imageBlob } satisfies StoredImage)
    }
    await done
    for (const { photo, imageBlob, imageUrl } of prepared) {
      if (imageBlob) imageObjectUrls.set(photo.id, imageUrl)
    }
    return prepared.map(({ photo, imageBlob, imageUrl }) =>
      imageBlob ? { ...photo, imageUrl } : photo,
    )
  } catch (error) {
    for (const { imageBlob, imageUrl } of prepared) {
      if (imageBlob) URL.revokeObjectURL(imageUrl)
    }
    throw storageError(error)
  }
}

export const persistPhotoMetadata = async (
  photos: PhotoNode[],
): Promise<void> => {
  try {
    const db = await openDatabase()
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore(PHOTO_STORE)
    for (const photo of photos) store.put(asStoredPhoto(photo))
    await done
  } catch (error) {
    throw storageError(error)
  }
}

export const removePersistedPhotos = async (ids: number[]): Promise<void> => {
  try {
    const db = await openDatabase()
    const tx = db.transaction([PHOTO_STORE, IMAGE_STORE], 'readwrite')
    const done = transactionDone(tx)
    const photos = tx.objectStore(PHOTO_STORE)
    const images = tx.objectStore(IMAGE_STORE)
    for (const id of ids) {
      photos.delete(id)
      images.delete(id)
    }
    await done
    for (const id of ids) {
      const url = imageObjectUrls.get(id)
      if (url) URL.revokeObjectURL(url)
      imageObjectUrls.delete(id)
    }
  } catch (error) {
    throw storageError(error)
  }
}

export const explainPhotoStorageError = (error: unknown): string =>
  storageError(error).message
