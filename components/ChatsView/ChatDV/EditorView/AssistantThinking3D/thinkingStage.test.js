/**
 * The shared stage with only the WebGL renderer and the 2D canvas stubbed (jsdom has neither), so
 * the three.js scenes, the scissored render and the per-card copy are the real code.
 */
jest.mock('three', () => {
    const actual = jest.requireActual('three')
    class FakeRenderer {
        constructor() {
            this.domElement = global.document.createElement('canvas')
            this.renders = []
            FakeRenderer.instances.push(this)
        }
        setPixelRatio() {}
        setClearColor() {}
        setScissorTest() {}
        setSize(width, height) {
            this.domElement.width = width
            this.domElement.height = height
        }
        setViewport(...args) {
            this.viewport = args
        }
        setScissor() {}
        render(scene) {
            this.renders.push(scene)
        }
        dispose() {}
    }
    FakeRenderer.instances = []
    return { ...actual, WebGLRenderer: FakeRenderer, PMREMGenerator: undefined }
})

import { WebGLRenderer } from 'three'
import { __resetThinkingStageForTests, mountThinkingView } from './thinkingStage'

const makeHost = (width = 64, height = 64) => {
    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { value: width })
    Object.defineProperty(host, 'clientHeight', { value: height })
    document.body.appendChild(host)
    return host
}

