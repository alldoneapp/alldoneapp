import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { View } from 'react-native'

// AT-2341: the email/calendar type chip used to be a sibling of the title inside a
// `flexDirection: 'row'` container, which reserved a full-height column for it — every wrapped
// line of the task name stayed trapped in the remaining width. The chip now travels through
// SocialText's `leftCustomElement`, i.e. it lives *inside* the wrapping text flow, exactly like
// the task list renders it. These tests pin that structure plus the responsive collapsed height.

const mockStoreState = {
    selectedNavItem: 'TASK_CHAT',
    taskTitleInEditMode: false,
    smallScreenNavigation: false,
    loggedUser: { uid: 'user-1' },
}

let mockStoreListener = null

jest.mock('../../../utils/WebShims/Localization', () => ({
    locale: 'en-US',
    getLocales: () => [{ languageCode: 'en' }],
}))
jest.mock('../../../utils/BackendBridge', () => ({}))
jest.mock('../../../redux/store', () => ({
    getState: () => mockStoreState,
    subscribe: listener => {
        mockStoreListener = listener
        return jest.fn()
    },
    dispatch: jest.fn(),
}))
jest.mock('../../../redux/actions', () => ({
    setTaskTitleInEditMode: value => ({ type: 'SET_TASK_TITLE_IN_EDIT_MODE', value }),
}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfLoggedUserIsNormalUserInGuide: () => false,
}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({ setTaskName: jest.fn() }))

// The real GmailTag pulls in the Gmail URL helpers and Icon fonts; a marker component is enough
// to assert *where* in the tree the chip ends up.
jest.mock('../../../components/Tags/GmailTag', () => {
    const React = require('react')
    const { View } = require('react-native')
    const GmailTag = props => <View testID="gmail-tag" {...props} />
    return GmailTag
})

// SocialTextInput is stubbed with a component that actually renders `leftCustomElement`, so the
// chip's position in the tree reflects the real composition (SocialTextInput -> SocialText ->
// Content -> LeftTagsAndIcons) without booting Quill.
jest.mock('../../../components/SocialTextInput', () => {
    const React = require('react')
    const { Text, View } = require('react-native')
    const SocialTextInputMock = props => (
        <View testID="social-text-input">
            {props.leftCustomElement}
            <Text>{props.value}</Text>
        </View>
    )
    return SocialTextInputMock
})

