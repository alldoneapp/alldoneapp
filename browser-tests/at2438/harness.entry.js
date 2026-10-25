/**
 * AT-2438 browser regression harness — entry point.
 *
 * "the buttons below the input field seem to not fit fully into the background ..
 *  background row has a wrong size"
 *
 * The defect is a HEIGHT, so Jest cannot see it: jsdom implements no layout, every box
 * there is 0x0, and "the Send button hangs out of the grey band" is exactly the claim a
 * jsdom test structurally cannot make. This harness mounts the REAL `ChatInput` — and
 * through it the real `AttachmentDropZone`, `CustomTextInput3` (real Quill 2) and
 * `ChatInputButtons` — inside the shell `ChatBoard` composes (a `flex: 1`
 * KeyboardAvoidingView holding the message scroller and the composer), and `run.js`
 * measures real `getBoundingClientRect()`s in real Chromium.
 *
 * Nothing on the measured path is a double.
 */
import 'setimmediate'
import React from 'react'
import { KeyboardAvoidingView, View } from 'react-native'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import ChatInput from '../../components/ChatsView/ChatDV/EditorView/ChatInput'
import CustomScrollView from '../../components/UIControls/CustomScrollView'
import { setLanguage } from '../../i18n/TranslationService'
import { toggleSmallScreen, toggleSmallScreenNavigation } from '../../redux/actions'
import { SCREEN_BREAKPOINT, SCREEN_BREAKPOINT_NAV } from '../../components/styles/global'

const PROJECT_ID = 'proj-1'
const UID = 'user-1'
const CHAT_ID = 'chat-1'

const user = {
    uid: UID,
    displayName: 'Test User',
    email: 't@e.st',
    photoURL: '',
    photoURL300: '',
    defaultProjectId: PROJECT_ID,
    activeProjects: [PROJECT_ID],
    inactiveProjects: [],
    projectIds: [PROJECT_ID],
    isAnonymous: false,
    sidebarExpanded: true,
    themeName: 'default',
    archivedProjectIds: [],
    templateProjectIds: [],
    xp: 1234,
    level: 7,
    skillPoints: 0,
    showSkillPointsNotification: false,
    gold: 1234,
    premium: { status: 0 },
    language: 'en',
}

store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: { id: PROJECT_ID, name: 'Proj', color: '#ffffff', isShared: false, parentTemplateId: null },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})

const params = new URLSearchParams(window.location.search)
setLanguage(params.get('lang') || 'en')

const applyViewportFlags = () => {
    const width = window.innerWidth
    store.dispatch([
        toggleSmallScreenNavigation(width <= SCREEN_BREAKPOINT_NAV),
        toggleSmallScreen((width <= SCREEN_BREAKPOINT_NAV ? width : width - 260) <= SCREEN_BREAKPOINT),
    ])
}

const chat = { id: CHAT_ID, type: 'tasks', title: 'A topic', isAssistantEnabled: false }

/**
 * The composer as `ChatBoard` composes it: a `flex: 1` KeyboardAvoidingView holding the
 * message scroller (`flex: 1`) and the composer beneath it. Reproduced rather than
 * mounting ChatBoard itself, which would need the whole message/feed subscription tree;
 * what is under test is how the composer's own two children share the card.
 */
function Harness() {
    return (
        <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
            <CustomScrollView containerStyle={[{ paddingTop: 8, paddingBottom: 32, marginLeft: -13 }]}>
                <View style={{ height: 400 }} />
            </CustomScrollView>
            <ChatInput
                projectId={PROJECT_ID}
                chat={chat}
                parentObject={null}
                chatTitle={'A topic'}
                members={[user]}
                setWaitingForBotAnswer={() => {}}
                assistantId={null}
                setAssistantId={() => {}}
                objectType={'tasks'}
                setAmountOfNewCommentsToHighligth={() => {}}
                onMessageSent={() => {}}
                autoFocus={false}
                creatorId={UID}
                creatorData={user}
            />
        </KeyboardAvoidingView>
    )
}

try {
    initFirebase()
} catch (error) {
    console.warn('initFirebase skipped in harness:', error && error.message)
}

applyViewportFlags()
const root = createRoot(document.getElementById('root'))
const render = () =>
    root.render(
        <Provider store={store}>
            <Harness />
        </Provider>
    )
render()

// The state the task's screenshot is in. `translate()` resolves against `i18n.locale`,
// which starts as the DEVICE language and is switched to the account language by
// `useTranslator` once the user doc arrives — so on any machine whose browser locale
// differs from the account language the composer re-renders with a DIFFERENT placeholder
// string shortly after login. That is a plain prop change to `<ReactQuill>`, and it is
// what makes react-quill-new write the app-encoded placeholder into the DOM.
const secondLanguage = params.get('lang2')
if (secondLanguage) {
    setTimeout(() => {
        setLanguage(secondLanguage)
        render()
    }, 50)
}

const rectOf = element => {
    if (!element) return null
    const { width, height, top, left, right, bottom } = element.getBoundingClientRect()
    return { width, height, top, left, right, bottom }
}

/**
 * Located structurally from the live DOM rather than through test ids, so the harness
 * measures the shipped tree: the card is the composer's own container (the element that
 * holds the editor's scroll boundary), its first child is the text area and its second
 * is the action row.
 */
const parts = () => {
    const editor = document.querySelector('.ql-editor')
    if (!editor) return null
    const scrollBoundary = editor.closest('[id^="ql-scroll-boundary-"]')
    if (!scrollBoundary) return null
    const card = scrollBoundary.parentElement
    if (!card || card.children.length < 2) return null
    const row = card.children[1]
    // Everything the row actually paints. The question the task asks — "the buttons do
    // not fit fully into the background" — is about visible content leaving the band, so
    // measure every laid-out descendant rather than guessing at a button selector (the
    // row nests Hotkeys wrappers, Buttons, icons and labels, none of which carry a role).
    const buttons = Array.from(row.querySelectorAll('*')).filter(node => {
        const rect = node.getBoundingClientRect()
        return rect.height > 0 && rect.width > 0
    })
    return { editor, scrollBoundary, card, row, buttons }
}

window.__measure = () => {
    const found = parts()
    if (!found) return null
    const { editor, scrollBoundary, card, row, buttons } = found
    const rowRect = row.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    if (!rowRect.height || !buttons.length) return null
    return {
        card: rectOf(card),
        textArea: rectOf(scrollBoundary),
        row: rectOf(row),
        rowStyle: (() => {
            const cs = getComputedStyle(row)
            return {
                height: cs.height,
                flexGrow: cs.flexGrow,
                flexShrink: cs.flexShrink,
                flexBasis: cs.flexBasis,
                minHeight: cs.minHeight,
                paddingTop: cs.paddingTop,
                paddingBottom: cs.paddingBottom,
                borderTopWidth: cs.borderTopWidth,
            }
        })(),
        buttons: buttons.map(node => {
            const r = node.getBoundingClientRect()
            return {
                text: (node.textContent || '').trim().slice(0, 24),
                height: r.height,
                top: r.top,
                bottom: r.bottom,
                overflowBelowRow: r.bottom - rowRect.bottom,
                overflowAboveRow: rowRect.top - r.top,
                overflowBelowCard: r.bottom - cardRect.bottom,
            }
        }),
        placeholder: editor.getAttribute('data-placeholder'),
    }
}

window.__ready = true
