/**
 * Smoke test for the imperative 3D scene. jsdom has no WebGL and no 2D canvas, so the renderer and
 * the canvas context are stubbed — everything else (three.js scene graph, instancing, raycasting
 * maths, the demolition state machine, the traffic) is the real code. It exists to catch the
 * runtime errors a browser would otherwise be the first to find: this module is only ever loaded
 * behind a dynamic import, so nothing else in the suite executes it.
 */
import moment from 'moment'

jest.mock('three', () => {
    const actual = jest.requireActual('three')
    class FakeRenderer {
        constructor() {
            this.domElement = global.document.createElement('canvas')
            this.capabilities = { getMaxAnisotropy: () => 1 }
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
    {},
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

    it('builds, animates, demolishes and tears down without throwing', () => {
        const container = document.createElement('div')
        Object.defineProperty(container, 'clientWidth', { value: 600 })
        Object.defineProperty(container, 'clientHeight', { value: 540 })
        container.getBoundingClientRect = () => ({ left: 0, top: 100, width: 600, height: 540 })
        document.body.appendChild(container)
        const onDemolish = jest.fn()
        const onSelect = jest.fn()

        const scene = createSkylineScene(container, { onHover: () => {}, onSelect, onDemolish })
        const days = makeDays()
        scene.setDays(days, { months: [{ week: 0, text: 'Jul' }], weekdays: [{ weekday: 0, text: 'Mon' }] })
        runFrames(120)
        scene.celebrateToday()
        runFrames(30)

        // Hammer the centre of the canvas; whatever is there gets hit until it collapses.
        const canvas = container.querySelector('canvas')
        canvas.getBoundingClientRect = () => ({ left: 0, top: 100, width: 600, height: 540 })
        const tap = (x, y) => {
            canvas.dispatchEvent(
                Object.assign(new Event('pointerdown'), { clientX: x, clientY: y, pointerType: 'mouse' })
            )
            canvas.dispatchEvent(
                Object.assign(new Event('pointerup'), { clientX: x, clientY: y, pointerType: 'mouse' })
            )
            runFrames(3)
        }
        for (let i = 0; i < 30; i++) tap(300, 370)
        runFrames(200)

        expect(onSelect).toHaveBeenCalled()
        expect(onSelect.mock.calls.some(([index]) => index >= 0)).toBe(true)
        expect(onDemolish).toHaveBeenCalledWith(1)

        // A statistics refresh must not resurrect the demolished building.
        scene.setDays(makeDays())
        runFrames(20)
        tap(300, 370)
        expect(onDemolish).toHaveBeenCalledTimes(1)

        scene.destroy()
        expect(container.querySelector('canvas')).toBeNull()
    })

    it('stays static under reduced motion', () => {
        const container = document.createElement('div')
        Object.defineProperty(container, 'clientWidth', { value: 400 })
        Object.defineProperty(container, 'clientHeight', { value: 360 })
        container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 360 })
        const scene = createSkylineScene(container, { onHover: () => {}, onSelect: () => {}, reduceMotion: true })
        scene.setDays(makeDays(), { months: [], weekdays: [] })
        runFrames(10)
        scene.destroy()
    })
})
