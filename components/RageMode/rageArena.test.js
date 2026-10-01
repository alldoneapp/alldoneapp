import { WebGLRenderer } from 'three'
import { isRageArenaActive, startRageArena } from './rageArena'
import { buildRageStrings } from './rageStrings'
import { resolveHit } from './rageTargets'

// Keep the real scene, meshes, physics, input handlers and lifecycle. Only GPU rendering and
// layout-dependent hit testing need substitutes in jsdom; the browser harness covers those.
jest.mock('three', () => ({
    ...jest.requireActual('three'),
    WebGLRenderer: jest.fn().mockImplementation(() => {
        let disposed = false
        return {
            domElement: global.document.createElement('canvas'),
            setPixelRatio: jest.fn(),
            setClearColor: jest.fn(),
            setSize: jest.fn(),
            render: jest.fn(() => {
                if (disposed) throw new Error('Rendered after GPU resources were disposed')
            }),
            dispose: jest.fn(() => {
                disposed = true
            }),
        }
    }),
}))
jest.mock('./rageTargets', () => ({
    ...jest.requireActual('./rageTargets'),
    resolveHit: jest.fn(),
    findTaskRows: () => [],
    scrollContainerAt: () => null,
}))

const strings = buildRageStrings(key => key)
const key = (value, code = value) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: value, code, bubbles: true, cancelable: true }))
const hud = () => document.querySelector('[data-rage-mode-layer="hud"]')

