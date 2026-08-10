const fs = require('fs')
const path = require('path')

/**
 * AT-2194 — moving an assistant-owned note between projects must not strip its owner.
 *
 * `utils/backends/Notes/notesFirestore.js` guards this with `resolveMovedNoteOwnerId`, which
 * keeps an owner that still resolves in the target project (an assistant resolves across the
 * user's projects) and only falls back to the acting user otherwise.
 *
 * That guard was silently bypassed: the "move to project" modal resolved the owner with
 * `TasksHelper.getUserInProject`, a project-*members*-only lookup that is `undefined` for every
 * assistant, and then reassigned `note.userId = loggedUser.uid` BEFORE calling `setNoteProject`.
 * The backend therefore only ever saw the already-overwritten id and its guard could never fire.
 * The task branch 17 lines above was always correct — it uses the cross-project-aware
 * `TasksHelper.getTaskOwner` — so this was an inconsistency between two adjacent branches.
 *
 * A behavioural test would have to mount the whole modal (Backend/firestore/dotenv imports), so
 * this guards the contract at the source level, following `__tests__/WebShellScrollContainers.test.js`.
 */

const MODAL_PATH = 'components/UIComponents/FloatModals/SelectProjectModal/SelectProjectModal.js'

const readNoteBranch = () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../..', MODAL_PATH), 'utf8')
    // The `} else if (type === 'note') {` block, up to the next `} else if (`.
    const match = source.match(/else if \(type === 'note'\) \{([\s\S]*?)\n {12}\} else if \(/)
    return { source, branch: match ? match[1] : null }
}

describe('AT-2194: the note branch of the project picker preserves an assistant owner', () => {
    it('resolves the owner with the notes resolver, not a project-members-only lookup', () => {
        const { branch } = readNoteBranch()

        expect(branch).not.toBeNull()
        expect(branch).toMatch(/findNoteOwnerInProject\(/)
        // The member-only lookup is what made every assistant owner unresolvable here.
        expect(branch).not.toMatch(/getUserInProject\(/)
    })

    it('never pre-assigns the note owner, which would bypass the backend guard', () => {
        const { branch } = readNoteBranch()

        // The exact mutation that defeated `resolveMovedNoteOwnerId`.
        expect(branch).not.toMatch(/note\.userId\s*=/)
    })

    it('decides via resolveMovedNoteOwnerId, the same authority the backend uses', () => {
        const { branch } = readNoteBranch()

        expect(branch).toMatch(/resolveMovedNoteOwnerId\(/)
        // The old member-list containment check is not a valid test for an assistant owner.
        expect(branch).not.toMatch(/newProject\.userIds\.includes\(/)
    })

    it('imports both resolvers from the shared notes owner helper', () => {
        const { source } = readNoteBranch()

        expect(source).toMatch(
            /import \{[\s\S]*?findNoteOwnerInProject[\s\S]*?resolveMovedNoteOwnerId[\s\S]*?\} from '.*NoteFilters\/noteOwnerFilterHelper'/
        )
    })

    it('leaves the task branch on its own cross-project-aware resolver', () => {
        const { source } = readNoteBranch()

        // Regression fence: the task branch was already correct and must stay that way.
        expect(source).toMatch(/TasksHelper\.getTaskOwner\(task\.userId, project\.id\)/)
    })
})
