import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { StyleSheet, View } from 'react-native'

import Spinner from '../../UIComponents/Spinner'
import { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

// One spinner for the whole Integrations loading region (AT-2229). Sections that fetch their own
// settings register here instead of rendering a local spinner each, and grey themselves out while
// their data is missing — so the page shows exactly WHAT is still loading, once.

const SPINNER_CONTAINER_SIZE = 64
const SPINNER_SIZE = 40
// Matches the house "not available yet" treatment (see NavigationBar / OptionButton).
const PENDING_OPACITY = 0.4

const IntegrationsLoadingContext = createContext(null)

/**
 * Offset (from the region's own top) at which the spinner should be centred: the middle of the
 * part of the region that is actually on screen. A region taller than the viewport therefore
 * never parks its spinner below the fold, and the spinner tracks the user as they scroll.
 * Falls back to the region's own centre when it is scrolled entirely out of view.
 */
export function visibleCenterOffset(rect, viewportHeight) {
    const visibleTop = Math.max(rect.top, 0)
    const visibleBottom = Math.min(rect.bottom, viewportHeight)
    const center = visibleBottom > visibleTop ? (visibleTop + visibleBottom) / 2 : (rect.top + rect.bottom) / 2
    return Math.max(center - rect.top, 0)
}

// Returns null when the DOM is unavailable (native, react-test-renderer, SSR) — callers then fall
// back to a strict centre of the region.
function useVisibleCenterOffset(regionRef, active) {
    const [offset, setOffset] = useState(null)

    useLayoutEffect(() => {
        if (!active) {
            setOffset(null)
            return undefined
        }

        const node = regionRef.current
        if (
            typeof window === 'undefined' ||
            typeof document === 'undefined' ||
            !node ||
            typeof node.getBoundingClientRect !== 'function'
        ) {
            return undefined
        }

        let frame = null
        let cancelled = false

        const measure = () => {
            frame = null
            if (cancelled) return
            const rect = node.getBoundingClientRect()
            const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
            const next = visibleCenterOffset(rect, viewportHeight)
            setOffset(previous => (previous !== null && Math.abs(previous - next) < 1 ? previous : next))
        }

        const schedule = () => {
            if (frame !== null) return
            frame =
                typeof window.requestAnimationFrame === 'function'
                    ? window.requestAnimationFrame(measure)
                    : setTimeout(measure, 16)
        }

        measure()
        // Capture phase: the settings page scrolls inside an inner CustomScrollView, whose scroll
        // events never reach window (see the app-shell scrolling notes in CLAUDE.md).
        document.addEventListener('scroll', schedule, true)
        window.addEventListener('resize', schedule)

        let resizeObserver = null
        if (typeof window.ResizeObserver === 'function') {
            resizeObserver = new window.ResizeObserver(schedule)
            resizeObserver.observe(node)
        }

        return () => {
            cancelled = true
            if (frame !== null) {
                if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
                clearTimeout(frame)
            }
            document.removeEventListener('scroll', schedule, true)
            window.removeEventListener('resize', schedule)
            if (resizeObserver) resizeObserver.disconnect()
        }
    }, [regionRef, active])

    return offset
}

export default function IntegrationsLoadingRegion({ children, style }) {
    const regionRef = useRef(null)
    const [pendingKeys, setPendingKeys] = useState({})

    const setPending = useCallback((key, isPending) => {
        setPendingKeys(current => {
            if (!!current[key] === !!isPending) return current
            const next = { ...current }
            if (isPending) next[key] = true
            else delete next[key]
            return next
        })
    }, [])

    const isLoading = Object.keys(pendingKeys).length > 0
    const centerOffset = useVisibleCenterOffset(regionRef, isLoading)
    const contextValue = useMemo(() => ({ setPending, isManaged: true }), [setPending])

    return (
        <IntegrationsLoadingContext.Provider value={contextValue}>
            <View ref={regionRef} style={style}>
                {children}
                {isLoading && (
                    <View
                        style={[
                            localStyles.overlay,
                            centerOffset === null
                                ? localStyles.overlayCentered
                                : { top: centerOffset - SPINNER_CONTAINER_SIZE / 2 },
                        ]}
                        pointerEvents="none"
                        accessibilityRole="progressbar"
                        accessibilityLabel={translate('Loading integration settings')}
                        testID="integrations-loading-spinner"
                    >
                        <Spinner
                            containerSize={SPINNER_CONTAINER_SIZE}
                            spinnerSize={SPINNER_SIZE}
                            containerColor={colors.Grey300}
                        />
                    </View>
                )}
            </View>
        </IntegrationsLoadingContext.Provider>
    )
}

/**
 * Wraps the part of a section that depends on data still being fetched. While `pending`, the
 * content is dimmed and made non-interactive, and the region's single spinner is shown. The
 * content keeps rendering (rather than being replaced by a spinner) so nothing jumps when it
 * resolves.
 */
export function IntegrationsPendingContent({ loadingKey, pending, style, children }) {
    const region = useContext(IntegrationsLoadingContext)
    const setPending = region?.setPending
    const contentRef = useRef(null)

    // Layout effect, not a plain effect: the dimming is applied during this component's own render,
    // so registering after paint would show one frame of dimmed content with no spinner yet.
    useLayoutEffect(() => {
        if (!setPending) return undefined
        setPending(loadingKey, pending)
        return () => setPending(loadingKey, false)
    }, [setPending, loadingKey, pending])

    // `pointerEvents: 'none'` stops the mouse but leaves the dimmed controls in the tab order and
    // visible to screen readers. `inert` removes both; react-native-web 0.21 forwards neither
    // `inert` nor the legacy accessibilityElementsHidden/importantForAccessibility props, so set it
    // on the node. Assigning an unsupported property is a harmless no-op on old browsers.
    useEffect(() => {
        const node = contentRef.current
        if (!node || typeof node !== 'object') return undefined
        node.inert = !!pending
        return () => {
            if (contentRef.current) contentRef.current.inert = false
        }
    }, [pending])

    return (
        <View
            ref={contentRef}
            style={[style, pending && localStyles.pending]}
            pointerEvents={pending ? 'none' : 'auto'}
        >
            {children}
        </View>
    )
}

// True when the section is rendered inside an IntegrationsLoadingRegion, i.e. when the region owns
// the spinner. Standalone usage keeps whatever local fallback the section provides.
export function useIsInsideIntegrationsLoadingRegion() {
    return !!useContext(IntegrationsLoadingContext)
}

const localStyles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    overlayCentered: {
        top: 0,
        bottom: 0,
    },
    pending: {
        opacity: PENDING_OPACITY,
    },
})
