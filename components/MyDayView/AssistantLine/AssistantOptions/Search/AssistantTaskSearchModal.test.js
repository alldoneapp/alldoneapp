/**
 * @jest-environment jsdom
 */

// AT-3082: a template started from the Anna chat creates its task in the background and tells the
// server which chat to announce it in. Started anywhere else, it runs exactly as before.

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import AssistantTaskSearchModal from './AssistantTaskSearchModal'

const mockDispatch = jest.fn()
const mockGenerateTaskFromPreConfig = jest.fn(() => Promise.resolve({}))
let mockTasks = []

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector({ loggedUser: { gold: 100 }, smallScreenNavigation: false }),
}))
jest.mock('../../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    getPreConfigTasksForAllProjects: () => Promise.resolve(mockTasks),
}))
jest.mock('../../../../../utils/assistantHelper', () => ({
    generateTaskFromPreConfig: (...args) => mockGenerateTaskFromPreConfig(...args),
}))
jest.mock('../../../../../redux/actions', () => ({
    setIframeModalData: jest.fn(() => ({ type: 'iframe' })),
    setPreConfigTaskExecuting: jest.fn(name => ({ type: 'executing', name })),
}))
jest.mock('../../../../../utils/useWindowSize', () => () => [1200, 800])
jest.mock('../../../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}) }))
jest.mock(
    '../../../../UIControls/CustomScrollView',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../../UIControls/Button', () => 'Button')
jest.mock('../../../../UIComponents/FloatModals/ModalHeader', () => 'ModalHeader')
jest.mock(
    '../../../../UIComponents/FloatModals/PreConfigTaskGeneratorModal/PreConfigTaskGeneratorModal',
    () => 'PreConfigTaskGeneratorModal'
)
jest.mock('../../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal', () => 'RunOutOfGold')
jest.mock('../../../../Feeds/CommentsTextInput/MentionsModal/EmptyMatch', () => 'EmptyMatch')
jest.mock('../../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall', () => 'ColoredCircleSmall')
jest.mock('../../../../AdminPanel/Assistants/AssistantAvatar', () => 'AssistantAvatar')
jest.mock('../../../../Icon', () => 'Icon')
jest.mock('../../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal', () => ({
    TASK_TYPE_PROMPT: 'prompt',
    TASK_TYPE_EXTERNAL_LINK: 'link',
    TASK_TYPE_WEBHOOK: 'webhook',
    TASK_TYPE_IFRAME: 'iframe',
}))
jest.mock('../assistantTaskIcon', () => ({ getAssistantTaskIcon: () => 'star' }))
jest.mock('../../../../../utils/modalSafeArea', () => ({ getSafeAreaModalMaxHeight: height => height }))
jest.mock('../../../../../utils/safeUrl', () => ({ getSafeNavigationUrl: url => url }))

const project = { id: 'project-1', name: 'Privat', index: 0 }
const assistant = { uid: 'anna-1', displayName: 'Anna' }
const historicalFact = {
    id: 'tpl-1',
    searchId: 'project-1_anna-1_tpl-1',
    name: 'Historical fact of the day',
    type: 'prompt',
    prompt: 'Tell a historical fact about this day.',
    variables: [],
    projectId: project.id,
    project,
    assistantId: assistant.uid,
    assistant,
}
const variableTemplate = { ...historicalFact, id: 'tpl-2', searchId: 'tpl-2', variables: [{ name: 'Topic' }] }

const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

async function renderModal(props) {
    let tree
    await act(async () => {
        tree = renderer.create(<AssistantTaskSearchModal closeModal={jest.fn()} {...props} />)
    })
    await flush()
    return tree
}

// Presses the template's row in the list, as the user does.
const pressTemplate = tree =>
    act(() => {
        const row = tree.root.find(node => node.props.task && node.props.active !== undefined && node.props.onPress)
        row.props.onPress(row.props.task)
    })

describe('AssistantTaskSearchModal origin conversation (AT-3082)', () => {
    beforeEach(() => {
        mockGenerateTaskFromPreConfig.mockClear()
        mockTasks = [historicalFact]
    })

    it('runs a template from the Anna chat in the background and names that chat as its origin', async () => {
        const origin = { projectId: 'project-1', objectType: 'topics', objectId: 'AnnaChat20261118u1' }
        const tree = await renderModal({ originConversation: origin })
        pressTemplate(tree)

        expect(mockGenerateTaskFromPreConfig).toHaveBeenCalledTimes(1)
        const [projectId, name, assistantId, prompt, , , options] = mockGenerateTaskFromPreConfig.mock.calls[0]
        expect([projectId, name, assistantId, prompt]).toEqual([
            'project-1',
            'Historical fact of the day',
            'anna-1',
            'Tell a historical fact about this day.',
        ])
        expect(options).toEqual({ skipNavigation: true, originConversation: origin })
        tree.unmount()
    })

    it('starts the template once even when it is pressed again', async () => {
        const tree = await renderModal({ originConversation: { projectId: 'p', objectId: 'c' } })
        pressTemplate(tree)
        pressTemplate(tree)
        expect(mockGenerateTaskFromPreConfig).toHaveBeenCalledTimes(1)
        tree.unmount()
    })

    it('names no origin outside the Anna chat (assistant line)', async () => {
        const tree = await renderModal({})
        pressTemplate(tree)
        expect(mockGenerateTaskFromPreConfig.mock.calls[0][6]).toEqual({
            skipNavigation: true,
            originConversation: null,
        })
        tree.unmount()
    })

    it('hands the origin to the variables form of a template that asks for input', async () => {
        mockTasks = [variableTemplate]
        const origin = { projectId: 'project-1', objectType: 'topics', objectId: 'AnnaChat20261118u1' }
        const tree = await renderModal({ originConversation: origin })
        pressTemplate(tree)
        expect(mockGenerateTaskFromPreConfig).not.toHaveBeenCalled()
        expect(tree.root.findByType('PreConfigTaskGeneratorModal').props.originConversation).toBe(origin)
        tree.unmount()
    })
})
