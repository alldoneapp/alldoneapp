/**
 * AT-2367 — "start a new day pop-up ... does not close the pop-up and load
 * things properly ... or it's really slow".
 *
 * The popup used to close only as a SIDE EFFECT of remote work finishing:
 *
 *     await saveDirtyHappinessEntries()          // Firestore writes
 *     await setUserStatisticsModalDate(...)      // Firestore write
 *     await deleteCacheAndRefresh()              // per-project scan + SW update + reload
 *     resetModalState()                          // <- only now does it close
 *
 * A Firestore write promise settles on the SERVER ack (AT-2340), so on a slow
 * mobile connection every one of those is seconds and offline the first one
 * never settles at all — the popup sat there with its spinner forever while
 * the mutation was already durable in the local queue.
 *
 * `startNewDay` inverts the order: local state and the popup first, I/O after.
 * These tests pin that inversion, because it is invisible in the happy path —
 * everything passes either way when the writes resolve instantly.
 */

import { NEW_DAY_WRITE_GRACE_MS, startNewDay } from '../../utils/NewDayModalHelper'

const neverSettles = () => new Promise(() => {})
const immediateWait = () => Promise.resolve()

describe('startNewDay (AT-2367)', () => {
    let calls
    let deps

    beforeEach(() => {
        calls = []
        const track = name => calls.push(name)
        deps = {
            now: () => 1700000000000,
            applyLocalAcknowledgement: jest.fn(() => track('applyLocalAcknowledgement')),
            closePopup: jest.fn(() => track('closePopup')),
            persistAcknowledgement: jest.fn(() => {
                track('persistAcknowledgement')
                return Promise.resolve()
            }),
            persistHappinessDrafts: jest.fn(() => {
                track('persistHappinessDrafts')
                return Promise.resolve()
            }),
            onError: jest.fn(),
            wait: immediateWait,
        }
    })

    it('applies the acknowledgement locally and closes the popup before any I/O', () => {
        // Not awaited on purpose: an async function runs synchronously up to
        // its first await, and everything the USER perceives has to live there.
        startNewDay({ ...deps, persistAcknowledgement: neverSettles, persistHappinessDrafts: neverSettles })

        expect(deps.applyLocalAcknowledgement).toHaveBeenCalledWith(1700000000000)
        expect(deps.closePopup).toHaveBeenCalledTimes(1)
        expect(calls.slice(0, 2)).toEqual(['applyLocalAcknowledgement', 'closePopup'])
    })

    it('acknowledges the day even when the happiness write never settles', async () => {
        // The two writes used to be chained. Offline (or on a stalled
        // connection) the happiness ack never arrives, so the day itself was
        // never acknowledged and the popup came back on the next boot.
        startNewDay({ ...deps, persistHappinessDrafts: neverSettles })

        await Promise.resolve()
        expect(deps.persistAcknowledgement).toHaveBeenCalledWith(1700000000000)
    })

    it('does not reload the app when this device did not cross midnight while open', async () => {
        const result = await startNewDay(deps)

        expect(result).toEqual({ statisticsModalDate: 1700000000000, reloaded: false })
    })

    it('reloads when asked, after giving the writes a bounded grace period', async () => {
        const reloadApp = jest.fn(() => calls.push('reloadApp'))

        await startNewDay({ ...deps, reloadApp })

        expect(reloadApp).toHaveBeenCalledTimes(1)
        // The popup is gone before the reload starts, so a slow reload can
        // never look like a stuck popup.
        expect(calls.indexOf('closePopup')).toBeLessThan(calls.indexOf('reloadApp'))
    })

    it('reloads even when the writes never settle', async () => {
        const waited = []
        const reloadApp = jest.fn()

        await startNewDay({
            ...deps,
            persistAcknowledgement: neverSettles,
            persistHappinessDrafts: neverSettles,
            reloadApp,
            wait: ms => {
                waited.push(ms)
                return Promise.resolve()
            },
        })

        expect(reloadApp).toHaveBeenCalledTimes(1)
        expect(waited).toEqual([NEW_DAY_WRITE_GRACE_MS])
    })

    it('reports a failing write instead of swallowing it, and still finishes', async () => {
        const boom = new Error('permission-denied')
        const reloadApp = jest.fn()

        const result = await startNewDay({
            ...deps,
            persistAcknowledgement: () => Promise.reject(boom),
            reloadApp,
        })

        expect(deps.onError).toHaveBeenCalledWith(boom, 'persistAcknowledgement')
        expect(reloadApp).toHaveBeenCalledTimes(1)
        expect(result.reloaded).toBe(true)
    })

    it('still closes the popup when applying local state throws', () => {
        const boom = new Error('store unavailable')

        startNewDay({
            ...deps,
            applyLocalAcknowledgement: () => {
                throw boom
            },
        })

        expect(deps.onError).toHaveBeenCalledWith(boom, 'applyLocalAcknowledgement')
        expect(deps.closePopup).toHaveBeenCalledTimes(1)
    })

    it('never rejects, whatever the reload does', async () => {
        await expect(
            startNewDay({ ...deps, reloadApp: () => Promise.reject(new Error('navigation blocked')) })
        ).resolves.toEqual({ statisticsModalDate: 1700000000000, reloaded: true })
    })
})
