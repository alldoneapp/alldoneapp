import { WebGLRenderer } from 'three'
import { isRageArenaActive, startRageArena } from './raidArena'
import { buildRageStrings } from './rageStrings'

// The real scene, meshes, game logic, input handlers and lifecycle; only GPU rendering needs a
// substitute in jsdom. `browser-tests/rage-mode` covers what only a real browser can show.
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

const strings = buildRageStrings(key => key)
const key = (value, code = value, type = 'keydown') =>
    document.dispatchEvent(new KeyboardEvent(type, { key: value, code, bubbles: true, cancelable: true }))
const hud = () => document.querySelector('[data-rage-mode-layer="hud"]')
const layer = name => document.querySelector(`[data-rage-mode-layer="${name}"]`)

// jsdom has no 2D canvas; every drawing call is accepted and does nothing.
const fakeContext = () =>
    new Proxy(
        {},
        {
            get: (target, prop) => {
                if (prop === 'measureText') return text => ({ width: String(text).length * 7 })
                if (prop === 'createRadialGradient' || prop === 'createLinearGradient')
                    return () => ({ addColorStop: () => {} })
                if (prop in target) return target[prop]
                return () => {}
            },
            set: (target, prop, value) => {
                target[prop] = value
                return true
            },
        }
    )

const PAGE = `
  <div id="root"><div id="page">
    <div id="task_body_p1_t1_false" class="row"><span>Reply to the tax advisor</span></div>
    <div id="task_body_p1_t2_false" class="row"><span>Prepare the board slides</span></div>
  </div></div>
  <button id="app-button">Save</button>`

