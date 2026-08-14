import { holdWhileEditing, pinSectionToTop, resolvePinnedSectionId } from './focusSectionPin'
import { sortTasksByPriority } from '../../../utils/TaskPriority'

const sections = (...ids) => ids.map(id => [id, [{ id: `${id}-task` }]])
const idsOf = list => list.map(section => section[0])

/** One MainSection render pass: resolve the pin, then apply it to a freshly built section list. */
const renderPass = (sectionIds, { focusedSectionId, isUserEditing, pinnedRef }) =>
    idsOf(pinSectionToTop(sections(...sectionIds), resolvePinnedSectionId(focusedSectionId, isUserEditing, pinnedRef)))

describe('focusSectionPin - resolvePinnedSectionId', () => {
    it('tracks the live focused section while the user is idle', () => {
        const pinnedRef = { current: undefined }

        expect(resolvePinnedSectionId('goalA', false, pinnedRef)).toBe('goalA')
        expect(resolvePinnedSectionId('goalB', false, pinnedRef)).toBe('goalB')
        expect(pinnedRef.current).toBe('goalB')
    })

    it('normalises "no focused section" to null while idle', () => {
        const pinnedRef = { current: 'goalA' }

        expect(resolvePinnedSectionId(null, false, pinnedRef)).toBeNull()
        expect(pinnedRef.current).toBeNull()
    })

    it('AT-2249: holds the last idle pin while the user is editing', () => {
        const pinnedRef = { current: undefined }

        resolvePinnedSectionId('goalA', false, pinnedRef)

        // The focus task itself is being edited - the pin must survive untouched.
        expect(resolvePinnedSectionId('goalA', true, pinnedRef)).toBe('goalA')
    })

    it('AT-2203: defers a background focus change until the user is done', () => {
        const pinnedRef = { current: undefined }

        resolvePinnedSectionId('goalA', false, pinnedRef)

        expect(resolvePinnedSectionId('goalB', true, pinnedRef)).toBe('goalA')
        expect(resolvePinnedSectionId('goalB', true, pinnedRef)).toBe('goalA')
        // ... and re-applies as soon as editing ends.
        expect(resolvePinnedSectionId('goalB', false, pinnedRef)).toBe('goalB')
    })

    it('AT-2203: defers a focus task that is cleared in the background', () => {
        const pinnedRef = { current: undefined }

        resolvePinnedSectionId('goalA', false, pinnedRef)

        expect(resolvePinnedSectionId(null, true, pinnedRef)).toBe('goalA')
        expect(resolvePinnedSectionId(null, false, pinnedRef)).toBeNull()
    })

    it('adopts the live value on a first render that happens mid-edit', () => {
        const pinnedRef = { current: undefined }

        expect(resolvePinnedSectionId('goalA', true, pinnedRef)).toBe('goalA')
        expect(pinnedRef.current).toBe('goalA')
    })

    it('falls back to the live value when no ref is available', () => {
        expect(resolvePinnedSectionId('goalA', true, null)).toBe('goalA')
        expect(resolvePinnedSectionId(undefined, false, null)).toBeNull()
    })
})

describe('focusSectionPin - pinSectionToTop', () => {
    it('moves the pinned section to the front', () => {
        expect(idsOf(pinSectionToTop(sections('goalA', 'goalB', 'goalC'), 'goalC'))).toEqual([
            'goalC',
            'goalA',
            'goalB',
        ])
    })

    it('keeps the order of the remaining sections', () => {
        expect(idsOf(pinSectionToTop(sections('goalA', 'goalB', 'goalC', '0'), '0'))).toEqual([
            '0',
            'goalA',
            'goalB',
            'goalC',
        ])
    })

    it('is a no-op when the section is already first, unknown or absent', () => {
        expect(idsOf(pinSectionToTop(sections('goalA', 'goalB'), 'goalA'))).toEqual(['goalA', 'goalB'])
        expect(idsOf(pinSectionToTop(sections('goalA', 'goalB'), 'goalZ'))).toEqual(['goalA', 'goalB'])
        expect(idsOf(pinSectionToTop(sections('goalA', 'goalB'), null))).toEqual(['goalA', 'goalB'])
    })

    it('survives a non-array input', () => {
        expect(pinSectionToTop(undefined, 'goalA')).toBeUndefined()
    })
})

