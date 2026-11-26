/**
 * AT-3162: a model picked in the assistant line is pinned on the new chat BEFORE its first message,
 * because that message starts the assistant run and the run reads the chat's pin (AT-2502).
 *
 * Every dependency of `assistantHelper` is replaced by a factory: the module reaches the redux store,
 * the Firebase client and most backends, none of which this ordering needs.
 */
import { createBotQuickTopic } from './assistantHelper'
import { createBotQuickTopicChat } from './backends/Chats/createBotQuickTopic'
import { createObjectMessage } from './backends/Chats/chatsComments'
import { setThreadAssistantModelOverride } from './backends/Assistants/threadAssistantModel'
import { primeThreadAssistantModel } from '../components/ChatsView/ChatDV/EditorView/BotOption/threadAssistantModelState'

jest.mock('./redux/loadingOperation', () => ({ runWithLoading: (_name, run) => run() }))
jest.mock('../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ loggedUser: { uid: 'user-1', displayName: 'Karsten Wysk', defaultProjectId: 'p-default' } }),
        dispatch: jest.fn(),
    },
}))
jest.mock('./backends/firestore', () => ({
    getDb: jest.fn(),
    getId: () => 'chat-1',
    getProjectUsersIds: jest.fn(),
    getTaskData: jest.fn(),
    logEvent: jest.fn(),
    runHttpsCallableFunction: jest.fn(),
}))
jest.mock('../components/Feeds/Utils/FeedsConstants', () => ({ FEED_PUBLIC_FOR_ALL: 0 }))
jest.mock('../components/UIComponents/FloatModals/DateFormatPickerModal', () => ({ getDateFormat: () => 'DD.MM.YYYY' }))
jest.mock('../URLSystem/URLTrigger', () => ({ processUrl: jest.fn() }))
jest.mock('./NavigationService', () => ({}))
jest.mock('../redux/actions', () => ({
    setAssistantEnabled: jest.fn(() => ({ type: 'assistantEnabled' })),
    setDisableAutoFocusInChat: jest.fn(),
    setSelectedNavItem: jest.fn(),
    setTriggerBotSpinner: jest.fn(() => ({ type: 'spinner' })),
    setPreConfigTaskExecuting: jest.fn(),
}))
jest.mock('./HelperFunctions', () => ({ getFirstName: name => name.split(' ')[0] }))
jest.mock('../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getProjectByIndex: jest.fn() },
    checkIfSelectedProject: () => false,
}))
jest.mock('../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../components/AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistantInProject: jest.fn(),
    getAssistantInProjectObject: jest.fn(),
    getAssistantProjectId: () => null,
}))
jest.mock('./backends/Tasks/tasksFirestore', () => ({
    moveTasksFromOpen: jest.fn(),
    setTaskAssistant: jest.fn(),
    uploadNewTask: jest.fn(),
}))
jest.mock('./backends/Notes/notesFirestore', () => ({ setNoteAssistant: jest.fn() }))
jest.mock('./backends/Goals/goalsFirestore', () => ({ setGoalAssistant: jest.fn() }))
jest.mock('./backends/Skills/skillsFirestore', () => ({ setSkillAssistant: jest.fn() }))
jest.mock('../components/TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: {},
    DONE_STEP: -2,
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('./TabNavigationConstants', () => ({ DV_TAB_TASK_CHAT: 'chat' }))
jest.mock('./backends/Chats/chatsComments', () => ({ createChat: jest.fn(), createObjectMessage: jest.fn() }))
jest.mock('./backends/Chats/createBotQuickTopic', () => ({ createBotQuickTopicChat: jest.fn() }))
jest.mock('../components/Feeds/Utils/HelperFunctions', () => ({ STAYWARD_COMMENT: 2 }))
jest.mock('../components/ChatsView/Utils/botSpinnerTrigger', () => ({
    buildBotSpinnerTrigger: jest.fn(),
    endBotSpinnerWait: jest.fn(),
}))
jest.mock('../components/ChatsView/Utils/assistantEnabledScope', () => ({ buildAssistantEnabledScope: jest.fn() }))
jest.mock('./backends/Assistants/threadAssistantModel', () => ({
    readThreadAssistantModelOverride: jest.fn(),
    setThreadAssistantModelOverride: jest.fn((projectId, objectId, objectType, model) => Promise.resolve(model)),
}))
jest.mock('../components/ChatsView/ChatDV/EditorView/BotOption/threadAssistantModelState', () => ({
    primeThreadAssistantModel: jest.fn(),
}))
jest.mock('./taskExecutionMode', () => ({
    TASK_EXECUTION_MODE_DIRECT: 'direct',
    TASK_EXECUTION_MODE_WORKFLOW: 'workflow',
    getTaskExecutionMode: jest.fn(),
}))
jest.mock('./assistantWorkflow', () => ({
    ASSISTANT_WORKFLOW_FIRST_STEP_ID: 'first',
    resolveAssistantWorkflowExecutionMode: jest.fn(),
}))
jest.mock('../functions/shared/assistantTaskCompletionContract', () => ({
    buildOnDemandAssistantTaskMetadata: jest.fn(),
    shouldUseClientTaskCompletionFallback: jest.fn(),
}))

const assistant = { uid: 'assistant-1', displayName: 'Anna' }

beforeEach(() => {
    jest.clearAllMocks()
    createBotQuickTopicChat.mockResolvedValue({
        projectId: 'p1',
        chatId: 'chat-1',
        title: 'Anna <> Karsten',
        isPublicFor: [0],
    })
    createObjectMessage.mockResolvedValue('message-1')
})

const start = options => createBotQuickTopic(assistant, 'Hello', { skipNavigation: true, projectId: 'p1', ...options })

it('pins the picked model on the new chat before the message that starts the run', async () => {
    await start({ assistantModelOverride: 'MODEL_DEEPSEEK_V4_FLASH' })

    expect(setThreadAssistantModelOverride).toHaveBeenCalledWith('p1', 'chat-1', 'topics', 'MODEL_DEEPSEEK_V4_FLASH')
    expect(createBotQuickTopicChat.mock.invocationCallOrder[0]).toBeLessThan(
        setThreadAssistantModelOverride.mock.invocationCallOrder[0]
    )
    expect(setThreadAssistantModelOverride.mock.invocationCallOrder[0]).toBeLessThan(
        createObjectMessage.mock.invocationCallOrder[0]
    )
    // The chat's badge and the comment popup show the pin without a read.
    expect(primeThreadAssistantModel).toHaveBeenCalledWith('p1', 'chat-1', 'MODEL_DEEPSEEK_V4_FLASH')
})

it('waits for the pin before writing the message', async () => {
    let finishPin
    setThreadAssistantModelOverride.mockImplementationOnce(
        (p, o, t, model) => new Promise(resolve => (finishPin = () => resolve(model)))
    )

    const started = start({ assistantModelOverride: 'MODEL_DEEPSEEK_V4_FLASH' })
    await Promise.resolve()
    await Promise.resolve()
    expect(createObjectMessage).not.toHaveBeenCalled()

    finishPin()
    await started
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
})

it.each([
    ['no model', {}],
    ['the inherit entry', { assistantModelOverride: 'INHERIT_ASSISTANT_MODEL' }],
    ['a key that is not selectable', { assistantModelOverride: 'MODEL_RETIRED' }],
])('writes nothing extra for %s (unchanged default behaviour)', async (_label, options) => {
    await start(options)

    expect(setThreadAssistantModelOverride).not.toHaveBeenCalled()
    expect(primeThreadAssistantModel).not.toHaveBeenCalled()
    expect(createObjectMessage).toHaveBeenCalledTimes(1)
})
