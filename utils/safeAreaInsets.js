// env(safe-area-inset-*) is CSS-only; React Native Web styles cannot express
// it and the templates apply it only to <body>, which does not reach
// position:fixed portals. Measure it through a probe element instead. Measured
// fresh on every call (it changes on rotation); callers run once per render of
// an open sheet, so the forced layout is negligible.
export const getSafeAreaBottomInset = () => {
    if (typeof document === 'undefined' || !document.body) return 0
    const probe = document.createElement('div')
    probe.style.cssText =
        'position:fixed;bottom:0;left:0;width:1px;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)
    const inset = probe.getBoundingClientRect().height || 0
    probe.remove()
    return inset
}