describe('focusSectionPin - render sequence', () => {
    it('AT-2249: the focus section does not move when its editor opens and closes', () => {
        const pinnedRef = { current: undefined }
        const list = ['goalA', 'goalB', 'goalFocus']
        const pass = isUserEditing => renderPass(list, { focusedSectionId: 'goalFocus', isUserEditing, pinnedRef })

        const idle = pass(false)
        expect(idle).toEqual(['goalFocus', 'goalA', 'goalB'])

        // Click into the focus task's input -> EditTask mounts -> activeEditMode.
        expect(pass(true)).toEqual(idle)
        // A float popup (due date, estimation, ...) opening on top changes nothing either.
        expect(pass(true)).toEqual(idle)
        // Editor dismissed.
        expect(pass(false)).toEqual(idle)
    })

    it('AT-2203: a background focus change does not reorder sections mid-edit', () => {
        const pinnedRef = { current: undefined }
        const list = ['goalA', 'goalB', 'goalFocus']

        expect(renderPass(list, { focusedSectionId: 'goalFocus', isUserEditing: false, pinnedRef })).toEqual([
            'goalFocus',
            'goalA',
            'goalB',
        ])
        expect(renderPass(list, { focusedSectionId: 'goalB', isUserEditing: true, pinnedRef })).toEqual([
            'goalFocus',
            'goalA',
            'goalB',
        ])
        expect(renderPass(list, { focusedSectionId: 'goalB', isUserEditing: false, pinnedRef })).toEqual([
            'goalB',
            'goalA',
            'goalFocus',
        ])
    })

    /**
     * The TasksList half of the same guard: the focus task is boosted to index 0 *within* its
     * section, and that boost must be just as stable while an editor is open.
     */
    it('AT-2249: the focus task keeps its place inside its section across an edit session', () => {
        const heldRef = { current: undefined }
        const taskList = [{ id: 'a' }, { id: 'b' }, { id: 'focus' }]
        const pass = isUserEditing =>
            sortTasksByPriority(taskList, holdWhileEditing('focus', isUserEditing, heldRef)).map(task => task.id)

        expect(pass(false)).toEqual(['focus', 'a', 'b'])
        expect(pass(true)).toEqual(['focus', 'a', 'b'])
        expect(pass(false)).toEqual(['focus', 'a', 'b'])
    })

    it('AT-2203: a background focus change does not reorder tasks inside a section mid-edit', () => {
        const heldRef = { current: undefined }
        const taskList = [{ id: 'a' }, { id: 'b' }, { id: 'focus' }]
        const pass = (liveFocusTaskId, isUserEditing) =>
            sortTasksByPriority(taskList, holdWhileEditing(liveFocusTaskId, isUserEditing, heldRef)).map(
                task => task.id
            )

        expect(pass('focus', false)).toEqual(['focus', 'a', 'b'])
        expect(pass('b', true)).toEqual(['focus', 'a', 'b'])
        expect(pass('b', false)).toEqual(['b', 'a', 'focus'])
    })

    it('does not pin an unrelated section when a task is edited with no focus task set', () => {
        const pinnedRef = { current: undefined }
        const list = ['goalA', 'goalB']

        expect(renderPass(list, { focusedSectionId: null, isUserEditing: false, pinnedRef })).toEqual([
            'goalA',
            'goalB',
        ])
        expect(renderPass(list, { focusedSectionId: null, isUserEditing: true, pinnedRef })).toEqual(['goalA', 'goalB'])
    })
})