describe('thinking stage', () => {
    let frames
    let contexts

    beforeEach(() => {
        __resetThinkingStageForTests()
        WebGLRenderer.instances.length = 0
        frames = []
        contexts = []
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
            const context = { canvas: this, clearRect: jest.fn(), drawImage: jest.fn() }
            contexts.push(context)
            return context
        })
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            frames.push(callback)
            return frames.length
        })
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        jest.restoreAllMocks()
        document.body.innerHTML = ''
    })

    // Frame timestamps are relative to the real clock, which the stage reads when a card mounts.
    const runFrame = offset => {
        const callback = frames.shift()
        if (callback) callback(performance.now() + offset)
        return !!callback
    }

    test('several cards share ONE WebGL renderer and each gets its own copy of its scene', () => {
        const readyA = jest.fn()
        const readyB = jest.fn()
        const hostA = makeHost()
        const hostB = makeHost()
        mountThinkingView(hostA, { animation: 'atom', onReady: readyA })
        mountThinkingView(hostB, { animation: 'gears', appearance: 'dark', onReady: readyB })
        runFrame(16)

        expect(WebGLRenderer.instances).toHaveLength(1)
        expect(WebGLRenderer.instances[0].renders).toHaveLength(2)
        expect(contexts).toHaveLength(2)
        contexts.forEach(context => expect(context.drawImage).toHaveBeenCalledTimes(1))
        expect(readyA).toHaveBeenCalledTimes(1)
        expect(readyB).toHaveBeenCalledTimes(1)
        expect(hostA.querySelector('canvas')).not.toBeNull()
        // The loop keeps going while cards are visible.
        expect(frames).toHaveLength(1)
    })

    test('copies from the bottom-left of the shared canvas, where the scissored render lands', () => {
        const small = makeHost(32, 32)
        const large = makeHost(64, 64)
        mountThinkingView(large, { animation: 'dots' })
        mountThinkingView(small, { animation: 'dots' })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        runFrame(16)
        const glHeight = WebGLRenderer.instances[0].domElement.height
        const [, smallContext] = contexts
        const [, , sourceY, width, height] = smallContext.drawImage.mock.calls[0]
        expect(width).toBe(32 * pixelRatio)
        expect(sourceY).toBe(glHeight - height)
    })

    test('unmounting removes the canvas and stops the loop once no card is left', () => {
        const host = makeHost()
        const unmount = mountThinkingView(host, { animation: 'blob' })
        runFrame(16)
        unmount()
        expect(host.querySelector('canvas')).toBeNull()
        expect(window.cancelAnimationFrame).toHaveBeenCalled()
        // A frame already queued does nothing and schedules nothing.
        runFrame(32)
        expect(frames).toHaveLength(0)
    })

    test('a scene that throws reports a failure instead of breaking the other cards', () => {
        const failure = jest.fn()
        const good = jest.fn()
        mountThinkingView(makeHost(), { animation: 'atom', onReady: good })
        mountThinkingView(makeHost(), { animation: 'cube', onFailure: failure })
        // The cube is the only one of the two with more than a handful of meshes (27 against 7).
        const meshCount = scene => {
            let count = 0
            scene.traverse(object => object.isMesh && count++)
            return count
        }
        WebGLRenderer.instances[0].render = jest.fn(scene => {
            if (meshCount(scene) > 20) throw new Error('boom')
        })
        runFrame(16)
        expect(failure).toHaveBeenCalledTimes(1)
        expect(good).toHaveBeenCalledTimes(1)
    })

    const pointer = (target, type, x, y) =>
        target.dispatchEvent(
            new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
        )
    const stageAt = host => {
        host.getBoundingClientRect = () => ({ left: 100, top: 100, width: 64, height: 64 })
        return host
    }
    const wrapperOf = () => {
        const scene = WebGLRenderer.instances[0].renders[WebGLRenderer.instances[0].renders.length - 1]
        return scene.children[scene.children.length - 1]
    }

    test('a click pokes the scene, and the press never reaches the message around it', () => {
        const message = document.createElement('div')
        const host = stageAt(makeHost())
        message.appendChild(host)
        document.body.appendChild(message)
        const reachedMessage = jest.fn()
        ;['pointerdown', 'mousedown', 'click'].forEach(type => message.addEventListener(type, reachedMessage))
        mountThinkingView(host, { animation: 'dots' })
        runFrame(0)

        pointer(host, 'pointerdown', 132, 132)
        pointer(host, 'pointerup', 133, 132)
        pointer(host, 'mousedown', 132, 132)
        pointer(host, 'click', 132, 132)
        expect(reachedMessage).not.toHaveBeenCalled()

        runFrame(16)
        runFrame(32)
        // Right after a poke the wrapper squashes.
        expect(wrapperOf().scale.y).not.toBeCloseTo(1, 3)
    })

    test('dragging spins the scene, and shows a grabbing cursor while it does', () => {
        const host = stageAt(makeHost())
        mountThinkingView(host, { animation: 'cube' })
        runFrame(0)
        expect(host.style.cursor).toBe('grab')
        pointer(host, 'pointerdown', 120, 130)
        expect(host.style.cursor).toBe('grabbing')
        pointer(host, 'pointermove', 170, 130)
        runFrame(16)
        pointer(host, 'pointerup', 170, 130)
        expect(host.style.cursor).toBe('grab')
        expect(wrapperOf().rotation.y).toBeGreaterThan(0.5)
    })

    test('turns to look at a cursor approaching the card', () => {
        const host = stageAt(makeHost())
        mountThinkingView(host, { animation: 'atom' })
        runFrame(0)
        pointer(document, 'pointermove', 260, 132)
        for (let i = 1; i <= 60; i++) runFrame(i * 16)
        expect(wrapperOf().rotation.y).toBeGreaterThan(0.1)
    })

    test('the page-wide cursor listener goes away with the last card', () => {
        const removed = jest.spyOn(document, 'removeEventListener')
        const unmountA = mountThinkingView(makeHost(), { animation: 'atom' })
        const unmountB = mountThinkingView(makeHost(), { animation: 'atom' })
        unmountA()
        expect(removed).not.toHaveBeenCalledWith('pointermove', expect.any(Function))
        unmountB()
        expect(removed).toHaveBeenCalledWith('pointermove', expect.any(Function))
    })

    test('a lost WebGL context fails every card back to its spinner', () => {
        const failure = jest.fn()
        mountThinkingView(makeHost(), { animation: 'book', onFailure: failure })
        const lost = new Event('webglcontextlost', { cancelable: true })
        WebGLRenderer.instances[0].domElement.dispatchEvent(lost)
        expect(lost.defaultPrevented).toBe(true)
        expect(failure).toHaveBeenCalledTimes(1)
    })
})
