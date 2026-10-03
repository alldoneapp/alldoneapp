import {
    checkpointFromRun,
    progressKey,
    readRecord,
    reconcile,
    runFromCheckpoint,
    sanitizeCheckpoint,
    sanitizeRecord,
    writeRecord,
} from './raidProgress'
import { BASE_MAX_SHIELD, buyHangarItem, createRun, MAX_BOMBS, SHIELD_CAP } from './raidRun'

// The server applies the same rules to its copy; Functions code cannot enter the web bundle.
const server = require('../../functions/RageMode/rageModeProgress')

const record = (completed, savedAt, pending = false) => ({
    checkpoint: completed ? sanitizeCheckpoint({ completed }) : null,
    savedAt,
    pending,
})

describe('raid progress', () => {
    beforeEach(() => localStorage.clear())

    it('continues at the mission after the one completed, with the run as it left the hangar', () => {
        const run = createRun()
        run.mission = 2
        run.score = 4200
        run.credits = 2000
        buyHangarItem(run, 'cannon')
        writeRecord('u1', { checkpoint: checkpointFromRun(run), savedAt: 5, pending: false })
        const resumed = runFromCheckpoint(readRecord('u1').checkpoint)
        expect(resumed).toMatchObject({ mission: 3, score: 4200, credits: 1100, cannonLevel: 2, kills: 0 })
    })

    it('starts at mission 1 with nothing saved, and after a start over', () => {
        expect(readRecord('u1')).toBeNull()
        expect(runFromCheckpoint(null).mission).toBe(1)
        writeRecord('u1', record(0, 9, true))
        expect(readRecord('u1')).toEqual({ checkpoint: null, savedAt: 9, pending: true })
        writeRecord('u1', null)
        expect(readRecord('u1')).toBeNull()
    })

    it('keeps one record per user', () => {
        writeRecord('u1', record(3, 1))
        expect(readRecord('u2')).toBeNull()
        expect(progressKey('u1')).not.toBe(progressKey('u2'))
    })

    describe('which copy to fly with', () => {
        it("takes the server's copy — it may come from another device", () => {
            expect(reconcile(record(1, 100), record(4, 200))).toEqual({ record: record(4, 200), push: false })
            expect(reconcile(null, record(4, 200))).toEqual({ record: record(4, 200), push: false })
        })

        it('respects a start over made on another device', () => {
            expect(reconcile(record(5, 100), record(0, 300)).record.checkpoint).toBeNull()
        })

        it('pushes up a save that never reached the server, when it is the newer one', () => {
            expect(reconcile(record(3, 500, true), record(2, 200))).toEqual({
                record: record(3, 500, true),
                push: true,
            })
            expect(reconcile(record(3, 500, true), null)).toEqual({ record: record(3, 500, true), push: true })
        })

        it('drops an older unsynced save when the server has something newer', () => {
            expect(reconcile(record(3, 100, true), record(6, 900))).toEqual({ record: record(6, 900), push: false })
        })

        it('keeps a synced local copy when the server has nothing', () => {
            expect(reconcile(record(2, 100), null)).toEqual({ record: record(2, 100), push: false })
        })
    })

    it('clamps a hand-edited checkpoint to what the game could have produced', () => {
        const forged = {
            completed: '7.9',
            score: -5,
            credits: 'lots',
            maxShield: 9999,
            shield: 0,
            bombs: 99,
            cannonLevel: 42,
        }
        expect(sanitizeCheckpoint(forged)).toEqual({
            completed: 7,
            score: 0,
            credits: 0,
            maxShield: SHIELD_CAP,
            shield: 1,
            bombs: MAX_BOMBS,
            cannonLevel: 3,
        })
        expect(sanitizeCheckpoint({ completed: 0 })).toBeNull()
        expect(sanitizeCheckpoint('mission 5')).toBeNull()
        expect(sanitizeCheckpoint({ completed: 2 }).shield).toBe(BASE_MAX_SHIELD)
        expect(sanitizeRecord({ checkpoint: { completed: 2 } })).toBeNull()
        expect(sanitizeRecord({ checkpoint: forged, savedAt: 3, pending: 'yes' }).pending).toBe(false)
    })

    it('applies exactly the rules the server applies', () => {
        const samples = [
            { completed: 3, score: 1200, credits: 400, maxShield: 125, shield: 80, bombs: 3, cannonLevel: 2 },
            { completed: '7.9', score: -5, credits: 'lots', maxShield: 9999, shield: 0, bombs: 99, cannonLevel: 42 },
            { completed: 1e9, credits: 2e9 },
            { completed: 0 },
            null,
            'nope',
        ]
        samples.forEach(sample => expect(sanitizeCheckpoint(sample)).toEqual(server.sanitizeCheckpoint(sample)))
    })

    it('ignores storage it cannot parse or reach', () => {
        localStorage.setItem(progressKey('u1'), '{not json')
        expect(readRecord('u1')).toBeNull()
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        expect(readRecord('u1')).toBeNull()
        getItem.mockRestore()
    })
})