describe('rage arena ESC lifecycle (AT-2673)', () => {
    let arena
    let frames
    let timestamp
    let renderer
    let onExit

    const step = (count = 1) => {
        for (let i = 0; i < count; i++) {
            timestamp += 1000 / 60
            const callbacks = [...frames.values()]
            frames.clear()
            callbacks.forEach(callback => callback(timestamp))
        }
    }
    const start = () => {
        arena = startRageArena({ strings, onExit, tuning: { invincible: true } })
        renderer = WebGLRenderer.mock.results.at(-1).value
        step(45)
        return arena
    }
    const scene = () => renderer.render.mock.calls.at(-1)[0]
    const bolts = () =>
        scene().children.filter(mesh => mesh.renderOrder === 4 && mesh.geometry?.parameters.width === 26)
    const shards = () =>
        scene().children.filter(mesh => mesh.renderOrder === 3 && mesh.geometry?.type === 'BufferGeometry')
    const fireWithDebris = () => {
        const element = document.getElementById('app-button')
        resolveHit.mockReturnValueOnce({
            kind: 'block',
            element,
            rect: { left: 300, top: 200, width: 80, height: 40 },
            color: '#0C66FF',
            background: '#FFFFFF',
        })
        key(' ', 'Space')
        step(25)
        expect(Number(hud().dataset.destroyed)).toBe(1)
        expect(shards().length).toBeGreaterThan(0)
        expect(bolts().length).toBeGreaterThanOrEqual(2)
    }

    beforeEach(() => {
        jest.useFakeTimers()
        frames = new Map()
        timestamp = 0
        let nextFrame = 0
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            frames.set(++nextFrame, callback)
            return nextFrame
        })
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id))
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            createRadialGradient: () => ({ addColorStop: () => {} }),
            fillRect: () => {},
        })
        jest.replaceProperty(window, 'innerWidth', 4000)
        jest.replaceProperty(window, 'innerHeight', 2400)
        document.body.innerHTML = '<button id="app-button">Save</button>'
        localStorage.clear()
        WebGLRenderer.mockClear()
        resolveHit.mockReset().mockReturnValue(null)
        onExit = jest.fn()
    })

    afterEach(() => {
        arena?.stop({ immediate: true })
        jest.restoreAllMocks()
        jest.useRealTimers()
    })

    it('drains multiple live bolts, rewinds debris and restores app input after ESC during continuous fire', () => {
        const html = document.body.innerHTML
        const appKey = jest.fn()
        document.addEventListener('keydown', appKey)
        start()
        fireWithDebris()
        const flying = bolts()
        const dispose = flying.map(mesh => jest.spyOn(mesh.children[0].material, 'dispose'))
        const debris = shards()
        expect(() => key('Escape')).not.toThrow()
        expect(bolts()).toHaveLength(0)
        dispose.forEach(spy => expect(spy).toHaveBeenCalledTimes(1))
        expect(hud().dataset.autoFire).toBe('off')
        const shots = hud().dataset.shots
        key('Escape')
        key(' ', 'Space')
        step(58)
        expect(hud().dataset.shots).toBe(shots)
        debris.forEach(mesh => {
            expect(mesh.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0])
            expect(mesh.position.y).toBeLessThanOrEqual(-200)
            expect(mesh.position.y).toBeGreaterThanOrEqual(-240)
            expect(mesh.position.z).toBeCloseTo(2)
        })
        step(60)
        expect(isRageArenaActive()).toBe(false)
        expect(onExit).toHaveBeenCalledTimes(1)
        expect(renderer.dispose).toHaveBeenCalledTimes(1)
        expect(frames.size).toBe(0)
        expect(document.body.innerHTML).toBe(html)
        expect(appKey).not.toHaveBeenCalled()
        key('x')
        expect(appKey).toHaveBeenCalledTimes(1)
        document.removeEventListener('keydown', appKey)
    })

    it('closes the shop on the first ESC and exits on the second while auto-fire is enabled', () => {
        start()
        fireWithDebris()
        key('b', 'KeyB')
        expect(hud().dataset.shop).toBe('open')
        const shots = hud().dataset.shots
        step(20)
        expect(hud().dataset.shots).toBe(shots)
        key('Escape')
        expect(hud().dataset.shop).toBeUndefined()
        expect(hud().dataset.autoFire).toBe('on')
        expect(isRageArenaActive()).toBe(true)
        key('Escape')
        step(120)
        expect(onExit).toHaveBeenCalledTimes(1)
        expect(isRageArenaActive()).toBe(false)
    })

    it.each([0, 1])('also exits with %i live projectiles', count => {
        start()
        if (count) {
            key(' ', 'Space')
            step()
            key(' ', 'Space')
        }
        expect(bolts().length).toBe(count)
        key('Escape')
        step(120)
        expect(isRageArenaActive()).toBe(false)
        expect(onExit).toHaveBeenCalledTimes(1)
        expect(frames.size).toBe(0)
    })

    it('handles resize removing debris during rewind and repeated start/stop transitions', () => {
        for (let round = 0; round < 3; round++) {
            start()
            fireWithDebris()
            const geometries = shards().map(mesh => jest.spyOn(mesh.geometry, 'dispose'))
            key('Escape')
            step(3)
            window.dispatchEvent(new Event('resize'))
            expect(shards()).toHaveLength(0)
            arena.stop()
            step(120)
            geometries.forEach(spy => expect(spy).toHaveBeenCalledTimes(1))
            expect(onExit).toHaveBeenCalledTimes(round + 1)
            expect(frames.size).toBe(0)
        }
    })

    it('ignores stale animation callbacks after immediate stop, even when a new arena has started', () => {
        const oldArena = start()
        fireWithDebris()
        const oldRenderer = renderer
        const staleFrame = [...frames.values()][0]
        oldArena.stop({ immediate: true })
        const renders = oldRenderer.render.mock.calls.length
        start()
        staleFrame(timestamp + 1000)
        oldArena.stop()
        expect(oldRenderer.render).toHaveBeenCalledTimes(renders)
        expect(oldRenderer.dispose).toHaveBeenCalledTimes(1)
        expect(isRageArenaActive()).toBe(true)
        expect(onExit).toHaveBeenCalledTimes(1)
        key('Escape')
        step(120)
        expect(onExit).toHaveBeenCalledTimes(2)
        expect(frames.size).toBe(0)
    })
})
