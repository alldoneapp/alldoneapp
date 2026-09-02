import { VirtualizedList } from 'react-native-web'

/**
 * react-native-web's VirtualizedList registers a `wheel` listener on its scroll node
 * ("Support inverted wheel scroller") with no options, i.e. NON-passive. Chrome treats a
 * non-passive wheel listener as scroll-blocking — it has to run the handler before it can
 * scroll — and reports every registration as a `[Violation] Added non-passive event
 * listener to a scroll-blocking 'wheel' event` on each list mount.
 *
 * The handler only ever calls `preventDefault()` for an `inverted` list, where it drives the
 * scroll itself. For every other list it just reads the event, so `passive: true` is the
 * honest registration there. This patches the two prototype methods once, keeping RNW's
 * "retry until the scroll ref exists" loop, and derives `passive` from the instance's own
 * `inverted` prop so an inverted list keeps the non-passive listener it needs. It is app
 * code rather than a vendored react-native-web (that patch was retired in migration Stage
 * 2 on purpose).
 *
 * It must run before the first list MOUNTS: `componentDidMount` runs children-first, so
 * installing it from `AppContainer.componentDidMount` would miss every list on the first
 * screen. Call it at module scope from the app shell instead.
 */

const PATCHED = Symbol.for('alldone.passiveVirtualizedListWheel')

export const wheelListenerOptions = inverted => ({ passive: !inverted })

export const installPassiveVirtualizedListWheel = (ListClass = VirtualizedList) => {
    const proto = ListClass?.prototype
    if (!proto || proto[PATCHED]) return false
    if (typeof proto.setupWebWheelHandler !== 'function' || typeof proto.teardownWebWheelHandler !== 'function') {
        return false
    }

    proto.setupWebWheelHandler = function setupWebWheelHandler() {
        const scrollRef = this._scrollRef
        if (scrollRef && scrollRef.getScrollableNode) {
            const node = scrollRef.getScrollableNode()
            if (node && node.addEventListener) {
                node.addEventListener(
                    'wheel',
                    this.invertedWheelEventHandler,
                    wheelListenerOptions(Boolean(this.props?.inverted))
                )
            }
        } else {
            setTimeout(() => this.setupWebWheelHandler(), 50)
        }
    }

    proto.teardownWebWheelHandler = function teardownWebWheelHandler() {
        const scrollRef = this._scrollRef
        if (scrollRef && scrollRef.getScrollableNode) {
            const node = scrollRef.getScrollableNode()
            if (node && node.removeEventListener) {
                node.removeEventListener('wheel', this.invertedWheelEventHandler)
            }
        }
    }

    proto[PATCHED] = true
    return true
}
