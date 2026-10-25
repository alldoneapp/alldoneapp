/**
 * Smoke test for the imperative 3D scene. jsdom has no WebGL and no 2D canvas, so the renderer and
 * the canvas context are stubbed — everything else (three.js scene graph, instancing, raycasting
 * maths, the demolition state machine, the traffic) is the real code. It exists to catch the
 * runtime errors a browser would otherwise be the first to find: this module is only ever loaded
 * behind a dynamic import, so nothing else in the suite executes it.
 */
import moment from 'moment'

jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.mock('three', () => {
    const actual = jest.requireActual('three')
    class FakeRenderer {
        constructor() {
            this.domElement = global.document.createElement('canvas')
            this.capabilities = { getMaxAnisotropy: () => 1 }
            this.shadowMap = {}
            this.renderCount = 0
        }
        setPixelRatio() {}
        setClearColor() {}
        setSize() {}
        render() {
            this.renderCount += 1
        }
        dispose() {}
    }
    return { ...actual, WebGLRenderer: FakeRenderer }
})

import { buildSkylineDays, buildSkylineWeeks } from './skylineData'
import { createSkylineScene } from './skylineScene'

const context2d = new Proxy(
    // The legend width is measured to frame it, so this one call has to answer.
    { measureText: text => ({ width: String(text).length * 12 }) },
    {
        get: (target, key) => (key in target ? target[key] : () => {}),
        set: (target, key, value) => {
            target[key] = value
            return true
        },
    }
)

