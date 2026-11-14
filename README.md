# Photo Galaxy

Photo Galaxy is a personal photo gallery set inside an immersive, interactive WebGL universe. A dark, minimal visual field, fluid motion, and a force-directed Voronoi layout bring your photos together by memory, place, and tag.

## Run locally

Requirements: Node.js 18+ (Bun is also supported) and a browser with WebGL 2.

```sh
npm install
npm run dev
```

Vite serves the app at `http://localhost:3000`. Create `.env.local` from `.env.local.example` only when you need to override the media URLs or build options.

## Using the gallery

- Explore the photo field by dragging to pan, scrolling to zoom, and selecting a photo to inspect its details.
- Use the search box and tag chips to find photos by title, caption, location, or tag.
- Use **Add Photo** to import an image, then add a title, date, location, caption, and tags.
- Edit tags, download, favorite, or remove a selected photo from its detail view.
- Photos, tags, and favorites are stored in this browser. Imported images are resized and saved locally; they are not uploaded to a server.

New galleries start empty. Choose **Add your first photo** to begin, or select **Explore sample photos** to load the optional 18-photo demo collection. If this browser has an older saved gallery, the built-in demo photos are removed automatically while your own uploads are kept.

## Project map

- `app/` — React interface, Zustand state, gallery controls, and integration with Voroforce.
- `app/store/photo-data-slice.ts` — Photo collection, selection, search, tags, and favorites.
- `app/vf/` — Gallery configuration, interactions, photo texture loading, and visual presets.
- `voroforce/` — Standalone force simulation and WebGL renderer that powers the galaxy field.
- `public/` — Static media, fonts/assets, and deployment metadata.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check and create the production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run Biome lint checks |
| `npm run check` | Run Biome lint and formatting checks |
| `npm run test:unit` | Run Vitest unit tests |
| `npm run test:e2e` | Run Playwright browser tests |

## Storage note

Photo data is stored in browser `localStorage`, including resized image data. Browser storage is limited; if it fills, export or remove some photos before adding more. The app does not provide cloud backup or cross-device sync.

## Limitations

Photo Galaxy is currently a browser-based personal photo gallery. The following limitations apply to the current version:

- **Browser-local storage:** Photos, tags, and favorites are stored in the browser's local storage rather than on a cloud server.
- **No cloud backup:** Uploaded photos are not automatically backed up to the cloud.
- **Browser storage limits:** The number and size of photos you can store depend on the available browser storage. Adding too many large images may cause storage errors.
- **Data loss risk:** Clearing browser data, site storage, or using a different browser may result in losing access to your saved gallery.
- **WebGL 2 requirement:** The interactive galaxy visualization requires a browser and device that support WebGL 2.
- **Device performance:** Animation smoothness and rendering performance depend on the device's GPU, memory, and browser capabilities.

These limitations may be addressed in future versions through cloud storage, backup functionality, synchronization, and additional performance optimizations.

## Credits and licenses

The project retains the license terms for the original Voroforce renderer and its shaders. Review `LICENSE` and the relevant third-party asset licenses before redistributing a deployment.

## Troubleshooting

- **Blank field or no images:** Use a current browser with WebGL 2 enabled, then reload the page. The gallery needs a running Vite server; opening `index.html` directly as a file will not work.
- **A photo does not appear after upload:** The gallery stores imported photos in this browser. If browser storage is full, remove a large photo or choose a smaller image.
- **Slow animation:** Close other GPU-heavy tabs and reduce the gallery cell limit in Settings.