describe('rage mode raid arena', () => {
    let arena
    let frames
    let timestamp
    let renderer
    let onExit
    let services

    const step = (count = 1) => {
        for (let i = 0; i < count; i++) {
            timestamp += 1000 / 60
            const callbacks = [...frames.values()]
            frames.clear()
            callbacks.forEach(callback => callback(timestamp))
        }
    }
    const start = (tuning = {}) => {
        arena = startRageArena({ strings, onExit, services, tuning: { invincible: true, ...tuning } })
        renderer = WebGLRenderer.mock.results.at(-1).value
        return arena
    }
    const leave = () => {
        key('Escape')
        step(120)
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
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext())
        jest.replaceProperty(window, 'innerWidth', 1200)
        jest.replaceProperty(window, 'innerHeight', 800)
        document.body.innerHTML = PAGE
        // jsdom lays nothing out; give the task rows a place on screen.
        document.querySelectorAll('.row').forEach((row, i) => {
            row.getBoundingClientRect = () => ({
                left: 100,
                top: 200 + i * 40,
                right: 900,
                bottom: 234 + i * 40,
                width: 800,
                height: 34,
            })
        })
        localStorage.clear()
        WebGLRenderer.mockClear()
        onExit = jest.fn()
        services = {
            getOpenTasksToday: () => 3,
            getProjectColor: () => '#0C66FF',
            submitScore: jest.fn(() => Promise.resolve({ ok: true, highscore: 0, isNew: true })),
        }
    })

    afterEach(() => {
        arena?.stop({ immediate: true })
        jest.restoreAllMocks()
        jest.useRealTimers()
    })

    it('takes off from the page, turns its task rows into targets and starts firing on its own', () => {
        start()
        expect(hud().dataset.phase).toBe('takeoff')
        expect(hud().dataset.pageTargets).toBe('2')
        step(80)
        expect(hud().dataset.phase).toBe('flying')
        expect(hud().dataset.mission).toBe('1')
        expect(Number(hud().dataset.shots)).toBeGreaterThan(0)
    })

    it('slides the root element away while flying and puts it back exactly on Escape', () => {
        const root = document.getElementById('root')
        const html = document.body.innerHTML
        start()
        step(400)
        expect(root.style.transform).toMatch(/translate3d\(0, [1-9]/)
        expect(document.documentElement.style.overflow).toBe('hidden')
        leave()
        expect(isRageArenaActive()).toBe(false)
        expect(onExit).toHaveBeenCalledTimes(1)
        expect(root.hasAttribute('style')).toBe(false)
        expect(document.documentElement.hasAttribute('style')).toBe(false)
        expect(document.body.hasAttribute('style')).toBe(false)
        expect(document.body.innerHTML).toBe(html)
        expect(renderer.dispose).toHaveBeenCalledTimes(1)
        expect(frames.size).toBe(0)
    })

    it('restores an inline style the root already had, instead of wiping it', () => {
        const root = document.getElementById('root')
        root.style.transform = 'scale(1)'
        root.style.color = 'red'
        start()
        step(200)
        leave()
        expect(root.style.transform).toBe('scale(1)')
        expect(root.style.color).toBe('red')
        expect(root.style.willChange).toBe('')
    })

    it('keeps every key away from the app while it runs, and gives them back afterwards', () => {
        const appKey = jest.fn()
        document.addEventListener('keydown', appKey)
        start()
        step(80)
        key('a', 'KeyA')
        key(' ', 'Space')
        expect(appKey).not.toHaveBeenCalled()
        leave()
        key('x')
        expect(appKey).toHaveBeenCalledTimes(1)
        document.removeEventListener('keydown', appKey)
    })

    it('drops a mega bomb on Space, once per bomb', () => {
        start()
        step(80)
        expect(hud().dataset.bombs).toBe('2')
        key(' ', 'Space')
        key(' ', 'Space', 'keyup')
        key(' ', 'Space')
        key(' ', 'Space', 'keyup')
        key(' ', 'Space')
        step()
        expect(hud().dataset.bombs).toBe('0')
        expect(hud().dataset.bombsDropped).toBe('2')
    })

    it('summons the boss built from the open-task count, and a dead boss opens the hangar', () => {
        start({ bossAt: 1, noWaves: true })
        step(80 + 90)
        expect(hud().dataset.boss).toBe('3')
        expect(layer('boss').style.display).toBe('flex')
        // A mega bomb takes 50 off; 36 hit points (3 tasks × 12) do not survive it.
        key(' ', 'Space')
        step(2)
        expect(hud().dataset.boss).toBe('0')
        step(60 * 3)
        expect(hud().dataset.phase).toBe('hangar')
        expect(layer('hangar').style.display).toBe('flex')
        expect(Number(hud().dataset.credits)).toBeGreaterThan(0)
    })

    it('says so and skips the boss on a day with nothing open', () => {
        services.getOpenTasksToday = () => 0
        start({ bossAt: 1, noWaves: true })
        step(80 + 90)
        expect(layer('toast').textContent).toBe('Nothing open today: no boss!')
        step(60 * 3)
        expect(hud().dataset.phase).toBe('hangar')
    })

    it('sells hangar items for credits and launches the next mission from the hangar', () => {
        start({ bossAt: 1, noWaves: true })
        step(80 + 90)
        key(' ', 'Space')
        step(60 * 4)
        const before = Number(hud().dataset.credits)
        layer('hangar').querySelector('[data-hangar-item="bomb"] button').click()
        step()
        expect(hud().dataset.bombs).toBe('2')
        expect(Number(hud().dataset.credits)).toBe(before - 180)
        layer('hangar').querySelector('[data-launch]').click()
        step()
        expect(hud().dataset.phase).toBe('flying')
        expect(hud().dataset.mission).toBe('2')
        expect(layer('hangar').style.display).toBe('none')
    })

    it('ends in a game over when the shield runs out, submits the score once and can play again', () => {
        start({ invincible: false, startShield: 1, bossAt: 1, noWaves: true })
        step(80 + 90)
        // Let the boss's orbs find her.
        for (let i = 0; i < 60 * 30 && hud().dataset.phase !== 'gameover'; i++) step()
        expect(hud().dataset.phase).toBe('gameover')
        step(90)
        expect(layer('gameover').style.display).toBe('flex')
        key('Enter')
        expect(hud().dataset.phase).toBe('flying')
        expect(hud().dataset.mission).toBe('1')
        leave()
        expect(services.submitScore.mock.calls.length).toBeLessThanOrEqual(2)
    })

    it('ignores stale animation callbacks after an immediate stop, even when a new arena has started', () => {
        const oldArena = start()
        step(10)
        const oldRenderer = renderer
        const staleFrame = [...frames.values()][0]
        oldArena.stop({ immediate: true })
        const renders = oldRenderer.render.mock.calls.length
        start()
        staleFrame(timestamp + 1000)
        expect(oldRenderer.render).toHaveBeenCalledTimes(renders)
        expect(isRageArenaActive()).toBe(true)
        leave()
        expect(onExit).toHaveBeenCalledTimes(2)
        expect(frames.size).toBe(0)
    })

    it('survives a resize mid-flight and still leaves cleanly', () => {
        start()
        step(200)
        jest.replaceProperty(window, 'innerWidth', 600)
        window.dispatchEvent(new Event('resize'))
        step(30)
        leave()
        expect(isRageArenaActive()).toBe(false)
        expect(document.querySelectorAll('[data-rage-mode-layer]')).toHaveLength(0)
    })
})
