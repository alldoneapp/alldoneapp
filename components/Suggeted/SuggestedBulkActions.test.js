import React from 'react'
import renderer, { act } from 'react-test-renderer'

import SuggestedBulkActions from './SuggestedBulkActions'
import { acceptAllSuggestedTasks } from '../../utils/suggestedTaskBulkActions'
import { showConfirmPopup } from '../../redux/actions'

let mockState
const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
}))
jest.mock('../../utils/suggestedTaskBulkActions', () => ({
    acceptAllSuggestedTasks: jest.fn(() => 2),
}))
jest.mock('../../redux/actions', () => ({
    showConfirmPopup: jest.fn(payload => ({ type: 'SHOW_CONFIRM_POPUP', payload })),
}))
jest.mock('../UIComponents/ConfirmPopup', () => ({
    CONFIRM_POPUP_TRIGGER_REJECT_ALL_SUGGESTED_TASKS: 'REJECT_ALL_SUGGESTED',
}))
jest.mock('../../i18n/TranslationService', () => ({
    translate: key => key,
}))
jest.mock('../UIControls/Button', () => 'Button')

const assistantTask = id => ({
    id,
    suggestedBy: 'assistant-1',
    assistantId: 'assistant-1',
    taskMetadata: { assistantSuggestion: { assistantId: 'assistant-1' } },
})
const humanTask = id => ({ id, suggestedBy: 'user-2', creatorId: 'user-2' })

const render = (tasks, projectId = 'project-1') => {
    let tree
    act(() => {
        tree = renderer.create(<SuggestedBulkActions projectId={projectId} tasks={tasks} />)
    })
    return tree
}

const buttonWithTitle = (tree, title) => tree.root.findAll(node => node.type === 'Button' && node.props.title === title)

describe('SuggestedBulkActions visibility', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { smallScreenNavigation: false, currentUser: { workflow: {} } }
    })

    test('stays hidden only when the section has nothing to act on', () => {
        expect(render([]).toJSON()).toBeNull()
        expect(render(undefined).toJSON()).toBeNull()
        expect(render([null, {}]).toJSON()).toBeNull()
    })

    test('appears for a single suggestion, with the unchanged "all" labels', () => {
        const tree = render([assistantTask('task-1')])

        expect(tree.toJSON()).not.toBeNull()
        expect(buttonWithTitle(tree, 'Accept all')).toHaveLength(1)
        expect(buttonWithTitle(tree, 'Reject all')).toHaveLength(1)
    })

    test('appears from two suggestions upwards', () => {
        const tree = render([assistantTask('task-1'), assistantTask('task-2')])

        expect(tree.toJSON()).not.toBeNull()
        expect(buttonWithTitle(tree, 'Accept all')).toHaveLength(1)
        expect(buttonWithTitle(tree, 'Reject all')).toHaveLength(1)
    })

    test('ignores malformed entries but still shows for the one real suggestion', () => {
        const tree = render([null, {}, assistantTask('task-1')])

        expect(tree.toJSON()).not.toBeNull()
        expect(buttonWithTitle(tree, 'Accept all')).toHaveLength(1)
    })

    test('keeps the actions reachable on small screens for a single suggestion', () => {
        mockState.smallScreenNavigation = true

        const tree = render([assistantTask('task-1')])
        const buttons = tree.root.findAllByType('Button')

        expect(buttons).toHaveLength(2)
        buttons.forEach(button => {
            expect(button.props.title).toBeNull()
            expect(button.props.icon).toBeTruthy()
            expect(button.props.accessibilityLabel).toBeTruthy()
        })
    })

    test('drops the labels on small screens but keeps the actions reachable', () => {
        mockState.smallScreenNavigation = true

        const tree = render([assistantTask('task-1'), assistantTask('task-2')])
        const buttons = tree.root.findAllByType('Button')

        expect(buttons).toHaveLength(2)
        buttons.forEach(button => {
            expect(button.props.title).toBeNull()
            expect(button.props.icon).toBeTruthy()
            expect(button.props.accessibilityLabel).toBeTruthy()
        })
    })
})

describe('SuggestedBulkActions wording', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { smallScreenNavigation: false, currentUser: { workflow: {} } }
    })

    test('says "Reject all" for an assistant section', () => {
        const tree = render([assistantTask('task-1'), assistantTask('task-2')])

        expect(buttonWithTitle(tree, 'Reject all')).toHaveLength(1)
        expect(buttonWithTitle(tree, 'Next step for all')).toHaveLength(0)
    })

    test('mirrors the single-task wording for a human section', () => {
        const tree = render([humanTask('task-1'), humanTask('task-2')])

        expect(buttonWithTitle(tree, 'Next step for all')).toHaveLength(1)
        expect(buttonWithTitle(tree, 'Reject all')).toHaveLength(0)
    })

    // AT-2210: the icon has to say the same thing as the label. On mobile the button is icon-only,
    // so the workflow glyph was the only thing shown for an action that rejects.
    test('shows a reject icon, not the workflow icon, for an assistant section', () => {
        const tree = render([assistantTask('task-1'), assistantTask('task-2')])

        expect(buttonWithTitle(tree, 'Reject all')[0].props.icon).toBe('x')
    })

    test('keeps the workflow icon where the action really is a workflow move', () => {
        const tree = render([humanTask('task-1'), humanTask('task-2')])

        expect(buttonWithTitle(tree, 'Next step for all')[0].props.icon).toBe('next-workflow')
    })

    test('keeps the reject icon on the icon-only mobile button', () => {
        mockState.smallScreenNavigation = true

        const tree = render([assistantTask('task-1')])
        const rejectButton = tree.root.findAll(
            node => node.type === 'Button' && node.props.accessibilityLabel === 'Reject all'
        )

        expect(rejectButton).toHaveLength(1)
        expect(rejectButton[0].props.title).toBeNull()
        expect(rejectButton[0].props.icon).toBe('x')
    })

    test('keeps the "all" wording for a section of one, per suggester kind', () => {
        const assistantSection = render([assistantTask('task-1')])
        expect(buttonWithTitle(assistantSection, 'Reject all')).toHaveLength(1)
        expect(buttonWithTitle(assistantSection, 'Accept all')).toHaveLength(1)

        const humanSection = render([humanTask('task-1')])
        expect(buttonWithTitle(humanSection, 'Next step for all')).toHaveLength(1)
        expect(buttonWithTitle(humanSection, 'Accept all')).toHaveLength(1)
    })
})

