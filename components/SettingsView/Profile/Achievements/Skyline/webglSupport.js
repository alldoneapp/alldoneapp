import { Platform } from 'react-native'

let cachedAnswer = null

/**
 * Whether this browser can draw the 3D skyline. Asked once per session and remembered: creating a
 * throwaway WebGL context is not free, and the answer cannot change while the page is open.
 *
 * Deliberately lives outside `skylineScene.js`, which imports three.js — asking the question must
 * not pull the library into the main bundle.
 */
export function canRenderSkyline() {
    if (cachedAnswer !== null) return cachedAnswer
    cachedAnswer = false
    try {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.WebGLRenderingContext) {
            return cachedAnswer
        }
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
        cachedAnswer = !!context
        const lose = context && context.getExtension && context.getExtension('WEBGL_lose_context')
        if (lose) lose.loseContext()
    } catch (error) {
        cachedAnswer = false
    }
    return cachedAnswer
}

export const __resetSkylineSupportForTests = () => {
    cachedAnswer = null
}
