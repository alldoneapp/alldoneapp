// react-test-renderer has no DOM, so host-component refs resolve to null unless
// the suite passes createNodeMock. Under react-native-web (migration Stage 2)
// components really do reach through those refs - addEventListener from the
// responder system, setNativeProps, focus/isFocused on inputs, offsetWidth via
// findDOMNode - which crashed suites that rendered fine under the old native
// preset. Share one permissive DOM-node stand-in instead of re-stubbing it in
// every suite.
//
// nodeType: 1 makes ReactDOM.findDOMNode treat the stub as a real element and
// return it as-is (components like SocialText read offsetWidth off that).

const noop = () => {}

const zeroRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 })

export const domNodeStub = {
    nodeType: 1,
    addEventListener: noop,
    removeEventListener: noop,
    setNativeProps: noop,
    focus: noop,
    blur: noop,
    isFocused: () => false,
    offsetWidth: 0,
    offsetHeight: 0,
    getBoundingClientRect: zeroRect,
    measure: callback => callback(0, 0, 0, 0, 0, 0),
    measureInWindow: callback => callback(0, 0, 0, 0),
    measureLayout: noop,
    scrollTo: noop,
    setAttribute: noop,
    style: {},
}

export const createNodeMock = () => domNodeStub

// Spread into the second argument of renderer.create:
//     renderer.create(<Component />, nodeMockOptions)
export const nodeMockOptions = { createNodeMock }
