import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { hideConfirmPopup, setShowOptionalVersionNotification, showConfirmPopup } from '../../redux/actions'
import GlobalModalsContainerApp from '../../components/UIComponents/GlobalModalsContainerApp'
import {
    CONFIRM_POPUP_MANDATORY_NOTIFICATION,
    CONFIRM_POPUP_TIMEOUT,
    CONFIRM_POPUP_TRIGGER_INFO,
} from '../../components/UIComponents/ConfirmPopup'
import { deleteCacheAndRefresh } from '../../utils/Observers'
import { setWorkspaceViewport } from '../../utils/workspaceViewport'

jest.mock('../../utils/Observers', () => ({ deleteCacheAndRefresh: jest.fn() }))
jest.mock('../../components/Premium/LimitModal/LimitModal', () => () => null)
jest.mock('../../components/Premium/FreePlanWarning', () => () => null)
jest.mock('../../components/Premium/LimitedFeatureModal', () => () => null)
jest.mock('../../components/Premium/LimitModalPremium/LimitModalPremium', () => () => null)
jest.mock('../../components/UIComponents/FloatModals/LevelUpModal/LevelUpModal', () => () => null)
jest.mock('../../components/UIComponents/FloatModals/ChangeContactInfoModalContainerForNewGuideUsers', () => () => null)
jest.mock('../../components/ChatsView/ChatDV/EditorView/BotOption/BotWarningModal', () => () => null)
jest.mock('../../components/MediaBar/RecordVideo/RecordVideo', () => () => null)
jest.mock('../../components/MediaBar/ScreenRecording/NotAvailableScreenRecording', () => () => null)
jest.mock('../../components/MediaBar/ScreenRecording/ScreenRecording', () => () => null)
jest.mock('../../components/Suggeted/TaskSuggestedComment', () => () => null)
jest.mock('../../components/GlobalSearchAlgolia/GlobalSearchModal', () => () => null)
jest.mock('../../components/UIComponents/AccessDeniedPopup', () => () => null)
jest.mock('../../components/UIComponents/ShortcutCheatSheet/CheatSheetModal', () => () => null)
jest.mock(
    '../../components/ProjectDetailedView/ProjectProperties/CopyProject/EndCopyProjectNotification',
    () => () => null
)
jest.mock('../../components/UIComponents/FloatModals/IframeModal/IframeModal', () => () => null)
jest.mock(
    '../../components/UIComponents/FloatModals/PreConfigTaskGeneratorModal/GlobalPreConfigTaskModal',
    () => () => null
)
jest.mock('../../components/UIComponents/FloatModals/ConnectionStateToast', () => () => null)

// Keep transport and unrelated dialog content out of this integration test.
// The host, overlay layers, ConfirmPopup and all three reload UIs are real.
jest.mock('../../redux/store', () => {
    const { createStore } = require('redux')
    const { reduxBatch } = require('@manaflair/redux-batch')
    const initial = {
        loggedUser: {},
        alldoneNewVersion: { major: 2, minor: 0 },
        showConfirmPopupData: { visible: false, object: {} },
        limitQuotaModalData: {},
        recordVideoModalData: {},
        screenRecordingModalData: {},
        taskSuggestedCommentModalData: {},
        endCopyProjectPopupData: {},
    }
    return createStore((state = initial, action) => {
        switch (action.type) {
            case 'Show confirm popup':
                return {
                    ...state,
                    showConfirmPopupData: { visible: true, trigger: action.trigger, object: action.object },
                }
            case 'Hide confirm popup':
                return { ...state, showConfirmPopupData: { visible: false, object: {} } }
            case 'Set optional version notification':
                return { ...state, showOptionalVersionNotification: action.showOptionalVersionNotification }
            default:
                return state
        }
    }, reduxBatch)
})
jest.mock('../../utils/BackendBridge', () => ({}))
jest.mock('../../utils/backends/Users/usersFirestore', () => ({}))
jest.mock('../../utils/backends/firestore', () => ({}))
jest.mock('../../utils/backends/Assistants/assistantsFirestore', () => ({}))
jest.mock('../../utils/backends/Workstreams/workstreamsFirestore', () => ({}))
jest.mock('../../utils/backends/Contacts/contactsFirestore', () => ({}))
jest.mock('../../utils/backends/Notes/notesFirestore', () => ({}))
jest.mock('../../utils/backends/Chats/chatsFirestore', () => ({}))
jest.mock('../../utils/suggestedTaskBulkActions', () => ({}))
jest.mock('../../utils/NavigationService', () => ({}))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({}))
jest.mock('../../components/AdminPanel/Assistants/assistantsHelper', () => ({}))
jest.mock('../../components/Feeds/CommentsTextInput/MentionsModal/GoalProgress', () => () => null)
jest.mock('../../components/UIComponents/FloatModals/KickUserConfirmPopup/KickUserConfirmPopup', () => () => null)
jest.mock(
    '../../components/UIComponents/FloatModals/RevisionHistoryModal/RevisionHistoryConfirmationModal',
    () => () => null
)
jest.mock('../../components/UIComponents/FloatModals/PushNotificationsModalMandatory', () => () => null)

