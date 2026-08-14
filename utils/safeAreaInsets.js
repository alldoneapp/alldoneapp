// env(safe-area-inset-*) is CSS-only; React Native Web styles cannot express
// it and body padding does not constrain position:fixed portals. Measure the
// resolved values through a probe element instead. Cache by viewport/body — a
// rotation changes the dimensions and triggers a fresh measurement, while the
// many closed AppPopover wrappers share the normal zero-inset result.
const ZERO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })
let cachedMeasurement = null

const toPixels = value => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
}

export const getSafeAreaInsets = () => {
    if (typeof document === 'undefined' || !document.body || typeof window === 'undefined') return ZERO_INSETS

    const cacheKey = {
        body: document.body,
        width: window.innerWidth,
        height: window.innerHeight,
        getComputedStyle: window.getComputedStyle,
    }
    if (
        cachedMeasurement &&
        cachedMeasurement.body === cacheKey.body &&
        cachedMeasurement.width === cacheKey.width &&
        cachedMeasurement.height === cacheKey.height &&
        cachedMeasurement.getComputedStyle === cacheKey.getComputedStyle
    ) {
        return cachedMeasurement.insets
    }

    const probe = document.createElement('div')
    probe.setAttribute('data-safe-area-inset-probe', '')
    probe.style.cssText =
        'position:fixed;inset:0 auto auto 0;width:0;height:0;' +
        'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
        'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);' +
        'visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)
    const computed = window.getComputedStyle(probe)
    const insets = {
        top: toPixels(computed.paddingTop),
        right: toPixels(computed.paddingRight),
        bottom: toPixels(computed.paddingBottom),
        left: toPixels(computed.paddingLeft),
    }
    probe.remove()
    cachedMeasurement = { ...cacheKey, insets }
    return insets
}

export const getSafeAreaBottomInset = () => getSafeAreaInsets().bottom
