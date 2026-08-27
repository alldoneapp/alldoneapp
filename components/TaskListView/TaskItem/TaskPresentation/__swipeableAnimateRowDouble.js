/**
 * AT-2449 — a `Swipeable` double that reproduces `_animateRow`'s callback ORDER.
 *
 * A stub that simply renders its children (what the neighbouring suites use) is
 * fine for tests that are not about the gesture, but it cannot express the thing
 * that broke here, which is *when* `Swipeable` calls back. Everything below is
 * mirrored from `node_modules/react-native-gesture-handler/Swipeable.js`
 * (v1.5.6: `_animateRow` at lines 203-242, `_currentOffset` at 250-260), and only
 * the parts that decide ordering are modelled:
 *
 *   1. `_animateRow` starts the spring FIRST and calls the `will*` callbacks
 *      afterwards, so a spring that settles inside `.start()` reports "closed"
 *      before "will close".
 *   2. A spring settles inside `.start()` exactly when it has no distance to
 *      travel: react-native-web's `SpringAnimation.onUpdate` runs its first frame
 *      synchronously and stops immediately at zero displacement / zero velocity.
 *   3. `_currentOffset()` reads `this.state.rowState`, and the `setState` that
 *      would move it is BATCHED — so a `close()` issued from inside
 *      `onSwipeableRightWillOpen` still sees `rowState === 0` and therefore
 *      animates 0 → 0. This is the step that makes (1) and (2) meet, and it is
 *      why `pendingRowState` and `rowState` are separate fields here.
 *
 * `emitted` records the callback names in the order the component received them,
 * so a test can assert on the sequence itself and not only on its outcome.
 */
const React = require('react')

// Any non-zero width; only "is there distance to travel" matters.
const RIGHT_ACTIONS_WIDTH = 150

const swipeableInstances = []

const SwipeableDouble = React.forwardRef(({ children, ...props }, ref) => {
    // Handlers must call back into the CURRENT props, the way a class component
    // reading `this.props` inside a handler does.
    const latestProps = React.useRef(props)
    latestProps.current = props

    const instance = React.useRef(null)
    if (instance.current === null) {
        const state = { rowState: 0, pendingRowState: 0 }
        const emitted = []

        const emit = name => {
            const handler = latestProps.current[name]
            if (typeof handler !== 'function') return
            emitted.push(name)
            handler()
        }

        const currentOffset = () =>
            state.rowState === -1 ? -RIGHT_ACTIONS_WIDTH : state.rowState === 1 ? RIGHT_ACTIONS_WIDTH : 0

        const animateRow = (fromValue, toValue) => {
            state.pendingRowState = Math.sign(toValue)

            // (1) + (2): the spring is started here, and a zero-distance spring
            // has already finished by the time `start()` returns.
            if (fromValue === toValue) emit(toValue === 0 ? 'onSwipeableClose' : 'onSwipeableOpen')

            if (toValue > 0) emit('onSwipeableLeftWillOpen')
            else if (toValue < 0) emit('onSwipeableRightWillOpen')

            emit(toValue === 0 ? 'onSwipeableWillClose' : 'onSwipeableWillOpen')
        }

        // The batch that (3) is about: React flushes it once the handler that
        // started the gesture has returned.
        const flushRowState = () => {
            state.rowState = state.pendingRowState
        }

        instance.current = {
            emitted,
            close: () => animateRow(currentOffset(), 0),
            // `_handleRelease` past the right threshold: the row is asked to open.
            releaseRightSwipe: () => {
                animateRow(currentOffset(), -RIGHT_ACTIONS_WIDTH)
                flushRowState()
            },
            // A row already sitting open, with no app handler involved.
            forceOpen: offset => {
                state.rowState = Math.sign(offset)
                state.pendingRowState = state.rowState
            },
            // A new open gesture landing on top of a close that is still running,
            // so that close never delivers its completion callback.
            forceReopen: offset => {
                animateRow(0, offset)
                flushRowState()
            },
            // The spring of a genuinely animated close reaching its target.
            settleClose: () => emit('onSwipeableClose'),
        }
        swipeableInstances.push(instance.current)
    }

    React.useImperativeHandle(ref, () => instance.current, [])

    return children
})

module.exports = {
    __esModule: true,
    default: SwipeableDouble,
    RIGHT_ACTIONS_WIDTH,
    swipeableInstances,
}
