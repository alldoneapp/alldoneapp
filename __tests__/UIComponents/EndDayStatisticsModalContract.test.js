const fs = require('fs')
const path = require('path')

/**
 * AT-2367 — "Start new day" contract, guarded at the source level.
 *
 * `EndDayStatisticsModal` cannot practically be mounted in jsdom (it pulls
 * `BackendBridge` → `firestore.js` and the whole redux store with it), so the
 * behaviour that the bug was about is pinned the same way
 * `OfflineWriteAckCallSites.test.js` pins its call sites. The orchestration
 * itself is covered behaviourally by `__tests__/utils/StartNewDayFlow.test.js`.
 *
 * What must never come back:
 *
 *   - a bare `await` on a Firestore write in the press handler: the promise
 *     settles on the SERVER ack (AT-2340), so offline it never settles and the
 *     popup stays up forever with its spinner;
 *   - the acknowledgement being skipped while offline — the popup then
 *     reappeared on the next boot for a day the user had already started;
 *   - two write paths for one happiness entry: a rating tap persists
 *     immediately and "Start new day" re-persisted the same value, and every
 *     `setProjectHappiness` writes a fresh feed entry plus a feed-count bump.
 */

const MODAL = 'components/UIComponents/FloatModals/EndDayStatisticsModal.js'

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', MODAL), 'utf8')

describe('EndDayStatisticsModal "Start new day" contract (AT-2367)', () => {
    it('runs the flow through the shared, tested orchestration helper', () => {
        expect(source).toMatch(/startNewDay as runStartNewDay.*from '\.\.\/\.\.\/\.\.\/utils\/NewDayModalHelper'/)
        expect(source).toMatch(/return runStartNewDay\(\{/)
    })

    it('never parks the press handler on a server ack', () => {
        expect(source).toMatch(/import \{ awaitWriteAck \} from '\.\.\/\.\.\/\.\.\/utils\/backends\/offlineWriteAck'/)
        expect(source).not.toMatch(/await setUserStatisticsModalDate\(/)
        expect(source).not.toMatch(/await saveDirtyHappinessEntries\(/)
        expect(source).toMatch(/awaitWriteAck\(\s*\n?\s*setUserStatisticsModalDate\(/)
    })

    it('acknowledges the day regardless of whether the statistics could be read', () => {
        // The old handler wrapped the whole acknowledgement in
        // `if (!isOfflineRef.current) { ... }`.
        expect(source).not.toMatch(/if \(!isOfflineRef\.current\) \{\s*\n\s*const newStatisticsModalDate/)
    })

    it('reloads only the device that actually crossed midnight while open', () => {
        expect(source).toMatch(/crossedMidnightWhileOpen \? \(\) => deleteCacheAndRefresh\(\) : undefined/)
    })

    it('writes a happiness entry through one deduplicated path', () => {
        // Exactly one call site for the backend write.
        const writes = source.match(/Backend\.setProjectHappiness\(/g) || []
        expect(writes).toHaveLength(1)
        expect(source).toMatch(/persistedHappinessRef/)
        expect(source).toMatch(
            /if \(persistedHappinessRef\.current\[project\.id\] === signature\) return Promise\.resolve\(\)/
        )
    })

    it('keeps the double-press guard on the button', () => {
        expect(source).toMatch(/if \(isSavingStartNewDay\.current\) return/)
        expect(source).toMatch(/disabled=\{startNewDayIsLoading\}/)
    })
})
