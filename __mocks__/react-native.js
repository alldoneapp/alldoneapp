// Tests run against react-native-web (migration Stage 2) — the same module the
// web bundle aliases 'react-native' to. The old mock wrapped react-native 0.61,
// whose bundled renderer carries React 16 internals that crash under React 18
// ("Unable to find node on an unmounted component" from every findNodeHandle /
// measure call). Animation stubs carried over so component animations stay
// inert in tests.
import * as RN from 'react-native-web'

// `stop` is part of the CompositeAnimation contract and is what an effect's cleanup calls when a
// run is cancelled or its component unmounts. A double that only offered `start` made every such
// cleanup throw — invisibly, because React swallows it into a "commit phase error" warning rather
// than failing the assertion that follows (AT-2495). `Animated.sequence`/`parallel` are NOT stubbed
// here, so they always had it; a bare `timing` did not.
RN.Animated.timing = () => ({
    start: jest.fn(),
    stop: jest.fn(),
})

RN.Animated.loop = () => ({
    start: jest.fn(),
})

module.exports = RN
