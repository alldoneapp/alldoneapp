const fs = require('fs')
const path = require('path')
const { parse } = require('@babel/parser')

/**
 * AT-2367 — "Start new day" contract, guarded at the source level.
 *
 * These assertions guard the shared wiring. The real mounted popup's close,
 * persistence and coordinated reload behavior is covered by
 * `__tests__/FloatModals/EndDayStatisticsModal.test.js`; the orchestration's
 * timing is covered by `__tests__/utils/StartNewDayFlow.test.js`.
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

// Inspect the handler and its callbacks rather than matching a whole-file
// spelling: the background persistence callback deliberately awaits a server
// acknowledgement, while the button handler must still close synchronously.
const findNode = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined
    if (predicate(node)) return node
    for (const child of Object.values(node)) {
        const found = Array.isArray(child)
            ? child.map(value => findNode(value, predicate)).find(Boolean)
            : findNode(child, predicate)
        if (found) return found
    }
}
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
const handler = findNode(ast, node => node.type === 'VariableDeclarator' && node.id.name === 'onPressStartNewDay').init
const flow = findNode(handler, node => node.type === 'CallExpression' && node.callee.name === 'runStartNewDay')
const flowOption = name => flow.arguments[0].properties.find(property => property.key.name === name).value

describe('EndDayStatisticsModal "Start new day" contract (AT-2367)', () => {
    it('runs the flow through the shared, tested orchestration helper', () => {
        expect(source).toMatch(/startNewDay as runStartNewDay.*from '\.\.\/\.\.\/\.\.\/utils\/NewDayModalHelper'/)
        expect(source).toMatch(/return runStartNewDay\(\{/)
    })

    it('never parks the press handler on a server ack', () => {
        expect(handler.async).toBe(false)
        expect(flowOption('persistAcknowledgement')).toMatchObject({
            type: 'ArrowFunctionExpression',
            body: { type: 'CallExpression', callee: { name: 'persistPendingAcknowledgement' } },
        })
        expect(findNode(handler, node => node.type === 'AwaitExpression')).toBeUndefined()
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

    it('routes the midnight device reload through the shared coordinator', () => {
        const reload = flowOption('reloadApp')
        expect(reload).toMatchObject({
            type: 'ConditionalExpression',
            test: { name: 'crossedMidnightWhileOpen' },
            alternate: { name: 'undefined' },
            consequent: {
                type: 'ArrowFunctionExpression',
                body: {
                    type: 'CallExpression',
                    callee: { object: { name: 'dayReloadCoordinator' }, property: { name: 'request' } },
                },
            },
        })
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
