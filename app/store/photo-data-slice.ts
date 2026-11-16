import type { StateCreator } from 'zustand'
import {
  type NewPhotoRecord,
  explainPhotoStorageError,
  initializeStoredPhotos,
  persistNewPhotos,
  persistPhotoMetadata,
  removePersistedPhotos,
} from '../vf/utils/photo-storage'
import {
  type PhotoNode,
  clusterPhotosByTagOrDate,
  loadFavoritePhotoIds,
  persistFavoritePhotoIds,
} from '../vf/utils/photos'

export interface PhotoDataSlice {
  photos: PhotoNode[]
  photoStorageReady: boolean
  photoStorageError?: string
  initializePhotoStorage: () => Promise<void>
  retryPhotoStorage: () => Promise<void>
  favoritePhotoIds: number[]
  toggleFavoritePhoto: (id: number) => void
  setPhotos: (photos: PhotoNode[]) => Promise<void>
  activePhoto?: PhotoNode
  setActivePhoto: (photo?: PhotoNode) => void
  addPhoto: (newPhotoData: NewPhotoRecord) => Promise<PhotoNode>
  addPhotos: (newPhotosData: NewPhotoRecord[]) => Promise<PhotoNode[]>
  deletePhoto: (id: number) => Promise<void>
  deletePhotos: (ids: number[]) => Promise<void>
  updatePhotoTags: (id: number, tags: string[]) => Promise<void>
  updatePhotoDetails: (
    id: number,
    details: Partial<
      Pick<PhotoNode, 'title' | 'caption' | 'date' | 'location' | 'tags'>
    >,
  ) => Promise<void>
  searchQuery: string
  setSearchQuery: (query: string) => void
  activeFilterTag?: string
  setActiveFilterTag: (tag?: string) => void
  uploadModalOpen: boolean
  setUploadModalOpen: (open: boolean) => void
  pendingUploadFile?: File
  setPendingUploadFile: (file?: File) => void
  pendingUploadBatch?: File[]
  setPendingUploadBatch: (files?: File[]) => void
  editTagsModalOpen: boolean
  setEditTagsModalOpen: (open: boolean) => void
}

const fallbackPhotos = (): PhotoNode[] => {
  try {
    const raw = localStorage.getItem('photo_galaxy_user_nodes_v1')
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter(
          (photo): photo is PhotoNode =>
            typeof photo?.id === 'number' &&
            typeof photo?.title === 'string' &&
            typeof photo?.imageUrl === 'string' &&
            Array.isArray(photo?.tags) &&
            typeof photo?.date === 'string',
        )
      : []
  } catch {
    return []
  }
}

export const createPhotoDataSlice: StateCreator<
  PhotoDataSlice,
  [],
  [],
  PhotoDataSlice
> = (set, get) => {
  const ensureStorageReady = () => {
    const state = get()
    if (!state.photoStorageReady || state.photoStorageError) {
      throw new Error(
        state.photoStorageError ||
          'Photo storage is still initializing. Retry before making changes.',
      )
    }
  }

  const initialize = async () => {
    set({ photoStorageReady: false })
    try {
      const photos = clusterPhotosByTagOrDate(await initializeStoredPhotos())
      set({
        photos,
        activePhoto: photos[0],
        photoStorageReady: true,
        photoStorageError: undefined,
      })
    } catch (error) {
      const message = explainPhotoStorageError(error)
      const photos = clusterPhotosByTagOrDate(fallbackPhotos())
      set({
        photos,
        activePhoto: photos[0],
        photoStorageReady: true,
        photoStorageError: message,
      })
    }
  }

  return {
    photos: [],
    photoStorageReady: false,
    photoStorageError: undefined,
    initializePhotoStorage: initialize,
    retryPhotoStorage: initialize,
    setPhotos: async (photos) => {
      ensureStorageReady()
      if (get().photos.length > 0) {
        throw new Error(
          'The gallery can only be initialized with sample photos when it is empty.',
        )
      }
      const saved = await persistNewPhotos(photos.map((photo) => ({ photo })))
      set({ photos: saved, activePhoto: saved[0] })
    },
    activePhoto: undefined,
    setActivePhoto: (photo) => set({ activePhoto: photo }),
    addPhoto: async (newPhotoData) => {
      const [photo] = await get().addPhotos([newPhotoData])
      return photo
    },
    addPhotos: async (newPhotosData) => {
      ensureStorageReady()
      if (newPhotosData.length === 0) return []
      const current = get().photos
      const nextId =
        current.reduce(
          (max, photo) => Math.max(max, Number(photo.id) || 0),
          0,
        ) + 1
      const nextCellId =
        current.reduce(
          (max, photo, index) => Math.max(max, photo.cellId ?? index),
          -1,
        ) + 1
      const entries = newPhotosData.map(({ imageBlob, ...photo }, index) => ({
        photo: {
          ...photo,
          id: nextId + index,
          cellId: nextCellId + index,
          imageUrl: '',
        },
        imageBlob,
      }))
      const saved = await persistNewPhotos(entries)
      const updated = [...current, ...saved]
      set({ photos: updated, activePhoto: saved[saved.length - 1] })
      return saved
    },
    favoritePhotoIds: loadFavoritePhotoIds(),
    toggleFavoritePhoto: (id) => {
      const ids = get().favoritePhotoIds
      const next = ids.includes(id)
        ? ids.filter((favoriteId) => favoriteId !== id)
        : [...ids, id]
      persistFavoritePhotoIds(next)
      set({ favoritePhotoIds: next })
    },
    deletePhoto: async (id) => get().deletePhotos([id]),
    deletePhotos: async (ids) => {
      ensureStorageReady()
      const idsToDelete = new Set(ids)
      const current = get().photos
      const updated = current.filter((photo) => !idsToDelete.has(photo.id))
      const favoritePhotoIds = get().favoritePhotoIds.filter(
        (id) => !idsToDelete.has(id),
      )
      await removePersistedPhotos([...idsToDelete])
      try {
        persistFavoritePhotoIds(favoritePhotoIds)
      } catch (error) {
        console.warn(
          'Could not update saved favorites after deleting photos:',
          error,
        )
      }
      set({ photos: updated, favoritePhotoIds, activePhoto: updated[0] })
    },
    updatePhotoTags: async (id, tags) => get().updatePhotoDetails(id, { tags }),
    updatePhotoDetails: async (id, details) => {
      ensureStorageReady()
      const current = get().photos
      const updated = current.map((photo) =>
        photo.id === id ? { ...photo, ...details } : photo,
      )
      const changed = updated.find((photo) => photo.id === id)
      if (!changed) return
      await persistPhotoMetadata([changed])
      const active = get().activePhoto
      set({
        photos: updated,
        activePhoto: active?.id === id ? { ...active, ...details } : active,
      })
    },
    searchQuery: '',
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    activeFilterTag: undefined,
    setActiveFilterTag: (activeFilterTag) => set({ activeFilterTag }),
    uploadModalOpen: false,
    setUploadModalOpen: (uploadModalOpen) => set({ uploadModalOpen }),
    pendingUploadFile: undefined,
    setPendingUploadFile: (pendingUploadFile) => set({ pendingUploadFile }),
    pendingUploadBatch: undefined,
    setPendingUploadBatch: (pendingUploadBatch) => set({ pendingUploadBatch }),
    editTagsModalOpen: false,
    setEditTagsModalOpen: (editTagsModalOpen) => set({ editTagsModalOpen }),
  }
}
