import { setAssistantLineAssistant } from '../../redux/actions'
import { initialState, theReducer } from '../../redux/store'

/**
 * AT-2430 — the session-only record of which assistant the assistant line is talking to in a
 * given project.
 */
describe('assistantLineSelection reducer', () => {
    it('starts empty', () => {
        expect(initialState.assistantLineSelection).toEqual({})
    })

    it('records one project’s choice without touching the others', () => {
        const withOne = theReducer(initialState, setAssistantLineAssistant('project-a', 'assistant-1'))
        const withTwo = theReducer(withOne, setAssistantLineAssistant('project-b', 'assistant-2'))

        expect(withTwo.assistantLineSelection).toEqual({
            'project-a': 'assistant-1',
            'project-b': 'assistant-2',
        })
    })

    it('replaces the choice for a project it already has', () => {
        const first = theReducer(initialState, setAssistantLineAssistant('project-a', 'assistant-1'))
        const second = theReducer(first, setAssistantLineAssistant('project-a', 'assistant-2'))

        expect(second.assistantLineSelection).toEqual({ 'project-a': 'assistant-2' })
    })

    it('drops the choice when no assistant is given', () => {
        const chosen = theReducer(initialState, setAssistantLineAssistant('project-a', 'assistant-1'))
        const cleared = theReducer(chosen, setAssistantLineAssistant('project-a', null))

        expect(cleared.assistantLineSelection).toEqual({})
    })

    // The assistant line is mounted on every task board, so a new map identity for a no-op would
    // re-render all of them.
    it('returns the identical state for a no-op', () => {
        const chosen = theReducer(initialState, setAssistantLineAssistant('project-a', 'assistant-1'))

        expect(theReducer(chosen, setAssistantLineAssistant('project-a', 'assistant-1'))).toBe(chosen)
        expect(theReducer(chosen, setAssistantLineAssistant('project-b', null))).toBe(chosen)
        expect(theReducer(chosen, setAssistantLineAssistant('', 'assistant-1'))).toBe(chosen)
    })

    it('leaves the rest of the store alone', () => {
        const next = theReducer(initialState, setAssistantLineAssistant('project-a', 'assistant-1'))

        expect(next.projectAssistants).toBe(initialState.projectAssistants)
        expect(next.defaultAssistant).toBe(initialState.defaultAssistant)
        expect(next.selectedProjectIndex).toBe(initialState.selectedProjectIndex)
    })
})