import { DV_TAB_TASK_CHAT, DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import TaskTitle, {
    COLLAPSED_TITLE_LINES_DESKTOP,
    COLLAPSED_TITLE_LINES_MOBILE,
    EXPANDED_TITLE_MAX_HEIGHT,
    TITLE_LINE_HEIGHT,
    TITLE_UPPER_SPACER_HEIGHT,
    getCollapsedTitleMaxHeight,
} from '../../../components/TaskDetailedView/Header/TaskTitle'
import GmailTag from '../../../components/Tags/GmailTag'
import SocialTextInput from '../../../components/SocialTextInput'

const gmailTask = {
    id: 'task-1',
    userId: 'user-1',
    linkBack: [],
    gmailData: { origin: 'gmail_label_follow_up', messageId: 'msg-1' },
}

const plainTask = { id: 'task-2', userId: 'user-1', linkBack: [] }

const renderTitle = (task, title = 'A very long email subject that needs the full heading width') =>
    renderer.create(<TaskTitle projectId="project-1" task={task} title={title} object={task} />)

const findByStyleKey = (tree, key) =>
    tree.root.findAll(node => {
        if (node.type !== View) return false
        const style = [].concat(node.props.style || []).filter(Boolean)
        return style.some(entry => entry && entry[key] !== undefined)
    })

beforeEach(() => {
    mockStoreState.selectedNavItem = DV_TAB_TASK_CHAT
    mockStoreState.taskTitleInEditMode = false
    mockStoreState.smallScreenNavigation = false
    mockStoreListener = null
})

describe('Task DV heading layout (AT-2341)', () => {
    describe('type chip placement', () => {
        it('hands the Gmail chip to SocialTextInput as a left element instead of a sibling column', () => {
            const tree = renderTitle(gmailTask)

            const socialTextInput = tree.root.findByType(SocialTextInput)
            expect(socialTextInput.props.leftCustomElement).toBeTruthy()

            // Exactly one chip, and it is rendered from inside the title's text flow.
            const chips = tree.root.findAllByType(GmailTag)
            expect(chips).toHaveLength(1)
            expect(socialTextInput.findAllByType(GmailTag)).toHaveLength(1)
        })

        it('leaves the title as the only child of the heading row, so nothing reserves a column', () => {
            const tree = renderTitle(gmailTask)

            const [bottomContainer] = findByStyleKey(tree, 'flexDirection')
            expect(React.Children.count(bottomContainer.props.children)).toBe(1)
        })

        it('renders no chip for a task that is not a Gmail follow-up', () => {
            const tree = renderTitle(plainTask)

            expect(tree.root.findAllByType(GmailTag)).toHaveLength(0)
            expect(tree.root.findByType(SocialTextInput).props.leftCustomElement).toBeNull()
        })
    })

    describe('responsive collapsed height', () => {
        it('gives mobile three title lines and desktop one', () => {
            expect(COLLAPSED_TITLE_LINES_MOBILE).toBeGreaterThan(COLLAPSED_TITLE_LINES_DESKTOP)
            expect(getCollapsedTitleMaxHeight(true)).toBe(
                TITLE_UPPER_SPACER_HEIGHT + TITLE_LINE_HEIGHT * COLLAPSED_TITLE_LINES_MOBILE
            )
            // Desktop keeps the historic 70px cap it had before AT-2341.
            expect(getCollapsedTitleMaxHeight(false)).toBe(70)
        })

        it('applies the mobile cap to the rendered title container', () => {
            mockStoreState.smallScreenNavigation = true
            const tree = renderTitle(gmailTask)

            const container = tree.root.findAllByType(View)[0]
            const maxHeight = []
                .concat(container.props.style)
                .filter(Boolean)
                .reduce((found, entry) => (entry.maxHeight !== undefined ? entry.maxHeight : found), undefined)

            expect(maxHeight).toBe(getCollapsedTitleMaxHeight(true))
        })

        it('reacts to a resize into mobile without remounting', () => {
            const tree = renderTitle(gmailTask)
            const instance = tree.root.findByType(TaskTitle).instance

            expect(instance.getMaxHeight()).toBe(getCollapsedTitleMaxHeight(false))

            mockStoreState.smallScreenNavigation = true
            act(() => {
                mockStoreListener()
            })

            expect(instance.getMaxHeight()).toBe(getCollapsedTitleMaxHeight(true))
        })

        it('never caps the title outside the chat and note tabs', () => {
            mockStoreState.selectedNavItem = DV_TAB_ROOT_TASKS
            mockStoreState.smallScreenNavigation = true
            const tree = renderTitle(gmailTask)

            expect(tree.root.findByType(TaskTitle).instance.getMaxHeight()).toBe(EXPANDED_TITLE_MAX_HEIGHT)
        })
    })

    describe('store subscription lifecycle', () => {
        // The subscription used to be created in the constructor and torn down from state. Redux
        // notifies a snapshot of its listener list, so a dispatch that unmounted the view still
        // reached the listener once and logged "[TaskTitle] updateState called after unmount" on
        // every navigation away from a task. The subscription now lives from mount to unmount and
        // a late notification is ignored silently.
        it('subscribes on mount, unsubscribes on unmount and ignores a notification after unmount', () => {
            const store = require('../../../redux/store')
            const unsubscribe = jest.fn()
            const subscribeSpy = jest.spyOn(store, 'subscribe').mockImplementation(listener => {
                mockStoreListener = listener
                return unsubscribe
            })
            const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
            try {
                const tree = renderTitle(plainTask)
                expect(subscribeSpy).toHaveBeenCalledTimes(1)
                const instance = tree.root.findByType(TaskTitle).instance

                mockStoreState.taskTitleInEditMode = true
                act(() => {
                    mockStoreListener()
                })
                expect(instance.state.taskTitleInEditMode).toBe(true)

                act(() => {
                    tree.unmount()
                })
                expect(unsubscribe).toHaveBeenCalledTimes(1)

                mockStoreState.taskTitleInEditMode = false
                expect(() => mockStoreListener()).not.toThrow()
                expect(debugSpy).not.toHaveBeenCalled()
                expect(logSpy).not.toHaveBeenCalled()
            } finally {
                subscribeSpy.mockRestore()
                debugSpy.mockRestore()
                logSpy.mockRestore()
            }
        })
    })
})
