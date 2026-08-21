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
 *
 * The happiness half of that contract MOVED in AT-2392: Settings → Happiness
 * grew a "Rate happiness" button that reuses these rows, so the state, the
 * watchers and the deduplicated write live in `useProjectHappinessEditor` and
 * are asserted there. Sharing the module is what keeps the second surface from
 * re-introducing AT-2367's duplicate feed entries with its own copy.
 */

const MODAL = 'components/UIComponents/FloatModals/EndDayStatisticsModal.js'
const EDITOR = 'components/ProjectHappiness/useProjectHappinessEditor.js'

const read = file => fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8')

const source = read(MODAL)
const editorSource = read(EDITOR)

describe('EndDayStatisticsModal "Start new day" contract (AT-2367)', () => {
    it('runs the flow through the shared, tested orchestration helper', () => {
        expect(source).toMatch(/startNewDay as runStartNewDay.*from '\.\.\/\.\.\/\.\.\/utils\/NewDayModalHelper'/)
        expect(source).toMatch(/return runStartNewDay\(\{/)
    })

    it('never parks the press handler on a server ack', () => {
        expect(source).toMatch(/import \{ awaitWriteAck \} from '\.\.\/\.\.\/\.\.\/utils\/backends\/offlineWriteAck'/)
        expect(source).not.toMatch(/await setUserStatisticsModalDate\(/)
        expect(source).not.toMatch(/await happinessEditor\.(save|take)DirtyEntries\(/)
        expect(source).toMatch(/awaitWriteAck\(\s*\n?\s*setUserStatisticsModalDate\(/)
    })

    it('snapshots the happiness drafts before the close that clears them', () => {
        // `startNewDay` closes the popup (which resets the editor) BEFORE it
        // issues any write, so reading the drafts inside the flow would flush
        // an already-empty set — a comment typed but never blurred would be
        // silently dropped.
        const snapshot = source.indexOf('happinessEditor.takeDirtyEntries(acknowledgedStatsDate)')
        const flow = source.indexOf('return runStartNewDay({')

        expect(snapshot).toBeGreaterThan(-1)
        expect(snapshot).toBeLessThan(flow)
        expect(source).toMatch(/persistHappinessDrafts,/)
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
        // The popup owns no write of its own: it drives the shared editor.
        expect(source).not.toMatch(/Backend\.setProjectHappiness\(/)
        expect(source).toMatch(
            /import useProjectHappinessEditor from '\.\.\/\.\.\/ProjectHappiness\/useProjectHappinessEditor'/
        )

        // Exactly one call site for the backend write, in the shared editor.
        const writes = editorSource.match(/Backend\.setProjectHappiness\(/g) || []
        expect(writes).toHaveLength(1)
        expect(editorSource).toMatch(/persistedHappinessRef/)
        expect(editorSource).toMatch(
            /if \(persistedHappinessRef\.current\[project\.id\] === signature\) return Promise\.resolve\(\)/
        )
    })

    it('keeps the rating rows themselves shared, not copied', () => {
        // A second copy of these rows would drift from the deduped write path
        // above, which is exactly how AT-2367 would come back in the new
        // surface. Both hosts must render the same component.
        const hosts = [MODAL, 'components/ProjectHappiness/HappinessRatingModal.js']

        hosts.forEach(host => {
            expect(read(host)).toMatch(/<ProjectHappinessRatingList/)
        })
    })

    it('keeps the double-press guard on the button', () => {
        expect(source).toMatch(/if \(isSavingStartNewDay\.current\) return/)
        expect(source).toMatch(/disabled=\{startNewDayIsLoading\}/)
    })
})
