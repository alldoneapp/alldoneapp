/**
 * AT-3044 browser regression harness — entry point.
 *
 * "hier fehlt links oben auf mobile die gold anzeige" — on phones (≤ 459px, the
 * `reallySmallScreenNavigation` band) the Gold pill had been moved out of the mobile header
 * into the "more" (⋮) secondary row, leaving an empty gap between the hamburger and the
 * centred Home button.
 *
 * The fix puts Gold back top left and caps the left group so it can never slide under the
 * absolutely-centred Home button. "Does it overlap?" is a layout question jsdom cannot
 * answer (every box is 0x0 there), so this mounts the REAL `TopBarContainer` → `TopBarMobile`
 * → `TopBarMobileStatisticArea` → `GoldArea` / `HomeButton` / `MobileNotificationArea` and
 * `run.js` measures `getBoundingClientRect()`s in real Chromium.
 *
 * Responsive flags mirror `AppNavigator.onLayoutChange` from the same exported constants
 * (see browser-tests/at2426/harness.entry.js for the full rationale).
 */
import 'setimmediate'
import React from 'react'
import { View } from 'react-native'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import TopBarContainer from '../../components/TopBar/TopBarContainer'
import { setLanguage } from '../../i18n/TranslationService'
import {
    toggleMiddleScreen,
    toggleNavPicker,
    toggleReallySmallScreenNavigation,
    toggleSmallScreen,
    toggleSmallScreenNavigation,
} from '../../redux/actions'
import {
    SCREEN_BREAKPOINT_MIDDLE,
    SCREEN_BREAKPOINT_NAV,
    SCREEN_SMALL_BREAKPOINT_NAV,
    SCREEN_BREAKPOINT,
    SIDEBAR_MENU_WIDTH,
} from '../../components/styles/global'

const PROJECT_ID = 'proj-1'
const UID = 'user-1'

const params = new URLSearchParams(window.location.search)
const GOLD = Number(params.get('gold') || 1234)
const EXPANDED = params.get('expanded') === '1'
setLanguage(params.get('lang') || 'de')

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
    themeName: params.get('theme') || 'modern',
    archivedProjectIds: [],
    templateProjectIds: [],
    xp: 1234,
    level: 7,
    skillPoints: 0,
    showSkillPointsNotification: false,
    gold: GOLD,
    premium: { status: 0 },
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

const width = window.innerWidth
const widthScreen = width < SCREEN_BREAKPOINT_NAV ? width : width - SIDEBAR_MENU_WIDTH
const flags = {
    reallySmallScreenNavigation: width <= SCREEN_SMALL_BREAKPOINT_NAV,
    smallScreenNavigation: width <= SCREEN_BREAKPOINT_NAV,
    smallScreen: widthScreen <= SCREEN_BREAKPOINT,
    isMiddleScreen: widthScreen <= SCREEN_BREAKPOINT_MIDDLE - SIDEBAR_MENU_WIDTH,
}
store.dispatch([
    toggleReallySmallScreenNavigation(flags.reallySmallScreenNavigation),
    toggleSmallScreenNavigation(flags.smallScreenNavigation),
    toggleSmallScreen(flags.smallScreen),
    toggleMiddleScreen(flags.isMiddleScreen),
])

try {
    initFirebase(() => {})
} catch (error) {
    console.warn('initFirebase skipped in harness:', error && error.message)
}

function Harness() {
    return (
        <View style={{ flex: 1, backgroundColor: 'white' }}>
            <View nativeID={'header-slot'} style={{ zIndex: 10 }}>
                <TopBarContainer />
            </View>
        </View>
    )
}

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)

const rectOf = element => {
    if (!element) return null
    const { width, height, top, left, right, bottom } = element.getBoundingClientRect()
    return { width, height, top, left, right, bottom }
}

window.__flags = flags
window.__measure = () => {
    const row = document.querySelector('[data-testid="top-bar-mobile"]')
    if (!row) return null
    const left = row.querySelector('[data-testid="top-bar-mobile-left"]')
    const goldIcons = Array.from(document.querySelectorAll('[id="goldArea"]'))
    // GoldArea's TouchableOpacity is the parent of the animated icon wrapper.
    const goldPills = goldIcons.map(icon => icon.parentElement)
    const goldInRow = goldPills.filter(pill => row.contains(pill))
    const goldPill = goldInRow[0] || null
    const goldText = goldPill ? goldPill.lastElementChild : null
    // Row children: [left area, notification area, HomeButton (absolute)].
    const [, rightArea, home] = Array.from(row.children)
    return {
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        row: rectOf(row),
        left: rectOf(left),
        gold: rectOf(goldPill),
        goldText: goldText ? goldText.textContent : null,
        goldTextTruncated: goldText ? goldText.scrollWidth > goldText.clientWidth + 1 : null,
        goldCount: goldPills.length,
        goldInRowCount: goldInRow.length,
        home: rectOf(home),
        right: rectOf(rightArea),
    }
}
// TopBarMobile collapses the "more" row on mount, so open it afterwards, as a tap on ⋮ would.
setTimeout(() => {
    if (EXPANDED) store.dispatch(toggleNavPicker(true))
    setTimeout(() => (window.__ready = true), 400)
}, 200)
