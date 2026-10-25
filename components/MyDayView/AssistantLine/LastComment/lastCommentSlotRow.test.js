import {
    LAST_COMMENT_ROW_PENDING,
    LAST_COMMENT_ROW_PREVIEW,
    getLastCommentSlotRow,
    recordLastCommentSlotRow,
    resetLastCommentSlotRows,
} from './lastCommentSlotRow'

const SCOPE = 'user-1:project-1:'
const OTHER_SCOPE = 'user-1:project-2:'

const row = (overrides = {}) => ({
    projectId: 'project-1',
    commentText: 'already on screen',
    objectName: 'Anna <> Karsten',
    ...overrides,
})

describe('lastCommentSlotRow (AT-2523)', () => {
    beforeEach(() => resetLastCommentSlotRows())

    it('remembers what a slot displayed, across the mount that showed it', () => {
        recordLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PREVIEW, row())

        // The whole point: the card that reads this is a different mount from the one that wrote
        // it, so nothing component-local could have survived in between.
        expect(getLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PENDING)).toEqual({
            kind: LAST_COMMENT_ROW_PREVIEW,
            projectId: 'project-1',
            commentText: 'already on screen',
            objectName: 'Anna <> Karsten',
        })
    })

    it('keeps slots apart, so one project cannot roll another project’s comment away', () => {
        recordLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PREVIEW, row())
        expect(getLastCommentSlotRow(OTHER_SCOPE, LAST_COMMENT_ROW_PENDING)).toBeNull()
    })

    describe('the kind gate', () => {
        it('answers nothing to a card of the same kind', () => {
            recordLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PREVIEW, row())

            // AT-2511 decided that a preview replacing a preview across a chat remount rolls in
            // ALONE. AT-2523 does not revisit that; it only crosses the pending↔preview boundary.
            expect(getLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PREVIEW)).toBeNull()
        })

        it('answers in both directions across the pending boundary', () => {
            // "You pressed Enter": the pending card replaces the comment that was there.
            recordLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PREVIEW, row())
            expect(getLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PENDING)?.commentText).toBe('already on screen')

            // "The answer arrived": the real preview replaces the pending card, so the gesture the
            // send started is completed by the same roll rather than by a silent swap.
            recordLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PENDING, row({ commentText: 'ship the thing' }))
            expect(getLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PREVIEW)?.commentText).toBe('ship the thing')
        })
    })

    it('ignores a row with no text, so a card mid-load cannot erase the real one', () => {
        recordLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PREVIEW, row())
        recordLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PENDING, row({ commentText: '' }))

        // The preview renders a skeleton before its text resolves. Recording that empty render
        // would leave the next card with nothing to roll away.
        expect(getLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PENDING)?.commentText).toBe('already on screen')
    })

    it('records nothing without a scope or a kind, rather than under a shared key', () => {
        recordLastCommentSlotRow(null, LAST_COMMENT_ROW_PREVIEW, row())
        recordLastCommentSlotRow(SCOPE, null, row())

        expect(getLastCommentSlotRow(SCOPE, LAST_COMMENT_ROW_PENDING)).toBeNull()
        expect(getLastCommentSlotRow(null, LAST_COMMENT_ROW_PENDING)).toBeNull()
    })
})