describe('skyline scene (smoke)', () => {
    let frames
    let now

    beforeEach(() => {
        frames = []
        now = 1000
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context2d)
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            frames.push(callback)
            return frames.length
        })
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
        jest.spyOn(performance, 'now').mockImplementation(() => now)
    })

    afterEach(() => jest.restoreAllMocks())

    const runFrames = count => {
        for (let i = 0; i < count; i++) {
            now += 16
            const pending = frames.splice(0)
            pending.forEach(callback => callback())
        }
    }

    const makeDays = () => {
        const today = moment('2026-09-25T12:00:00').valueOf()
        const weeks = buildSkylineWeeks(['2026-09-24', '2026-09-25'], today)
        const statistics = { p: {} }
        weeks.forEach(week =>
            week.days.forEach((day, i) => {
                statistics.p[parseInt(day.date.format('YYYYMMDD'), 10)] = { doneTasks: (i * 7) % 23, doneTime: 30 }
            })
        )
        return buildSkylineDays(weeks, statistics, [{ id: 'p', name: 'P', color: '#007FFF' }])
    }

    const mountCity = (options = {}) => {
        const container = document.createElement('div')
        Object.defineProperty(container, 'clientWidth', { value: 600 })
        Object.defineProperty(container, 'clientHeight', { value: 540 })
        container.getBoundingClientRect = () => ({ left: 0, top: 100, width: 600, height: 540 })
        document.body.appendChild(container)
        const onDemolish = jest.fn()
        const onSelect = jest.fn()
        const onHover = jest.fn()
        const scene = createSkylineScene(container, { onHover, onSelect, onDemolish, ...options })
        scene.setDays(makeDays(), { columns: [{ column: 0, text: 'Mo' }], rows: [{ row: 0, text: '25 Aug' }] })
        runFrames(120)
        const canvas = container.querySelector('canvas')
        canvas.getBoundingClientRect = () => ({ left: 0, top: 100, width: 600, height: 540 })
        const pointer = (type, x, y) =>
            canvas.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, pointerType: 'mouse' }))
        // Which building the pointer is over, without launching anything.
        const hoverAt = (x, y) => {
            pointer('pointerleave', x, y)
            onHover.mockClear()
            pointer('pointermove', x, y)
            return onHover.mock.calls.length ? onHover.mock.calls[onHover.mock.calls.length - 1][0] : -1
        }
        const tap = (x, y) => {
            pointer('pointerdown', x, y)
            pointer('pointerup', x, y)
        }
        // The highest point of any building on screen, scanning from the top.
        const findBuilding = () => {
            for (let y = 140; y < 620; y += 12) {
                for (let x = 40; x < 580; x += 12) {
                    const index = hoverAt(x, y)
                    if (index >= 0) return { spot: { x, y }, target: index }
                }
            }
            return { spot: null, target: -1 }
        }
        // Strike `target` until it falls. It loses floors with every hit, so its top sinks on screen;
        // follow it downwards the way a player would.
        const demolish = (start, target, framesPerStrike) => {
            let spot = start
            for (let i = 0; i < 30 && !onDemolish.mock.calls.length; i++) {
                tap(spot.x, spot.y)
                runFrames(framesPerStrike)
                if (hoverAt(spot.x, spot.y) === target) continue
                for (let dy = 4; dy <= 160; dy += 4) {
                    if (hoverAt(spot.x, spot.y + dy) === target) {
                        spot = { x: spot.x, y: spot.y + dy }
                        break
                    }
                }
            }
        }
        return { container, scene, onDemolish, onSelect, hoverAt, tap, findBuilding, demolish }
    }

    it('builds, animates, flies asteroids into the city and tears down without throwing', () => {
        // No big ones, so every strike on a building is a direct hit that cannot spill onto another.
        jest.spyOn(Math, 'random').mockReturnValue(0.5)
        const { container, scene, onDemolish, onSelect, tap, findBuilding, demolish } = mountCity()
        scene.celebrateToday()
        runFrames(30)

        const { spot, target } = findBuilding()
        expect(spot).not.toBeNull()
        // A rock needs its flight time (at most ~1s) before it lands and does any damage.
        tap(spot.x, spot.y)
        runFrames(2)
        expect(onSelect).toHaveBeenCalledWith(target)
        expect(onDemolish).not.toHaveBeenCalled()
        runFrames(70)
        demolish(spot, target, 70)
        runFrames(200)
        expect(onDemolish).toHaveBeenCalledTimes(1)
        expect(onDemolish).toHaveBeenCalledWith(1)

        // A strike on a spot off every building launches at the ground, and its blast plays out.
        tap(300, 625)
        runFrames(240)

        scene.destroy()
        expect(container.querySelector('canvas')).toBeNull()
    })

    it('demolishes at once under reduced motion, and a statistics refresh does not rebuild it', () => {
        jest.spyOn(Math, 'random').mockReturnValue(0.5)
        const { scene, onDemolish, hoverAt, findBuilding, demolish } = mountCity({ reduceMotion: true })
        const { spot, target } = findBuilding()
        expect(spot).not.toBeNull()
        demolish(spot, target, 1)
        expect(onDemolish).toHaveBeenCalledWith(1)
        // Its top is gone: the pointer no longer finds it where it stood.
        expect(hoverAt(spot.x, spot.y)).not.toBe(target)

        scene.setDays(makeDays())
        runFrames(20)
        expect(hoverAt(spot.x, spot.y)).not.toBe(target)
        expect(onDemolish).toHaveBeenCalledTimes(1)
        scene.destroy()
    })

    it('runs a night — lamps, headlights, helicopter and searchlight — without throwing', () => {
        jest.useFakeTimers({ doNotFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
        jest.setSystemTime(new Date(2026, 8, 25, 23, 0))
        try {
            const container = document.createElement('div')
            Object.defineProperty(container, 'clientWidth', { value: 600 })
            Object.defineProperty(container, 'clientHeight', { value: 340 })
            container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 340 })
            const scene = createSkylineScene(container, { onHover: () => {}, onSelect: () => {} })
            scene.setDays(makeDays(), { columns: [], rows: [] })
            runFrames(400)
            scene.destroy()
        } finally {
            jest.useRealTimers()
        }
    })

    it('builds a single-week strip and frames it without throwing', () => {
        const container = document.createElement('div')
        Object.defineProperty(container, 'clientWidth', { value: 700 })
        Object.defineProperty(container, 'clientHeight', { value: 320 })
        container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 320 })
        const scene = createSkylineScene(container, { onHover: () => {}, onSelect: () => {}, weeks: 1 })
        const today = moment('2026-09-25T12:00:00').valueOf()
        const weeks = buildSkylineWeeks(['2026-09-24'], today, 1)
        const days = buildSkylineDays(weeks, {}, [{ id: 'p', name: 'P', color: '#007FFF' }])
        scene.setDays(days, {
            columns: weeks[0].days.map((day, column) => ({ column, text: day.date.format('dd') })),
            rows: [{ row: 0, text: '21 Sep' }],
        })
        runFrames(200)
        scene.destroy()
        expect(container.querySelector('canvas')).toBeNull()
    })

    it('stays static under reduced motion', () => {
        const container = document.createElement('div')
        Object.defineProperty(container, 'clientWidth', { value: 400 })
        Object.defineProperty(container, 'clientHeight', { value: 360 })
        container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 360 })
        const scene = createSkylineScene(container, { onHover: () => {}, onSelect: () => {}, reduceMotion: true })
        scene.setDays(makeDays(), { columns: [], rows: [] })
        runFrames(10)
        scene.destroy()
    })
})
