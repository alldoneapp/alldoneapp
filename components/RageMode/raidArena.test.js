import { WebGLRenderer } from 'three'
import { isRageArenaActive, startRageArena } from './raidArena'
import { buildRageStrings } from './rageStrings'
import { PICKUP_TYPES } from './raidPickups'

// The real scene, meshes, game logic, input handlers and lifecycle; only GPU rendering needs a
// substitute in jsdom. `browser-tests/rage-mode` covers what only a real browser can show.
jest.mock('three', () => ({
    ...jest.requireActual('three'),
    WebGLRenderer: jest.fn().mockImplementation(() => {
        let disposed = false
        return {
            domElement: global.document.createElement('canvas'),
            shadowMap: {},
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
const PROGRESS_KEY = 'alldone.rageMode.progress.user-1'
const saveLocal = (checkpoint, savedAt = 1, pending = false) =>
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ checkpoint, savedAt, pending }))
const flushPromises = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}
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
    const start = (tuning = {}, options = {}) => {
        arena = startRageArena({
            strings,
            onExit,
            services,
            progressScope: 'user-1',
            tuning: { invincible: true, ...tuning },
            ...options,
        })
        renderer = WebGLRenderer.mock.results.at(-1).value
        return arena
    }
    // Through the take-off from the avatar and the run-up on the page, to lift-off.
    const fly = () => {
        for (let i = 0; i < 900 && hud().dataset.phase !== 'flying'; i++) step()
        step(60)
    }
    const leave = () => {
        key('Escape')
        step(120)
    }

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-10-06T12:00:00Z'))
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
        fly()
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
        fly()
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
        fly()
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

    it('summons the boss wearing the open-task count, and a dead boss opens the hangar', () => {
        start({ bossAt: 1, noWaves: true, bossHp: 40 })
        fly()
        step(90)
        expect(hud().dataset.boss).toBe('3')
        expect(layer('boss').style.display).toBe('flex')
        // A mega bomb takes 50 off; this boss was tuned to 40.
        key(' ', 'Space')
        step(2)
        expect(hud().dataset.boss).toBe('0')
        step(60 * 3)
        expect(hud().dataset.phase).toBe('hangar')
        expect(layer('hangar').style.display).toBe('flex')
        expect(Number(hud().dataset.credits)).toBeGreaterThan(0)
    })

    it('still sends the boss on an empty inbox, just as tough, showing 0', () => {
        services.getOpenTasksToday = () => 0
        start({ bossAt: 1, noWaves: true })
        fly()
        step(90)
        expect(layer('boss').style.display).toBe('flex')
        expect(hud().dataset.boss).toBe('0')
        // A bomb does not finish it: it has the full strength of any other day's boss.
        key(' ', 'Space')
        step(60 * 4)
        expect(hud().dataset.phase).not.toBe('hangar')
    })

    it('sells hangar items for credits and launches the next mission from the hangar', () => {
        start({ bossAt: 1, noWaves: true, bossHp: 40 })
        fly()
        step(90)
        key(' ', 'Space')
        step(60 * 4)
        const before = Number(hud().dataset.credits)
        layer('hangar').querySelector('[data-hangar-item="bomb"] button').click()
        step()
        expect(hud().dataset.bombs).toBe('2')
        expect(Number(hud().dataset.credits)).toBe(before - 80)
        layer('hangar').querySelector('[data-launch]').click()
        step()
        expect(hud().dataset.phase).toBe('flying')
        expect(hud().dataset.mission).toBe('2')
        expect(layer('hangar').style.display).toBe('none')
    })

    it('ends in a game over when the shield runs out, submits the score once and can play again', () => {
        start({ invincible: false, startShield: 1, bossAt: 1, noWaves: true, bossHp: 40 })
        fly()
        step(90)
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

    it('remembers a completed mission and takes off from the next one next time', () => {
        start({ bossAt: 1, noWaves: true, bossHp: 40 })
        fly()
        step(90)
        key(' ', 'Space')
        step(60 * 4)
        expect(hud().dataset.phase).toBe('hangar')
        expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)).checkpoint).toMatchObject({ completed: 1 })
        leave()

        start({ noWaves: true })
        expect(hud().dataset.saved).toBe('true')
        fly()
        expect(hud().dataset.mission).toBe('2')
        expect(layer('toast').textContent).toBe('Continuing at mission {n}'.replace('{n}', 2))
        expect(Number(hud().dataset.credits)).toBeGreaterThan(0)
    })

    it('keeps progress per user', () => {
        localStorage.setItem(
            'alldone.rageMode.progress.someone-else',
            JSON.stringify({ checkpoint: { completed: 4 }, savedAt: 1 })
        )
        start()
        fly()
        expect(hud().dataset.mission).toBe('1')
        expect(hud().dataset.saved).toBe('false')
    })

    it('starts over from mission 1 only when ↺ is pressed twice', () => {
        saveLocal({ completed: 2, credits: 300 })
        start()
        fly()
        expect(hud().dataset.mission).toBe('3')
        const restart = hud().querySelector('[data-start-over]')
        restart.click()
        step()
        expect(hud().dataset.mission).toBe('3')
        expect(layer('toast').textContent).toBe('Press ↺ again to start over from mission 1')
        restart.click()
        step()
        expect(hud().dataset.mission).toBe('1')
        expect(hud().dataset.credits).toBe('0')
        expect(hud().dataset.saved).toBe('false')
        expect(JSON.parse(localStorage.getItem(PROGRESS_KEY))).toMatchObject({ checkpoint: null, pending: true })
    })

    it('replays from the checkpoint after a game over', () => {
        saveLocal({ completed: 1, credits: 200 })
        start({ invincible: false, startShield: 1, bossAt: 1, noWaves: true, bossHp: 40 })
        fly()
        step(90)
        for (let i = 0; i < 60 * 30 && hud().dataset.phase !== 'gameover'; i++) step()
        step(90)
        expect(layer('gameover').querySelector('[data-start-over]').style.display).toBe('flex')
        key('Enter')
        step()
        expect(hud().dataset.mission).toBe('2')
        // The checkpoint's credits, plus whatever the lost go earned on the way.
        expect(Number(hud().dataset.credits)).toBeGreaterThanOrEqual(200)
    })

    it('keeps what a lost game earned, and lets it be spent in the hangar before the next go', () => {
        saveLocal({ completed: 1, credits: 200 })
        start({ invincible: false, startShield: 1, bossAt: 1, noWaves: true, bossHp: 40, pickups: ['credits'] })
        fly()
        step(90)
        for (let i = 0; i < 60 * 30 && hud().dataset.phase !== 'gameover'; i++) step()
        step(90)
        const atDeath = Number(hud().dataset.credits)
        const earned = atDeath - 200
        expect(earned).toBeGreaterThanOrEqual(PICKUP_TYPES.credits.amount)
        expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)).checkpoint).toMatchObject({
            completed: 1,
            credits: atDeath,
        })
        const card = layer('gameover')
        expect(card.textContent).toContain(`+${earned} credits kept`)
        card.querySelector('[data-open-hangar]').click()
        step()
        expect(hud().dataset.phase).toBe('hangar')
        expect(layer('hangar').textContent).toContain('Mission 2 lost')
        layer('hangar').querySelector('[data-hangar-item="bomb"] button').click()
        step()
        expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)).checkpoint).toMatchObject({
            completed: 1,
            credits: atDeath - 80,
        })
        layer('hangar').querySelector('[data-launch]').click()
        step()
        expect(hud().dataset.phase).toBe('flying')
        expect(hud().dataset.mission).toBe('2')
        expect(Number(hud().dataset.credits)).toBe(atDeath - 80)
    })

    it('banks a lost first game even before mission 1 was ever cleared', () => {
        start({ invincible: false, startShield: 1, bossAt: 1, noWaves: true, bossHp: 40, pickups: ['credits'] })
        fly()
        step(90)
        for (let i = 0; i < 60 * 30 && hud().dataset.phase !== 'gameover'; i++) step()
        step(90)
        const atDeath = Number(hud().dataset.credits)
        expect(atDeath).toBeGreaterThanOrEqual(PICKUP_TYPES.credits.amount)
        key('Enter')
        step()
        expect(hud().dataset.mission).toBe('1')
        expect(Number(hud().dataset.credits)).toBe(atDeath)
    })

    describe('progress on every device', () => {
        it("takes off from the server's checkpoint when it is newer than this browser's", async () => {
            saveLocal({ completed: 1 }, 100)
            services.loadProfile = () =>
                Promise.resolve({
                    owned: [],
                    highscore: 0,
                    progress: { checkpoint: { completed: 4, credits: 90 }, savedAt: 500 },
                })
            start()
            await flushPromises()
            fly()
            expect(hud().dataset.mission).toBe('5')
            // Its credits too (plus whatever the first seconds of flying earned).
            expect(Number(hud().dataset.credits)).toBeGreaterThanOrEqual(90)
            expect(JSON.parse(localStorage.getItem(PROGRESS_KEY))).toMatchObject({ savedAt: 500, pending: false })
        })

        it.each([
            [1200, 800],
            [390, 844],
        ])('waits before take-off beyond 4.6 seconds (%s × %s)', async (width, height) => {
            jest.replaceProperty(window, 'innerWidth', width)
            jest.replaceProperty(window, 'innerHeight', height)
            saveLocal({ completed: 1, credits: 20, cannonLevel: 1 }, 100)
            let resolveProfile
            services.loadProfile = jest.fn(
                () =>
                    new Promise(resolve => {
                        resolveProfile = resolve
                    })
            )
            services.saveProgress = jest.fn()
            start()
            await flushPromises()
            const root = document.getElementById('root')
            const transform = root.style.transform
            step(60 * 15)
            jest.advanceTimersByTime(15000)
            key(' ', 'Space')
            key('b', 'KeyB')
            key('Enter')
            expect(hud().dataset.phase).toBe('loading')
            expect(hud().dataset.shots).toBe('0')
            expect(root.style.transform).toBe(transform)
            expect(layer('profile').textContent).toContain(strings.profileLoading)
            expect(layer('profile').style.display).toBe('flex')
            expect(layer('profile').querySelector('[data-retry-profile]').disabled).toBe(true)
            expect(services.saveProgress).not.toHaveBeenCalled()
            expect(services.submitScore).not.toHaveBeenCalled()
            resolveProfile({
                owned: [],
                highscore: 0,
                progress: { checkpoint: { completed: 5, credits: 90, cannonLevel: 3 }, savedAt: 500 },
            })
            await flushPromises()
            expect(hud().dataset.phase).toBe('takeoff')
            expect(layer('profile').style.display).toBe('none')
            step()
            expect(hud().dataset.phase).toBe('takeoff')
            expect(layer('help').style.opacity).not.toBe('0')
            fly()
            expect(hud().dataset.mission).toBe('6')
            expect(Number(hud().dataset.credits)).toBeGreaterThanOrEqual(90)
            expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)).checkpoint.cannonLevel).toBe(3)
            expect(services.loadProfile).toHaveBeenCalledTimes(1)
        })

        it.each([
            ['no local save', false],
            ['stale synced local save', true],
        ])('starts a new user at mission 1 with %s', async (_, stale) => {
            if (stale) saveLocal({ completed: 5 }, 100)
            services.loadProfile = () => Promise.resolve({ owned: ['blaster'], highscore: 0, progress: null })
            start()
            await flushPromises()
            fly()
            expect(hud().dataset.mission).toBe('1')
            expect(localStorage.getItem(PROGRESS_KEY)).toBeNull()
        })

        it.each(['reject', 'throw', 'empty', 'missing progress'])(
            'shows an error for a %s response and retries without stale gameplay',
            async kind => {
                saveLocal({ completed: 1, score: 500 }, 100, true)
                services.saveProgress = jest.fn()
                let resolveRetry
                services.loadProfile = jest
                    .fn()
                    .mockImplementationOnce(() => {
                        if (kind === 'throw') throw new Error('offline')
                        if (kind === 'empty') return Promise.resolve(null)
                        if (kind === 'missing progress') return Promise.resolve({ owned: [] })
                        return Promise.reject(new Error('unavailable'))
                    })
                    .mockImplementationOnce(
                        () =>
                            new Promise(resolve => {
                                resolveRetry = resolve
                            })
                    )
                start()
                await flushPromises()
                step(60 * 10)
                expect(hud().dataset.phase).toBe('profile-error')
                expect(layer('profile').textContent).toContain(strings.profileError)
                expect(hud().dataset.shots).toBe('0')
                expect(services.saveProgress).not.toHaveBeenCalled()
                expect(services.submitScore).not.toHaveBeenCalled()
                const retry = layer('profile').querySelector('[data-retry-profile]')
                retry.click()
                retry.click()
                await flushPromises()
                expect(services.loadProfile).toHaveBeenCalledTimes(2)
                expect(hud().dataset.phase).toBe('loading')
                expect(retry.disabled).toBe(true)
                step(60 * 10)
                expect(hud().dataset.phase).toBe('loading')
                resolveRetry({ owned: [], highscore: 0, progress: { checkpoint: { completed: 5 }, savedAt: 500 } })
                await flushPromises()
                fly()
                expect(hud().dataset.mission).toBe('6')
            }
        )

        it('exits while loading and ignores a late profile without writing or reopening', async () => {
            saveLocal({ completed: 1, score: 500 }, 100, true)
            const html = document.body.innerHTML
            let resolveProfile
            services.loadProfile = () =>
                new Promise(resolve => {
                    resolveProfile = resolve
                })
            services.saveProgress = jest.fn()
            start()
            await flushPromises()
            key('Escape')
            expect(isRageArenaActive()).toBe(false)
            expect(document.body.innerHTML).toBe(html)
            expect(onExit).toHaveBeenCalledTimes(1)
            resolveProfile({ owned: [], progress: { checkpoint: { completed: 5 }, savedAt: 500 } })
            await flushPromises()
            expect(document.body.innerHTML).toBe(html)
            expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)).checkpoint.completed).toBe(1)
            expect(services.saveProgress).not.toHaveBeenCalled()
            expect(services.submitScore).not.toHaveBeenCalled()
            expect(frames.size).toBe(0)
        })

        it('can close a failed load with the panel button', async () => {
            services.loadProfile = () => Promise.reject(new Error('offline'))
            start()
            await flushPromises()
            layer('profile').querySelector(`button[aria-label="${strings.exit}"]`).click()
            expect(isRageArenaActive()).toBe(false)
            expect(onExit).toHaveBeenCalledTimes(1)
        })

        it('pushes a save that never reached the server', async () => {
            saveLocal({ completed: 2 }, 900, true)
            services.saveProgress = jest.fn(() => Promise.resolve({ ok: true, savedAt: 1000 }))
            services.loadProfile = () =>
                Promise.resolve({ owned: [], highscore: 0, progress: { checkpoint: { completed: 1 }, savedAt: 200 } })
            start()
            await flushPromises()
            expect(services.saveProgress).toHaveBeenCalledWith(expect.objectContaining({ completed: 2 }))
            await flushPromises()
            expect(JSON.parse(localStorage.getItem(PROGRESS_KEY))).toMatchObject({ savedAt: 1000, pending: false })
        })

        it('saves a completed mission to the server and keeps the server timestamp', async () => {
            services.saveProgress = jest.fn(() => Promise.resolve({ ok: true, savedAt: 4242 }))
            start({ bossAt: 1, noWaves: true, bossHp: 40 })
            fly()
            step(90)
            key(' ', 'Space')
            step(60 * 4)
            expect(hud().dataset.phase).toBe('hangar')
            await flushPromises()
            expect(services.saveProgress).toHaveBeenCalledWith(expect.objectContaining({ completed: 1 }))
            await flushPromises()
            expect(JSON.parse(localStorage.getItem(PROGRESS_KEY))).toMatchObject({ savedAt: 4242, pending: false })
        })

        it('sends a start over to the server as an empty checkpoint', async () => {
            saveLocal({ completed: 3 })
            services.saveProgress = jest.fn(() => Promise.resolve({ ok: true, savedAt: 7 }))
            start()
            fly()
            const restart = hud().querySelector('[data-start-over]')
            restart.click()
            restart.click()
            await flushPromises()
            expect(services.saveProgress).toHaveBeenLastCalledWith(null)
        })

        it('keeps saves in order: one in flight, the newest sent last', async () => {
            const resolvers = []
            services.saveProgress = jest.fn(() => new Promise(resolve => resolvers.push(resolve)))
            start({ bossAt: 1, noWaves: true, bossHp: 40, startCredits: 1000 })
            fly()
            step(90)
            key(' ', 'Space')
            step(60 * 4)
            const hangar = layer('hangar')
            // The mission's own save is still in flight; both purchases queue behind it.
            hangar.querySelector('[data-hangar-item="bomb"] button').click()
            hangar.querySelector('[data-hangar-item="bomb"] button').click()
            await flushPromises()
            expect(services.saveProgress).toHaveBeenCalledTimes(1)
            resolvers[0]({ ok: true, savedAt: 1 })
            await flushPromises()
            expect(services.saveProgress).toHaveBeenCalledTimes(2)
            // Only the newest state follows, never the stale one in between.
            expect(services.saveProgress.mock.calls[1][0].bombs).toBe(services.saveProgress.mock.calls[0][0].bombs + 2)
        })
    })

    describe('the cast and its power-ups', () => {
        it('announces each new kind of enemy the first time it shows up', () => {
            start({ waves: [{ at: 0.5, pattern: 'zigzag', type: 'chat', count: 2, spacing: 0.3 }] })
            fly()
            step(30)
            expect(Number(hud().dataset.enemies)).toBeGreaterThan(0)
            expect(layer('toast').textContent).toContain('Raid enemy chat')
        })

        it('gives a power-up the moment she flies into it, and shows it running', () => {
            start({ pickups: ['coffee'] })
            fly()
            expect(hud().dataset.collected).toBe('1')
            expect(hud().dataset.lastPickup).toBe('coffee')
            step(10)
            expect(hud().dataset.buffs).toContain('coffee')
            expect(layer('buffs').querySelector('[data-buff="coffee"]')).toBeTruthy()
            step(60 * 9)
            expect(hud().dataset.buffs).not.toContain('coffee')
        })

        it('fires faster on coffee', () => {
            start()
            fly()
            const before = Number(hud().dataset.shots)
            step(60)
            const normal = Number(hud().dataset.shots) - before
            arena.stop({ immediate: true })
            start({ pickups: ['coffee'] })
            fly()
            const boosted = Number(hud().dataset.shots)
            step(60)
            expect(Number(hud().dataset.shots) - boosted).toBeGreaterThan(normal * 1.5)
        })

        it('keeps her unhurt inside the shield bubble', () => {
            start({ invincible: false, startShield: 50, pickups: ['shield'], bossAt: 1, noWaves: true })
            fly()
            const shield = hud().dataset.shield
            step(60 * 3)
            expect(hud().dataset.shield).toBe(shield)
        })

        it('applies instant pickups straight away', () => {
            start({ pickups: ['bomb', 'credits'] })
            fly()
            expect(hud().dataset.bombs).toBe('3')
            expect(Number(hud().dataset.credits)).toBeGreaterThanOrEqual(PICKUP_TYPES.credits.amount)
        })
    })

    it('opens the weapon shop mid-mission with B, holds the game still, and resumes on Escape', () => {
        start()
        fly()
        key('b', 'KeyB')
        expect(hud().dataset.shop).toBe('open')
        expect(hud().dataset.paused).toBe('true')
        const shots = hud().dataset.shots
        step(60)
        expect(hud().dataset.shots).toBe(shots)
        key('Escape')
        expect(hud().dataset.shop).toBeUndefined()
        expect(isRageArenaActive()).toBe(true)
        step(30)
        expect(Number(hud().dataset.shots)).toBeGreaterThan(Number(shots))
        // The 🛒 in the weapon bar does the same.
        layer('weapons').querySelector('[data-shop]').click()
        expect(hud().dataset.shop).toBe('open')
    })

    it('steers relative to where Anna is, so taking over the mouse never makes her jump', () => {
        const move = (x, y) =>
            layer('input').dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
        start()
        fly()
        const x0 = Number(hud().dataset.shipX)
        // The hidden cursor is still far away (on the crosshair): the first movement must not pull her there.
        move(1150, 30)
        step(30)
        expect(Math.abs(Number(hud().dataset.shipX) - x0)).toBeLessThan(2)
        // Moving the mouse 100px left moves her left too — never the other way, even though the
        // gap to the cursor (far right) is closing.
        move(1050, 30)
        step(60)
        const moved = x0 - Number(hud().dataset.shipX)
        expect(moved).toBeGreaterThanOrEqual(60)
        expect(moved).toBeLessThanOrEqual(101)
        // Moving towards the cursor's side catches up faster.
        const x1 = Number(hud().dataset.shipX)
        move(1150, 30)
        step(60)
        expect(Number(hud().dataset.shipX) - x1).toBeGreaterThan(100)
    })

    describe('five boss fights', () => {
        it.each(['backlog', 'inbox', 'calendar', 'bell', 'clock'])('%s: arrives, is announced and fights', kind => {
            start({ bossAt: 1, noWaves: true, bossKind: kind })
            fly()
            step(60 * 7)
            expect(hud().dataset.bossKind).toBe(kind)
            expect(layer('boss').textContent).toContain(`Raid boss ${kind}`)
            // It wears the count (3) and counts down as Anna's auto-fire wears it away.
            expect(Number(hud().dataset.boss)).toBeGreaterThan(0)
            expect(Number(hud().dataset.boss)).toBeLessThanOrEqual(3)
        })

        it('sends a different boss each mission', () => {
            start({ bossAt: 1, noWaves: true, bossHp: 40 })
            fly()
            step(90)
            expect(hud().dataset.bossKind).toBe('backlog')
            key(' ', 'Space')
            step(60 * 4)
            layer('hangar').querySelector('[data-launch]').click()
            step(60 * 3)
            expect(hud().dataset.bossKind).toBe('inbox')
        })

        it('warns with the calendar beams and rings out the bell before they can hurt', () => {
            start({ bossAt: 1, noWaves: true, bossKind: 'calendar' })
            fly()
            let beams = 0
            for (let i = 0; i < 60 * 8; i++) {
                step()
                beams = Math.max(beams, Number(hud().dataset.beams || 0))
            }
            expect(beams).toBeGreaterThan(0)
            arena.stop({ immediate: true })
            start({ bossAt: 1, noWaves: true, bossKind: 'bell' })
            fly()
            let waves = 0
            for (let i = 0; i < 60 * 8; i++) {
                step()
                waves = Math.max(waves, Number(hud().dataset.waves || 0))
            }
            expect(waves).toBeGreaterThan(0)
        })
    })

    it('offers the weapon shop on the game-over card', () => {
        start({ invincible: false, startShield: 1, bossAt: 1, noWaves: true, bossHp: 40 })
        fly()
        for (let i = 0; i < 60 * 30 && hud().dataset.phase !== 'gameover'; i++) step()
        step(90)
        layer('gameover').querySelector('[data-shop]').click()
        expect(hud().dataset.shop).toBe('open')
        key('Escape')
        expect(hud().dataset.shop).toBeUndefined()
        expect(hud().dataset.phase).toBe('gameover')
    })

    it('fits the raid to a phone: a sparser wave than on a laptop', () => {
        const wave = [{ at: 0.5, pattern: 'weave', type: 'mail', count: 8, spacing: 0.1, x: 0.5 }]
        const peak = () => {
            let most = 0
            for (let i = 0; i < 90; i++) {
                step()
                most = Math.max(most, Number(hud().dataset.enemies || 0))
            }
            return most
        }
        start({ waves: wave })
        fly()
        const laptop = peak()
        arena.stop({ immediate: true })
        jest.replaceProperty(window, 'innerWidth', 390)
        jest.replaceProperty(window, 'innerHeight', 844)
        start({ waves: wave })
        expect(Number(hud().dataset.density)).toBeLessThan(0.65)
        fly()
        expect(peak()).toBeLessThan(laptop)
    })

    describe('global leaderboard', () => {
        const top = [
            { rank: 1, name: 'Zoë', score: 9000, you: false },
            { rank: 2, name: 'Pilot 4821', score: 7000, you: false },
            { rank: 3, name: 'Max', score: 5000, you: false },
            { rank: 4, name: 'Ana', score: 3000, you: false },
            { rank: 5, name: 'Bo', score: 2000, you: false },
        ]
        const board = () => layer('gameover').querySelector('[data-leaderboard]')
        const dieQuickly = async () => {
            start({ invincible: false, startShield: 1, bossAt: 1, noWaves: true, bossHp: 40 })
            fly()
            for (let i = 0; i < 60 * 30 && hud().dataset.phase !== 'gameover'; i++) step()
            await flushPromises()
            step(90)
        }

        beforeEach(() => {
            let name = 'Pilot 1234'
            services.submitScore = jest.fn(() => Promise.resolve({ ok: true, highscore: 400, isNew: true }))
            services.loadLeaderboard = jest.fn(() =>
                Promise.resolve({ top, you: { rank: 12, name, score: 400 }, total: 40, name })
            )
            services.setName = jest.fn(next => {
                if (next.length < 2) return Promise.resolve({ ok: false })
                name = next
                return Promise.resolve({ ok: true, name })
            })
        })

        it('shows the top five and your rank below them after a game over, once the score is posted', async () => {
            await dieQuickly()
            expect(services.submitScore).toHaveBeenCalled()
            expect(services.loadLeaderboard).toHaveBeenCalled()
            expect(board().querySelectorAll('[data-rank]')).toHaveLength(6)
            expect(board().querySelector('[data-you]').textContent).toContain('Pilot 1234')
            expect(board().textContent).toContain('Zoë')
            expect(hud().dataset.boardRank).toBe('12')
        })

        it('highlights you inside the top five when you are there', async () => {
            services.loadLeaderboard = jest.fn(() =>
                Promise.resolve({
                    top: top.map((row, i) => (i === 2 ? { ...row, name: 'Me', you: true } : row)),
                    you: { rank: 3, name: 'Me', score: 5000 },
                    total: 40,
                    name: 'Me',
                })
            )
            await dieQuickly()
            expect(board().querySelectorAll('[data-rank]')).toHaveLength(5)
            expect(board().querySelector('[data-you]').getAttribute('data-rank')).toBe('3')
        })

        it('lets you pick the name you play under, typing without setting off the game', async () => {
            const appKey = jest.fn()
            document.addEventListener('keydown', appKey)
            await dieQuickly()
            board().querySelector('[data-rename]').click()
            jest.runOnlyPendingTimers()
            const input = board().querySelector('input')
            input.value = 'Space Ace'
            const bombs = hud().dataset.bombs
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', bubbles: true }))
            input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
            expect(hud().dataset.shop).toBeUndefined()
            expect(hud().dataset.bombs).toBe(bombs)
            expect(appKey).not.toHaveBeenCalled()
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
            await flushPromises()
            expect(services.setName).toHaveBeenCalledWith('Space Ace')
            expect(board().querySelector('input')).toBeNull()
            expect(board().querySelector('[data-you]').textContent).toContain('Space Ace')
            document.removeEventListener('keydown', appKey)
        })

        it('says so when a name is not allowed', async () => {
            await dieQuickly()
            board().querySelector('[data-rename]').click()
            const input = board().querySelector('input')
            input.value = 'x'
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
            await flushPromises()
            expect(board().textContent).toContain('Raid leaderboard invalid name')
        })

        it('shows the board in the hangar too, posting the score without counting a finished game', async () => {
            start({ bossAt: 1, noWaves: true, bossHp: 40 })
            fly()
            step(90)
            key(' ', 'Space')
            step(60 * 4)
            expect(hud().dataset.phase).toBe('hangar')
            await flushPromises()
            expect(services.submitScore).toHaveBeenCalledWith(expect.any(Number), { final: false })
            expect(layer('hangar').querySelector('[data-leaderboard] [data-you]')).toBeTruthy()
        })

        it('copes with a board that cannot be loaded', async () => {
            services.loadLeaderboard = jest.fn(() => Promise.reject(new Error('offline')))
            await dieQuickly()
            expect(board().textContent).toContain('Raid leaderboard error')
        })
    })

    it('greets on Enter, holds fire while she does, and is back in formation afterwards', () => {
        start()
        fly()
        key('Enter')
        step()
        expect(hud().dataset.greeting).toBeTruthy()
        const shots = hud().dataset.shots
        step(60)
        expect(hud().dataset.shots).toBe(shots)
        step(60 * 4)
        expect(hud().dataset.greeting).toBeUndefined()
        step(30)
        expect(Number(hud().dataset.shots)).toBeGreaterThan(Number(shots))
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
