/**
 * @jest-environment jsdom
 */

jest.mock('../../../redux/store', () => ({ getState: jest.fn() }))

// WorkstreamHelper transitively pulls in utils/backends/firestore.js, which needs build-time
// dotenv variables that are not present in a unit-test run. Only the id prefix is used here.
jest.mock('../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'ws@' }))

import {
    collectNoteOwnerCounts,
    filterNotesByOwner,
    filterStickyNotesByOwner,
    findNoteOwnerInProject,
    flattenNotesByDate,
    getNoteOwnerId,
    NOTE_OWNER_UNASSIGNED,
    resolveMovedNoteOwnerId,
    resolveNoteOwner,
} from './noteOwnerFilterHelper'
import store from '../../../redux/store'

const PROJECT_ID = 'project-1'
const HUMAN_ID = 'lejVqrT6FBcMRRCxnBbBhQwPgSg1'
const ASSISTANT_ID = '-OjSHe9onWtI115trr9M'

const note = (id, userId) => ({ id, userId, title: `note ${id}` })

const setStoreState = (overrides = {}) => {
    store.getState.mockReturnValue({
        projectUsers: {},
        projectAssistants: {},
        globalAssistants: [],
        projectContacts: {},
        projectWorkstreams: {},
        ...overrides,
    })
}

beforeEach(() => {
    jest.clearAllMocks()
    setStoreState()
})

describe('getNoteOwnerId', () => {
    it('returns the note owner', () => {
        expect(getNoteOwnerId(note('a', HUMAN_ID))).toBe(HUMAN_ID)
    })

    it('returns an assistant owner unchanged', () => {
        expect(getNoteOwnerId(note('a', ASSISTANT_ID))).toBe(ASSISTANT_ID)
    })

    it('falls back to the unassigned sentinel for legacy notes without an owner', () => {
        expect(getNoteOwnerId({ id: 'a' })).toBe(NOTE_OWNER_UNASSIGNED)
        expect(getNoteOwnerId({ id: 'a', userId: '' })).toBe(NOTE_OWNER_UNASSIGNED)
        expect(getNoteOwnerId(null)).toBe(NOTE_OWNER_UNASSIGNED)
    })
})

describe('flattenNotesByDate', () => {
    it('flattens the date bucket map', () => {
        const notes = { 20260807: [note('a', HUMAN_ID), note('b', HUMAN_ID)], 20260806: [note('c', ASSISTANT_ID)] }
        // Order is deliberately not asserted: the date-bucket keys are integer-like, so the
        // engine iterates them numerically, and every consumer here is order-independent
        // (the list sorts its own date sections at render time).
        expect(
            flattenNotesByDate(notes)
                .map(n => n.id)
                .sort()
        ).toEqual(['a', 'b', 'c'])
    })

    it('tolerates missing input', () => {
        expect(flattenNotesByDate(undefined)).toEqual([])
        expect(flattenNotesByDate(null)).toEqual([])
    })
})

describe('collectNoteOwnerCounts', () => {
    it('counts notes per owner across date buckets and sticky notes', () => {
        const notes = {
            20260807: [note('a', HUMAN_ID), note('b', ASSISTANT_ID)],
            20260806: [note('c', HUMAN_ID)],
        }
        const { counts, total, ownerIds } = collectNoteOwnerCounts(notes, [note('d', ASSISTANT_ID)])

        expect(counts).toEqual({ [HUMAN_ID]: 2, [ASSISTANT_ID]: 2 })
        expect(total).toBe(4)
        expect(ownerIds).toHaveLength(2)
    })

    it('counts a note that is both sticky and in a date bucket only once', () => {
        const sticky = note('a', HUMAN_ID)
        const { counts, total } = collectNoteOwnerCounts({ 20260807: [sticky] }, [sticky])

        expect(counts).toEqual({ [HUMAN_ID]: 1 })
        expect(total).toBe(1)
    })

    it('buckets legacy ownerless notes under the unassigned sentinel', () => {
        const { counts } = collectNoteOwnerCounts({ 20260807: [{ id: 'a' }, note('b', HUMAN_ID)] }, [])
        expect(counts[NOTE_OWNER_UNASSIGNED]).toBe(1)
        expect(counts[HUMAN_ID]).toBe(1)
    })

    it('orders owners by descending count, then by id for stability', () => {
        const notes = {
            20260807: [note('a', 'bbb'), note('b', 'aaa'), note('c', 'aaa'), note('d', 'ccc')],
        }
        expect(collectNoteOwnerCounts(notes, []).ownerIds).toEqual(['aaa', 'bbb', 'ccc'])
    })

    it('handles an empty list', () => {
        expect(collectNoteOwnerCounts({}, [])).toEqual({ counts: {}, total: 0, ownerIds: [] })
    })
})

describe('filterNotesByOwner', () => {
    const notes = {
        20260807: [note('a', HUMAN_ID), note('b', ASSISTANT_ID)],
        20260806: [note('c', ASSISTANT_ID)],
        20260805: [note('d', HUMAN_ID)],
    }

    it('returns the original reference when no filter is active', () => {
        expect(filterNotesByOwner(notes, [])).toBe(notes)
        expect(filterNotesByOwner(notes, undefined)).toBe(notes)
    })

    it('keeps only notes owned by the selected owner', () => {
        const filtered = filterNotesByOwner(notes, [ASSISTANT_ID])
        expect(Object.keys(filtered).sort()).toEqual(['20260806', '20260807'])
        expect(filtered['20260807'].map(n => n.id)).toEqual(['b'])
        expect(filtered['20260806'].map(n => n.id)).toEqual(['c'])
    })

    it('drops date buckets that end up empty so no empty date header renders', () => {
        expect(filterNotesByOwner(notes, [HUMAN_ID])['20260806']).toBeUndefined()
    })

    it('supports selecting several owners at once', () => {
        const filtered = filterNotesByOwner(notes, [HUMAN_ID, ASSISTANT_ID])
        expect(Object.keys(filtered)).toHaveLength(3)
    })

    it('matches legacy ownerless notes through the unassigned sentinel', () => {
        const legacy = { 20260807: [{ id: 'a' }, note('b', HUMAN_ID)] }
        const filtered = filterNotesByOwner(legacy, [NOTE_OWNER_UNASSIGNED])
        expect(filtered['20260807'].map(n => n.id)).toEqual(['a'])
    })

    it('returns an empty map when nothing matches', () => {
        expect(filterNotesByOwner(notes, ['nobody'])).toEqual({})
    })
})

describe('filterStickyNotesByOwner', () => {
    const sticky = [note('a', HUMAN_ID), note('b', ASSISTANT_ID)]

    it('returns the original reference when no filter is active', () => {
        expect(filterStickyNotesByOwner(sticky, [])).toBe(sticky)
    })

    it('filters by owner', () => {
        expect(filterStickyNotesByOwner(sticky, [ASSISTANT_ID]).map(n => n.id)).toEqual(['b'])
    })
})

describe('findNoteOwnerInProject / resolveNoteOwner', () => {
    it('resolves a human project member', () => {
        setStoreState({
            projectUsers: { [PROJECT_ID]: [{ uid: HUMAN_ID, displayName: 'Karsten', photoURL: 'k.png' }] },
        })

        const owner = resolveNoteOwner(PROJECT_ID, HUMAN_ID)
        expect(owner.displayName).toBe('Karsten')
        expect(owner.isAssistant).toBe(false)
    })

    it('resolves a project assistant and flags it as an assistant', () => {
        setStoreState({
            projectAssistants: { [PROJECT_ID]: [{ uid: ASSISTANT_ID, displayName: 'Alldone CTO', photoURL: 'a.png' }] },
        })

        const owner = resolveNoteOwner(PROJECT_ID, ASSISTANT_ID)
        expect(owner.displayName).toBe('Alldone CTO')
        expect(owner.isAssistant).toBe(true)
    })

    it('resolves a global assistant even when the project has not opted in', () => {
        setStoreState({ globalAssistants: [{ uid: ASSISTANT_ID, displayName: 'Anna' }] })

        expect(resolveNoteOwner(PROJECT_ID, ASSISTANT_ID).isAssistant).toBe(true)
    })

    it('prefers a project member over a same-id assistant', () => {
        setStoreState({
            projectUsers: { [PROJECT_ID]: [{ uid: HUMAN_ID, displayName: 'Human' }] },
            projectAssistants: { [PROJECT_ID]: [{ uid: HUMAN_ID, displayName: 'Assistant' }] },
        })

        expect(resolveNoteOwner(PROJECT_ID, HUMAN_ID).displayName).toBe('Human')
    })

    it('resolves contacts and workstreams', () => {
        setStoreState({
            projectContacts: { [PROJECT_ID]: [{ uid: 'contact-1', displayName: 'Contact' }] },
            projectWorkstreams: { [PROJECT_ID]: [{ uid: 'ws@1', displayName: 'Stream' }] },
        })

        expect(resolveNoteOwner(PROJECT_ID, 'contact-1').displayName).toBe('Contact')
        expect(resolveNoteOwner(PROJECT_ID, 'ws@1').isWorkstream).toBe(true)
    })

    it('findNoteOwnerInProject returns null for an unknown owner', () => {
        expect(findNoteOwnerInProject(PROJECT_ID, 'ghost')).toBeNull()
        expect(findNoteOwnerInProject(PROJECT_ID, NOTE_OWNER_UNASSIGNED)).toBeNull()
        expect(findNoteOwnerInProject(PROJECT_ID, undefined)).toBeNull()
    })

    it('resolveNoteOwner never returns null, keeping the id for unknown owners', () => {
        const owner = resolveNoteOwner(PROJECT_ID, 'ghost')
        expect(owner.uid).toBe('ghost')
        expect(owner.photoURL).toBe('')
    })

    it('resolveNoteOwner describes the unassigned sentinel', () => {
        expect(resolveNoteOwner(PROJECT_ID, NOTE_OWNER_UNASSIGNED).uid).toBe(NOTE_OWNER_UNASSIGNED)
        expect(resolveNoteOwner(PROJECT_ID, undefined).displayName).toBe('No owner')
    })
})

// AT-2194 production follow-up: moving a note between projects used to check the target
// project's *users* only, so an assistant-owned note silently went back to the human on
// every move — including the move a user makes right after the menubar files a meeting note
// into the wrong project.
describe('resolveMovedNoteOwnerId', () => {
    const TARGET_ID = 'project-2'

    it('keeps an assistant owner that exists in the target project', () => {
        setStoreState({ projectAssistants: { [TARGET_ID]: [{ uid: ASSISTANT_ID, displayName: 'Anna' }] } })

        expect(resolveMovedNoteOwnerId(TARGET_ID, ASSISTANT_ID, HUMAN_ID)).toBe(ASSISTANT_ID)
    })

    it('keeps a global assistant owner, which resolves in every project', () => {
        setStoreState({ globalAssistants: [{ uid: ASSISTANT_ID, displayName: 'Anna' }] })

        expect(resolveMovedNoteOwnerId(TARGET_ID, ASSISTANT_ID, HUMAN_ID)).toBe(ASSISTANT_ID)
    })

    it('hands the note back to the acting user when the owner does not resolve over there', () => {
        // The assistant belongs to the *source* project only.
        setStoreState({ projectAssistants: { [PROJECT_ID]: [{ uid: ASSISTANT_ID, displayName: 'Anna' }] } })

        expect(resolveMovedNoteOwnerId(TARGET_ID, ASSISTANT_ID, HUMAN_ID)).toBe(HUMAN_ID)
    })

    it('keeps a human owner who is a member of the target project', () => {
        setStoreState({ projectUsers: { [TARGET_ID]: [{ uid: HUMAN_ID, displayName: 'Human' }] } })

        expect(resolveMovedNoteOwnerId(TARGET_ID, HUMAN_ID, 'someone-else')).toBe(HUMAN_ID)
    })

    it('falls back to the acting user for notes without an owner', () => {
        setStoreState()

        expect(resolveMovedNoteOwnerId(TARGET_ID, undefined, HUMAN_ID)).toBe(HUMAN_ID)
        expect(resolveMovedNoteOwnerId(TARGET_ID, NOTE_OWNER_UNASSIGNED, HUMAN_ID)).toBe(HUMAN_ID)
    })
})