describe('SuggestedBulkActions behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { smallScreenNavigation: false, currentUser: { workflow: {} } }
    })

    test('accepts the whole section straight away, without a confirmation', () => {
        const tasks = [assistantTask('task-1'), assistantTask('task-2')]
        const tree = render(tasks)

        act(() => {
            buttonWithTitle(tree, 'Accept all')[0].props.onPress()
        })

        expect(acceptAllSuggestedTasks).toHaveBeenCalledWith({ projectId: 'project-1', tasks })
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    test('accepts a section of one through the same bulk path', () => {
        const tasks = [assistantTask('task-1')]
        const tree = render(tasks)

        act(() => {
            buttonWithTitle(tree, 'Accept all')[0].props.onPress()
        })

        expect(acceptAllSuggestedTasks).toHaveBeenCalledWith({ projectId: 'project-1', tasks })
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    test('still asks for confirmation when a section holds a single suggestion', () => {
        const tasks = [assistantTask('task-1')]
        mockState.currentUser.workflow = { 'project-1': { 'step-a': { reviewerUid: 'user-1' } } }
        const tree = render(tasks)

        act(() => {
            buttonWithTitle(tree, 'Reject all')[0].props.onPress()
        })

        expect(showConfirmPopup).toHaveBeenCalledTimes(1)
        expect(showConfirmPopup).toHaveBeenCalledWith({
            trigger: 'REJECT_ALL_SUGGESTED',
            object: expect.objectContaining({
                projectId: 'project-1',
                tasks,
                headerText: 'Reject all suggested tasks',
                // The button label stays "Reject all", but the question is a sentence and has to
                // be singular for a section of one.
                headerQuestion: 'Reject single suggested task question',
                headerQuestionParams: { count: 1 },
            }),
        })
    })

    test('asks for confirmation before rejecting the whole section', () => {
        const tasks = [assistantTask('task-1'), assistantTask('task-2'), assistantTask('task-3')]
        mockState.currentUser.workflow = { 'project-1': { 'step-a': { reviewerUid: 'user-1' } } }
        const tree = render(tasks)

        act(() => {
            buttonWithTitle(tree, 'Reject all')[0].props.onPress()
        })

        expect(showConfirmPopup).toHaveBeenCalledTimes(1)
        expect(showConfirmPopup).toHaveBeenCalledWith({
            trigger: 'REJECT_ALL_SUGGESTED',
            object: expect.objectContaining({
                projectId: 'project-1',
                tasks,
                workflow: { 'step-a': { reviewerUid: 'user-1' } },
                headerText: 'Reject all suggested tasks',
                headerQuestion: 'Reject all suggested tasks question',
                headerQuestionParams: { count: 3 },
            }),
        })
        expect(mockDispatch).toHaveBeenCalledTimes(1)
    })

    test('passes the reviewer workflow of this project only', () => {
        mockState.currentUser.workflow = {
            'project-1': { 'step-a': { reviewerUid: 'user-1' } },
            'project-2': { 'step-z': { reviewerUid: 'user-9' } },
        }
        const tree = render([assistantTask('task-1'), assistantTask('task-2')], 'project-2')

        act(() => {
            buttonWithTitle(tree, 'Reject all')[0].props.onPress()
        })

        expect(showConfirmPopup.mock.calls[0][0].object.workflow).toEqual({ 'step-z': { reviewerUid: 'user-9' } })
    })

    test('survives a user without any workflow', () => {
        mockState.currentUser = {}
        const tree = render([assistantTask('task-1'), assistantTask('task-2')])

        act(() => {
            buttonWithTitle(tree, 'Reject all')[0].props.onPress()
        })

        expect(showConfirmPopup.mock.calls[0][0].object.workflow).toBeUndefined()
    })
})

describe('SuggestedBulkActions confirmation strings', () => {
    // The component picks one of two keys by count, so a missing singular entry would only show up
    // as a raw key in the dialog at runtime — cheap to pin here instead.
    const locales = {
        en: require('../../i18n/translations/en.json'),
        de: require('../../i18n/translations/de.json'),
        es: require('../../i18n/translations/es.json'),
    }

    Object.entries(locales).forEach(([language, translations]) => {
        test(`${language} carries both the singular and the plural rejection question`, () => {
            expect(typeof translations['Reject all suggested tasks question']).toBe('string')
            expect(typeof translations['Reject single suggested task question']).toBe('string')

            // The singular sentence names no count, so it must not carry the interpolation.
            expect(translations['Reject single suggested task question']).not.toContain('{{count}}')
            expect(translations['Reject all suggested tasks question']).toContain('{{count}}')
        })
    })
})