const pane = { top: 60, left: 520, width: 920, height: 840 }
const layouts = [
    ['normal', null, true],
    ['assistant sidebar', pane, true],
    ['chat only / hidden mobile workspace', pane, false],
]

const mount = () =>
    render(
        <Provider store={store}>
            <GlobalModalsContainerApp />
        </Provider>
    )
const layerOf = element => element.closest('[data-testid="workspace-overlay-layer"]')
const showReload = trigger => store.dispatch(showConfirmPopup({ trigger, object: {} }))

beforeEach(() => {
    jest.clearAllMocks()
    store.dispatch(hideConfirmPopup())
    store.dispatch(setShowOptionalVersionNotification(false))
})
afterEach(() => {
    cleanup()
    setWorkspaceViewport(null)
})

it.each(layouts)('shows one clickable optional reload in %s', (_name, rect, visible) => {
    setWorkspaceViewport(rect, visible)
    store.dispatch(setShowOptionalVersionNotification(true))
    mount()
    const reload = screen.getByText('Reload')
    expect(screen.getAllByText('Reload')).toHaveLength(1)
    expect(layerOf(reload).getAttribute('aria-hidden')).toBeNull()
    fireEvent.click(reload)
    expect(deleteCacheAndRefresh).toHaveBeenCalledTimes(1)
})

it.each([CONFIRM_POPUP_MANDATORY_NOTIFICATION, CONFIRM_POPUP_TIMEOUT])(
    'keeps one actionable %s across normal, sidebar and chat layouts without remounting',
    trigger => {
        showReload(trigger)
        mount()
        const reload =
            trigger === CONFIRM_POPUP_MANDATORY_NOTIFICATION
                ? screen.getByTestId('refreshMandatory')
                : screen.getByText('Reload')
        for (const [, rect, visible] of [...layouts, ...layouts.slice().reverse()]) {
            act(() => setWorkspaceViewport(rect, visible))
            expect(layerOf(reload).getAttribute('aria-hidden')).toBeNull()
            expect(
                screen.getAllByText(trigger === CONFIRM_POPUP_MANDATORY_NOTIFICATION ? 'Refresh' : 'Reload')
            ).toHaveLength(1)
            expect(
                trigger === CONFIRM_POPUP_MANDATORY_NOTIFICATION
                    ? screen.getByTestId('refreshMandatory')
                    : screen.getByText('Reload')
            ).toBe(reload)
            expect(getComputedStyle(layerOf(reload)).display).toBe(rect && visible ? 'flex' : 'contents')
        }
        fireEvent.click(reload)
        expect(deleteCacheAndRefresh).toHaveBeenCalledTimes(1)
    }
)

it('dismisses the optional prompt from chat and keeps it dismissed after layout changes', () => {
    setWorkspaceViewport(pane, false)
    store.dispatch(setShowOptionalVersionNotification(true))
    mount()
    // The existing optional prompt's close affordance is its last touchable.
    fireEvent.click(screen.getByText('Reload').parentElement.parentElement.lastElementChild)
    expect(screen.queryByText('Reload')).toBeNull()
    act(() => setWorkspaceViewport(pane, true))
    expect(screen.queryByText('Reload')).toBeNull()
    expect(deleteCacheAndRefresh).not.toHaveBeenCalled()
})

it('keeps unrelated confirmations confined to the workspace even beside an optional reload', () => {
    setWorkspaceViewport(pane, false)
    store.dispatch(setShowOptionalVersionNotification(true))
    store.dispatch(
        showConfirmPopup({ trigger: CONFIRM_POPUP_TRIGGER_INFO, object: { headerText: 'Workspace confirmation' } })
    )
    mount()
    expect(layerOf(screen.getByText(/Workspace confirmation/)).getAttribute('aria-hidden')).toBe('true')
    expect(layerOf(screen.getByText('Reload')).getAttribute('aria-hidden')).toBeNull()
})
