import React from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'
import { FlatList, VirtualizedList } from 'react-native-web'

import { installPassiveVirtualizedListWheel } from './passiveVirtualizedListWheel'

// Drives the REAL react-native-web FlatList through react-dom: the defect lives in how
// VirtualizedList registers its own listener, which a hand-called stub cannot see.

// React 18 registers its own (passive) `wheel` listeners on the ROOT container it renders
// into; only registrations on a node inside the tree belong to react-native-web's list.
const allWheelRegistrations = []
const wheelRegistrations = {
    get list() {
        return allWheelRegistrations.filter(({ target }) => !target.isRootContainer)
    },
    reset() {
        allWheelRegistrations.length = 0
    },
}
const originalAdd = EventTarget.prototype.addEventListener

beforeAll(() => {
    EventTarget.prototype.addEventListener = function patchedAdd(type, listener, options) {
        if (type === 'wheel') allWheelRegistrations.push({ target: this, listener, options })
        return originalAdd.call(this, type, listener, options)
    }
})

afterAll(() => {
    EventTarget.prototype.addEventListener = originalAdd
})

beforeEach(() => {
    wheelRegistrations.reset()
})

const renderList = props => {
    const container = document.createElement('div')
    container.isRootContainer = true
    document.body.appendChild(container)
    act(() => {
        ReactDOM.render(<FlatList data={[{ key: 'a' }, { key: 'b' }]} renderItem={() => null} {...props} />, container)
    })
    return {
        unmount: () => {
            act(() => ReactDOM.unmountComponentAtNode(container))
            container.remove()
        },
    }
}

describe('passive VirtualizedList wheel listener', () => {
    it('reproduces the defect: stock react-native-web registers a non-passive wheel listener', () => {
        // Runs before install (jest executes cases in order), against the stock prototype.
        expect(VirtualizedList.prototype.setupWebWheelHandler).toBeDefined()

        const { unmount } = renderList()
        expect(wheelRegistrations.list).toHaveLength(1)
        expect(wheelRegistrations.list[0].options).toBeUndefined()
        unmount()
    })

    it('registers the wheel listener as passive once installed, and non-passive for an inverted list', () => {
        expect(installPassiveVirtualizedListWheel()).toBe(true)
        // Idempotent: a second install is a no-op rather than a double wrap.
        expect(installPassiveVirtualizedListWheel()).toBe(false)

        const plain = renderList()
        expect(wheelRegistrations.list).toHaveLength(1)
        expect(wheelRegistrations.list[0].options).toEqual({ passive: true })
        expect(wheelRegistrations.list[0].target.tagName).toBe('DIV')
        plain.unmount()

        wheelRegistrations.reset()
        const inverted = renderList({ inverted: true })
        expect(wheelRegistrations.list).toHaveLength(1)
        expect(wheelRegistrations.list[0].options).toEqual({ passive: false })
        inverted.unmount()
    })

    it('removes the listener on unmount', () => {
        installPassiveVirtualizedListWheel()
        const removed = []
        const originalRemove = EventTarget.prototype.removeEventListener
        EventTarget.prototype.removeEventListener = function patchedRemove(type, listener, options) {
            if (type === 'wheel') removed.push(listener)
            return originalRemove.call(this, type, listener, options)
        }
        try {
            const { unmount } = renderList()
            const [{ listener }] = wheelRegistrations.list
            unmount()
            expect(removed).toContain(listener)
        } finally {
            EventTarget.prototype.removeEventListener = originalRemove
        }
    })

    it('leaves a class without the react-native-web wheel hooks alone', () => {
        class Unrelated {}
        expect(installPassiveVirtualizedListWheel(Unrelated)).toBe(false)
        expect(installPassiveVirtualizedListWheel(null)).toBe(false)
    })
})
