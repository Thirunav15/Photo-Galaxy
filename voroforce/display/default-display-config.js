import { defaultSceneConfig } from './scene'

export const defaultDisplayConfig = {
  scene: defaultSceneConfig,
  renderer: {
    depth: false,
    preserveDrawingBuffer: false,
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    backgroundColor: '#ffffff00',
    // Raise to 2 to compare with the previous maximum DPR behavior.
    maxPixelRatio: 1.25,
    // pixelRatio: 1, // override device pixel ratio before applying the maximum
    scissor: {
      enabled: false,
      offset: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    },
  },
}
