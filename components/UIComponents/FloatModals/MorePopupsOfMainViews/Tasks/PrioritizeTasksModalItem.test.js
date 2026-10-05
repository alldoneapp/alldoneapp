import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import PrioritizeTasksModalItem from './PrioritizeTasksModalItem'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import { createBotQuickTopic } from '../../../../../utils/assistantHelper'
import SharedHelper from '../../../../../utils/SharedHelper'
import { setLanguage } from '../../../../../i18n/TranslationService'

let mockState
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
    shallowEqual: () => false,
}))
jest.mock('../../MorePopupsOfEditModals/Common/ModalItem', () => 'ModalItem')
jest.mock('../../../../../utils/assistantHelper', () => ({ createBotQuickTopic: jest.fn() }))
jest.mock('../../../../../utils/SharedHelper', () => ({ accessGranted: jest.fn(() => true) }))
jest.mock('../../../../../hooks/useProjectData', () => ({ __esModule: true, default: () => {} }))
jest.mock('../../../../../utils/InitialLoad/projectDataLoader', () => ({ PROJECT_DATA_ASSISTANTS: 'assistants' }))
jest.mock('../../../../../redux/actions', () => ({ setAssistantLineAssistant: jest.fn() }))

const anna = { uid: 'anna', displayName: 'Anna' }
const cto = { uid: 'cto', displayName: 'Alldone CTO' }
const designer = { uid: 'designer', displayName: 'Designer' }
const project = { id: 'product', name: 'Alldone Product', assistantId: cto.uid, globalAssistantIds: [] }
const close = jest.fn()
const runOutOfGold = jest.fn()
let tree

const render = (projectId = project.id) => {
    act(() => {
        tree = renderer.create(
            <PrioritizeTasksModalItem
                projectId={projectId}
                shortcut="2"
                onPress={close}
                onRunOutOfGold={runOutOfGold}
            />
        )
    })
    return () => tree.root.findByType(ModalItem)
}

beforeEach(() => {
    jest.clearAllMocks()
    setLanguage('en')
    SharedHelper.accessGranted.mockReturnValue(true)
    createBotQuickTopic.mockResolvedValue({ chatId: 'new-thread' })
    mockState = {
        loggedUser: { uid: 'user', defaultProjectId: 'personal', gold: 100 },
        defaultAssistant: anna,
        loggedUserProjectsMap: { product: project, personal: { id: 'personal', assistantId: anna.uid } },
        globalAssistants: [],
        projectAssistants: { product: [cto, designer], personal: [anna] },
        assistantLineSelection: {},
    }
})

afterEach(() => {
    act(() => tree?.unmount())
    setLanguage('en')
})

it('sends the all-projects prompt in a new standard-assistant thread only on click', async () => {
    mockState.assistantLineSelection.personal = designer.uid
    const item = render(null)
    expect(createBotQuickTopic).not.toHaveBeenCalled()

    await act(async () => item().props.onPress())

    expect(createBotQuickTopic).toHaveBeenCalledWith(anna, expect.any(String), {
        projectId: 'personal',
        enableAssistant: true,
    })
    const prompt = createBotQuickTopic.mock.calls[0][1]
    for (const wording of [
        'my tasks for today',
        'across all projects',
        'update_task',
        'OKRs of each project',
        'project and user context',
        'time of day',
        'day of the week',
        'time available',
        'calendar tasks',
    ]) {
        expect(prompt).toContain(wording)
    }
    // Navigation stays enabled: the shared new-topic flow opens the newly created thread.
    expect(createBotQuickTopic.mock.calls[0][2].skipNavigation).toBeUndefined()
    expect(close).toHaveBeenCalledTimes(1)
})

it('uses the clicked project, its assistant and a prompt confined to that project', async () => {
    const item = render()
    await act(async () => item().props.onPress())
    expect(createBotQuickTopic).toHaveBeenCalledWith(cto, expect.stringContaining('"Alldone Product"'), {
        projectId: 'product',
        enableAssistant: true,
    })
    expect(createBotQuickTopic.mock.calls[0][1]).toContain('Only update tasks in this project')
    expect(createBotQuickTopic.mock.calls[0][1]).toContain('calendar tasks across all projects')
})

