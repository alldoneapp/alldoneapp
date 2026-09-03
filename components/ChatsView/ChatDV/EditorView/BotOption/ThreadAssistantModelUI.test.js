import React from 'react'
import fs from 'fs'
import path from 'path'
import renderer, { act } from 'react-test-renderer'

import SelectModelOption from './SelectModelOption'
import ThreadAssistantModelModal from './ThreadAssistantModelModal'
import ThreadModelAssistantAvatar from './ThreadModelAssistantAvatar'
import { resetThreadAssistantModelCache, useThreadAssistantModel } from './threadAssistantModelState'
import {
    readThreadAssistantModelOverride,
    setThreadAssistantModelOverride,
} from '../../../../../utils/backends/Assistants/threadAssistantModel'

const mockState = {
    smallScreenNavigation: false,
    isMiddleScreen: false,
    loggedUser: { sidebarExpanded: false },
}

jest.mock('react-redux', () => ({
    shallowEqual: jest.fn(),
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock(
    'react-hot-keys',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../../../utils/useWindowSize', () => () => [1024, 768])
jest.mock('../../../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({ width: 432 }) }))
jest.mock('../../../../UIComponents/FloatModals/ModalHeader', () => 'ModalHeader')
jest.mock('../../../../UIControls/CustomScrollView', () => 'CustomScrollView')
jest.mock('../../../../UIControls/Shortcut', () => ({ __esModule: true, default: 'Shortcut', SHORTCUT_LIGHT: 'light' }))
jest.mock('../../../../../utils/backends/Assistants/threadAssistantModel', () => ({
    canOverrideThreadAssistantModel: jest.fn(() => true),
    readThreadAssistantModelOverride: jest.fn(() => Promise.resolve(null)),
    setThreadAssistantModelOverride: jest.fn((p, o, t, model) =>
        Promise.resolve(model === 'INHERIT_ASSISTANT_MODEL' ? null : model)
    ),
}))

const flush = async () => {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

// react-native-web renders <Text> as a <div>, so the rendered tree has no 'Text' nodes to find.
const textsOf = tree => JSON.stringify(tree.toJSON())

describe('the per-thread model UI (AT-2502)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        resetThreadAssistantModelCache()
    })

    describe('the row in the assistant popup', () => {
        it('names the assistant default when the thread pins nothing', () => {
            const tree = renderer.create(
                <SelectModelOption threadModel={null} assistantModel={'MODEL_GPT5_6_SOL'} onPress={jest.fn()} />
            )

            const texts = textsOf(tree)
            expect(texts).toContain('Select model')
            expect(texts).toContain('Sol')
            expect(texts).toContain('Assistant default')
            expect(texts).not.toContain('Only for this thread')
        })

        // The whole point of the feature is that this thread can differ from the assistant, so the
        // row has to say which of the two the user is looking at without opening the picker.
        it('names the pinned model and says it applies only here', () => {
            const tree = renderer.create(
                <SelectModelOption
                    threadModel={'MODEL_DEEPSEEK_V4_FLASH'}
                    assistantModel={'MODEL_GPT5_6_SOL'}
                    onPress={jest.fn()}
                />
            )

            const texts = textsOf(tree)
            expect(texts).toContain('DeepSeek Flash')
            expect(texts).toContain('Only for this thread')
            expect(texts).not.toContain('Sol')
        })

        // An assistant left on a retired model has no friendly name; the row still has to say
        // something true rather than render an empty line.
        it('survives an assistant configured with a model outside the menu', () => {
            const tree = renderer.create(
                <SelectModelOption threadModel={null} assistantModel={'MODEL_GPT5_5'} onPress={jest.fn()} />
            )

            expect(textsOf(tree)).toContain('Assistant default')
        })
    })

    describe('the picker', () => {
        const renderPicker = (props = {}) =>
            renderer.create(
                <ThreadAssistantModelModal
                    closeModal={jest.fn()}
                    selectedModel={null}
                    assistantModel={'MODEL_GPT5_6_SOL'}
                    updateModel={jest.fn()}
                    {...props}
                />
            )

        const optionsOf = tree =>
            tree.root.findAll(node => typeof node.type === 'function' && node.type.name === 'OptionItem', {
                deep: false,
            })

        // Without a way back the pin would be a one-way door: a thread could be moved off the
        // assistant's model and never returned to it.
        it('offers a way back to the assistant model, first, naming it', () => {
            const options = optionsOf(renderPicker())

            expect(options[0].props.modelData.model).toBe('INHERIT_ASSISTANT_MODEL')
            expect(options[0].props.modelData.text).toBe('Use assistant model (Sol)')
        })

        it('offers every selectable model with its Gold rate', () => {
            const options = optionsOf(renderPicker())

            expect(options.map(option => option.props.modelData.model)).toEqual([
                'INHERIT_ASSISTANT_MODEL',
                'MODEL_GPT5_6_SOL',
                'MODEL_GPT5_6_TERRA',
                'MODEL_GPT5_6_LUNA',
                'MODEL_DEEPSEEK_V4_FLASH',
            ])
            expect(options.slice(1).every(option => option.props.modelData.tokensPerGold > 0)).toBe(true)
        })

        it('shows the inherit entry as selected for an unpinned thread', () => {
            expect(optionsOf(renderPicker())[0].props.selectedModel).toBe('INHERIT_ASSISTANT_MODEL')
        })

        it('shows the pinned model as selected', () => {
            const options = optionsOf(renderPicker({ selectedModel: 'MODEL_GPT5_6_LUNA' }))

            expect(options[0].props.selectedModel).toBe('MODEL_GPT5_6_LUNA')
        })

        it('stores the choice and closes', () => {
            const updateModel = jest.fn()
            const closeModal = jest.fn()
            const options = optionsOf(renderPicker({ updateModel, closeModal }))

            act(() => {
                options[2].props.selectModel('MODEL_GPT5_6_TERRA')
            })

            expect(updateModel).toHaveBeenCalledWith('MODEL_GPT5_6_TERRA')
            expect(closeModal).toHaveBeenCalled()
        })
    })

    describe('the badge on the assistant avatar', () => {
        const renderAvatar = (props = {}) =>
            renderer.create(
                <ThreadModelAssistantAvatar
                    projectId={'project-1'}
                    objectId={'object-1'}
                    objectType={'tasks'}
                    assistantId={'assistant-1'}
                    {...props}
                />
            )

        const badges = tree => tree.root.findAll(node => node.props?.accessibilityLabel === 'thread-model-override')

        it('is absent for a thread that follows its assistant', async () => {
            readThreadAssistantModelOverride.mockResolvedValue(null)
            let tree
            await act(async () => {
                tree = renderAvatar()
            })
            await flush()

            expect(badges(tree)).toHaveLength(0)
        })

        it('appears for a pinned thread', async () => {
            readThreadAssistantModelOverride.mockResolvedValue('MODEL_GPT5_6_TERRA')
            let tree
            await act(async () => {
                tree = renderAvatar()
            })
            await flush()

            expect(badges(tree)).toHaveLength(1)
        })

        // It sits on top of the button that opens the picker, so it must never swallow the press.
        it('cannot intercept the press that opens the popup', async () => {
            readThreadAssistantModelOverride.mockResolvedValue('MODEL_GPT5_6_TERRA')
            let tree
            await act(async () => {
                tree = renderAvatar()
            })
            await flush()

            expect(badges(tree)[0].props.pointerEvents).toBe('none')
        })

        // The task list renders one of these per row; a badge there would cost one document read
        // per visible task, so the button opts in and the list does not.
        it('reads nothing when the caller does not opt in', async () => {
            await act(async () => {
                renderAvatar({ projectId: null, objectId: null })
            })
            await flush()

            expect(readThreadAssistantModelOverride).not.toHaveBeenCalled()
        })
    })

    describe('the shared thread state', () => {
        const Harness = ({ onRender }) => {
            const state = useThreadAssistantModel('project-1', 'object-1', 'tasks')
            onRender(state)
            return null
        }

        it('reads a thread once however many surfaces are showing it', async () => {
            readThreadAssistantModelOverride.mockResolvedValue('MODEL_GPT5_6_LUNA')
            const seen = []
            await act(async () => {
                renderer.create(<Harness onRender={state => seen.push(state.model)} />)
                renderer.create(<Harness onRender={() => {}} />)
            })
            await flush()

            expect(readThreadAssistantModelOverride).toHaveBeenCalledTimes(1)
            expect(seen[seen.length - 1]).toBe('MODEL_GPT5_6_LUNA')
        })

        // The popup closes the moment a model is picked, so the badge behind it has to be right
        // already — without a second read.
        it('updates every surface from one selection, with no refetch', async () => {
            readThreadAssistantModelOverride.mockResolvedValue(null)
            const seen = []
            let controls
            let badgeTree
            await act(async () => {
                renderer.create(
                    <Harness
                        onRender={state => {
                            controls = state
                            seen.push(state.model)
                        }}
                    />
                )
                badgeTree = renderer.create(
                    <ThreadModelAssistantAvatar
                        projectId={'project-1'}
                        objectId={'object-1'}
                        objectType={'tasks'}
                        assistantId={'assistant-1'}
                    />
                )
            })
            await flush()

            await act(async () => {
                await controls.updateModel('MODEL_GPT5_6_TERRA')
            })
            await flush()

            expect(setThreadAssistantModelOverride).toHaveBeenCalledWith(
                'project-1',
                'object-1',
                'tasks',
                'MODEL_GPT5_6_TERRA'
            )
            expect(seen[seen.length - 1]).toBe('MODEL_GPT5_6_TERRA')
            expect(
                badgeTree.root.findAll(node => node.props?.accessibilityLabel === 'thread-model-override')
            ).toHaveLength(1)
            expect(readThreadAssistantModelOverride).toHaveBeenCalledTimes(1)
        })

        // Clearing has to be reflected as "no pin", not as a stale value the badge keeps showing.
        it('clears the pin back to the assistant default', async () => {
            readThreadAssistantModelOverride.mockResolvedValue('MODEL_GPT5_6_TERRA')
            const seen = []
            let controls
            await act(async () => {
                renderer.create(
                    <Harness
                        onRender={state => {
                            controls = state
                            seen.push(state.model)
                        }}
                    />
                )
            })
            await flush()
            expect(seen[seen.length - 1]).toBe('MODEL_GPT5_6_TERRA')

            await act(async () => {
                await controls.updateModel('INHERIT_ASSISTANT_MODEL')
            })
            await flush()

            expect(seen[seen.length - 1]).toBeNull()
        })
    })

    // `BotOptionsModal` cannot be rendered here — its import graph reaches the Firebase client and
    // the env-injected config. The three units above ARE its content; this pins that it actually
    // hosts them, and that picking a model never touches the thread's assistant.
    describe('the popup wiring', () => {
        const source = fs.readFileSync(path.join(__dirname, 'BotOptionsModal.js'), 'utf8')

        it('renders the model row from the shared thread state', () => {
            expect(source).toContain("import SelectModelOption from './SelectModelOption'")
            expect(source).toContain("import { useThreadAssistantModel } from './threadAssistantModelState'")
            expect(source).toContain('useThreadAssistantModel(projectId, objectId, normalizedObjectType)')
            expect(source).toMatch(/canPinThreadModel && \(/)
            expect(source).toMatch(/<SelectModelOption[\s\S]*?threadModel=\{threadModel\}/)
        })

        it('opens the per-thread picker, not the assistant-level one', () => {
            expect(source).toMatch(/showModels \? \(\s*<ThreadAssistantModelModal/)
            expect(source).toMatch(/<ThreadAssistantModelModal[\s\S]*?updateModel=\{updateThreadModel\}/)
        })

        // `DvBotButton` is BOTH the detail-view header avatar (one thread on screen) and the
        // task-list row button (one per visible task). The badge costs a document read, so the
        // header opts in and the list must not — the difference is one prop, and it is exactly
        // the kind of thing a later edit adds "for consistency" without noticing the cost.
        it('badges the detail-view header avatars but never a task-list row', () => {
            const read = file => fs.readFileSync(path.join(__dirname, '../../../..', file), 'utf8')

            expect(read('TaskDetailedView/Header/TagList.js')).toMatch(
                /<DvBotButton[\s\S]*?showThreadModelBadge=\{true\}[\s\S]*?\/>/
            )
            expect(read('NotesView/NotesDV/TagList.js')).toMatch(
                /<DvBotButton[\s\S]*?showThreadModelBadge=\{true\}[\s\S]*?\/>/
            )
            expect(read('TaskListView/TaskItem/TaskAssistantButton.js')).not.toContain('showThreadModelBadge')
            // …and the control itself must keep the badge off by default, so a new call site is
            // cheap until it deliberately asks.
            expect(read('UIControls/DvBotButton.js')).toContain('showThreadModelBadge = false')
        })

        it('leaves the thread assistant alone when a model is picked', () => {
            const modelBlock = source.slice(
                source.indexOf('<ThreadAssistantModelModal'),
                source.indexOf(') : selectedTask')
            )
            expect(modelBlock).not.toContain('setAssistantForObject')
            expect(modelBlock).not.toContain('setAssistantId')
        })
    })
})
