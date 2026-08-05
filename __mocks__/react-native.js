// Tests run against react-native-web (migration Stage 2) — the same module the
// web bundle aliases 'react-native' to. The old mock wrapped react-native 0.61,
// whose bundled renderer carries React 16 internals that crash under React 18
// ("Unable to find node on an unmounted component" from every findNodeHandle /
// measure call). Animation stubs carried over so component animations stay
// inert in tests.
import * as RN from 'react-native-web'

RN.Animated.timing = () => ({
    start: jest.fn(),
})

RN.Animated.loop = () => ({
    start: jest.fn(),
})

module.exports = RN
