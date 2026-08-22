const fs = require('fs')
const path = require('path')

/**
 * AT-2340 — the core write paths must not park on a server ack that cannot
 * arrive while offline.
 *
 * A Firestore write promise resolves on the SERVER ack. Offline it never
 * resolves, so everything after `await <write>` is unreachable — not slow,
 * unreachable — while the mutation itself is already durable in the persisted
 * write queue. That cost three concrete behaviours:
 *
 *   - completing a task offline never awarded XP, never wrote the done feed and
 *     never added the follower (they sit after `await taskBatch.commit()`), and
 *     they were lost for good if the tab closed before reconnect;
 *   - `updateTask` / `setTaskDueDate` / send-to-backlog armed a focus handoff
 *     BEFORE their commit and ran it after, so offline the handoff stayed open
 *     forever with the optimistic focus already moved;
 *   - posting a comment never closed the modal, because the wrappers call
 *     `closeModal()` after `await createObjectMessage(...)`.
 *
 * These functions are impractical to mount in jsdom (tasksFirestore alone pulls
 * in ~30 modules), so the contract is guarded at the source level — the same
 * approach as `MoveNoteOwner.test.js` and `WebShellScrollContainers.test.js`.
 * The behaviour of the helper itself is covered by
 * `utils/backends/offlineWriteAck.test.js`.
 */

const read = relativePath => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')

const TASKS = 'utils/backends/Tasks/tasksFirestore.js'
const COMMENTS = 'utils/backends/Chats/chatsComments.js'

describe('offline write-ack call sites', () => {
    it('routes the task-completion commit through awaitWriteAck', () => {
        const source = read(TASKS)

        expect(source).toMatch(/import \{[^}]*\bawaitWriteAck\b[^}]*\} from '\.\.\/offlineWriteAck'/)
        expect(source).toMatch(/awaitWriteAck\(taskBatch\.commit\(\)/)
        // The bare await is what made XP / done feed / follower unreachable.
        expect(source).not.toMatch(/\n {4}await taskBatch\.commit\(\)/)
    })

    it('routes every focus handoff through awaitWriteAck', () => {
        const source = read(TASKS)

        // updateTask, setTaskDueDate and send-to-backlog all arm the handoff
        // before their commit and run it after.
        const guardedHandoffs = source.match(/awaitWriteAck\(\s*\n?\s*runFocusHandoff\(/g) || []
        // updateTask, setTaskDueDate, send-to-backlog, setTaskStatus and the
        // workflow handoff.
        expect(guardedHandoffs.length).toBeGreaterThanOrEqual(5)
        expect(source).not.toMatch(/await runFocusHandoff\(/)
    })

    it('commits the done-feed batch even when a feed side effect fails', () => {
        const source = read(TASKS)

        // tryAddFollower reads the followers document, and offline a read for a
        // document that is not cached rejects outright. That used to discard the
        // whole staged done feed with it.
        expect(source).toMatch(/\} finally \{\n\s+feedBatch\.commit\(\)\n\s+\}/)
    })

    it('does not park comment creation on an ack that cannot arrive', () => {
        const source = read(COMMENTS)

        expect(source).toMatch(/import \{ awaitWriteAck \} from '\.\.\/offlineWriteAck'/)
        expect(source).toMatch(/awaitWriteAck\(Promise\.all\(promises\), 'createObjectMessage comment'\)/)
        expect(source).toMatch(/awaitWriteAck\(\s*\n?\s*updateLastCommentData\(/)
    })

    it('keeps the online path awaiting — durability there depends on it', () => {
        // `awaitWriteAck` returns the write promise unchanged when online, so
        // these call sites still await the real ack. Guarded here so a future
        // "simplification" to a plain fire-and-forget is caught.
        const helper = read('utils/backends/offlineWriteAck.js')
        expect(helper).toMatch(/if \(!isAppOffline\(\)\) return settled/)
    })
})