it('honours the valid assistant-line choice and ignores a stale choice', async () => {
    mockState.assistantLineSelection.product = designer.uid
    let item = render()
    await act(async () => item().props.onPress())
    expect(createBotQuickTopic.mock.calls[0][0]).toBe(designer)
    act(() => tree.unmount())

    mockState.assistantLineSelection.product = 'deleted-assistant'
    item = render()
    await act(async () => item().props.onPress())
    expect(createBotQuickTopic.mock.calls[1][0]).toBe(cto)
})

it('keeps fallback-assistant chats in the selected project', async () => {
    mockState.loggedUserProjectsMap.product = { ...project, assistantId: '' }
    const item = render()
    await act(async () => item().props.onPress())
    expect(createBotQuickTopic).toHaveBeenCalledWith(anna, expect.any(String), {
        projectId: 'product',
        enableAssistant: true,
    })
})

it.each(['en', 'de', 'es'])('localizes both prompts in %s and preserves the tool and project name', async language => {
    setLanguage(language)
    let item = render()
    await act(async () => item().props.onPress())
    expect(createBotQuickTopic.mock.calls[0][1]).toContain('update_task')
    expect(createBotQuickTopic.mock.calls[0][1]).toContain('Alldone Product')
    expect(createBotQuickTopic.mock.calls[0][1]).not.toContain('translation missing')
    act(() => tree.unmount())
    item = render(null)
    await act(async () => item().props.onPress())
    expect(createBotQuickTopic.mock.calls[1][1]).toContain('update_task')
    expect(createBotQuickTopic.mock.calls[1][1]).not.toContain('translation missing')
    if (language === 'de') expect(createBotQuickTopic.mock.calls[1][1]).toContain('über alle Projekte hinweg')
    if (language === 'es') expect(createBotQuickTopic.mock.calls[1][1]).toContain('en todos los proyectos')
})

it('blocks duplicate clicks while creating the thread and shows loading', async () => {
    let finish
    createBotQuickTopic.mockImplementation(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    const item = render()
    let pending
    act(() => {
        const click = item().props.onPress
        pending = click()
        click()
    })
    expect(createBotQuickTopic).toHaveBeenCalledTimes(1)
    expect(item().props).toMatchObject({ disabled: true, text: 'Starting' })
    expect(close).not.toHaveBeenCalled()
    await act(async () => {
        finish({ chatId: 'new-thread' })
        await pending
    })
    expect(item().props.disabled).toBe(false)
})

it('shows the existing gold modal without creating a chat when gold is exhausted', async () => {
    mockState.loggedUser.gold = 0
    const item = render()
    await act(async () => item().props.onPress())
    expect(runOutOfGold).toHaveBeenCalledTimes(1)
    expect(createBotQuickTopic).not.toHaveBeenCalled()
})

it.each(['access', 'assistant', 'project'])('blocks chat creation for missing %s', async missing => {
    if (missing === 'access') SharedHelper.accessGranted.mockReturnValue(false)
    if (missing === 'assistant') mockState.projectAssistants.product = []
    if (missing === 'project') delete mockState.loggedUserProjectsMap.product
    const item = render()
    expect(item().props.disabled).toBe(true)
    await act(async () => item().props.onPress())
    expect(createBotQuickTopic).not.toHaveBeenCalled()
})

it.each([new Error('network error'), undefined])('keeps failures visible and permits retry', async outcome => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    if (outcome) createBotQuickTopic.mockRejectedValueOnce(outcome)
    else createBotQuickTopic.mockResolvedValueOnce(outcome)
    const item = render()
    await act(async () => item().props.onPress())
    expect(close).not.toHaveBeenCalled()
    expect(tree.root.findByType(Text).props.children).toContain('Please try again')
    expect(item().props.disabled).toBe(false)
    await act(async () => item().props.onPress())
    expect(createBotQuickTopic).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
    log.mockRestore()
})
