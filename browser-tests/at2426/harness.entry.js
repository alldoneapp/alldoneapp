/**
 * AT-2426 browser regression harness — entry point.
 *
 * "On Tablet Sizes we should also show the 'Slow Connection' etc. chip below the
 *  header like on mobile .. otherwise it doesnt fit"
 *
 * The defect is a WIDTH, so it cannot be reproduced in Jest: jsdom implements no
 * layout at all — every box measures 0x0 — so "the chip does not fit" is exactly the
 * class of claim a jsdom test cannot make. The Jest suites next to the components pin
 * the DECISION (which placement each set of responsive flags selects); only a real
 * engine can say whether the decision was the right one.
 *
 * This harness therefore mounts the REAL `TopBarContainer` — and through it the real
 * `TopBar`, `TopBarStatisticArea`, `XpBar`, `GoldArea`, `TasksStatisticsArea`,
 * `QuotaBar` and `NotificationArea` — inside a shell with the app's real geometry
 * (`SIDEBAR_MENU_WIDTH` spacer + `flex: 1` content column, as `RootView` composes it),
 * and `run.js` measures real `getBoundingClientRect()`s in real Chromium.
 *
 * Nothing on the measured path is a double. The one thing reproduced rather than
 * imported is `AppNavigator.onLayoutChange`'s flag arithmetic, which is a module-private
 * function; it is mirrored here from the SAME exported constants it uses, and the flag
 * math itself is pinned separately by `components/TopBar/connectionChipPlacement.test.js`.
 */
import 'setimmediate'
import React from 'react'
import { View } from 'react-native'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import TopBarContainer from '../../components/TopBar/TopBarContainer'
import ConnectionStatusChip from '../../components/TopBar/ConnectionStatusChip'
import { showConnectionChipBelowHeader } from '../../components/TopBar/connectionChipPlacement'
import { setLanguage } from '../../i18n/TranslationService'
import {
    setConnectionHealth,
    toggleMiddleScreen,
    toggleReallySmallScreenNavigation,
    toggleSmallScreen,
    toggleSmallScreenNavigation,
} from '../../redux/actions'
import {
    SCREEN_BREAKPOINT_MIDDLE,
    SCREEN_BREAKPOINT_NAV,
    SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED,
    SCREEN_SMALL_BREAKPOINT_NAV,
    SCREEN_BREAKPOINT,
    SIDEBAR_MENU_WIDTH,
} from '../../components/styles/global'

const PROJECT_ID = 'proj-1'
const UID = 'user-1'

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
    // `loggedUser` defaults to `{}` in the store, so the top bar's stat pills need real
    // values here or they render at the wrong intrinsic width — which would silently
    // invalidate every measurement this harness exists to make.
    themeName: 'default',
    archivedProjectIds: [],
    templateProjectIds: [],
    xp: 1234,
    level: 7,
    skillPoints: 0,
    showSkillPointsNotification: false,
    gold: 1234,
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

const params = new URLSearchParams(window.location.search)
// Which status the chip is showing. "Slow connection" is the longest of the four
// labels and therefore the worst case — the one the task names.
const HEALTH = params.get('health') || 'slow'
const SIDEBAR_EXPANDED = params.get('sidebar') !== 'collapsed'
// The label is translated, and the header's slack is measured in single-digit pixels at
// some widths — so the language is part of the geometry, not a detail. German's
// "Langsame Verbindung" is four characters longer than "Slow connection".
const LANGUAGE = params.get('lang') || 'en'

// `translate()` reads `i18n.locale` directly, so this is all the chip needs; the
// `useTranslator` hook that mirrors `loggedUser.language` lives in RootView, which the
// harness does not mount.
setLanguage(LANGUAGE)

store.dispatch(setConnectionHealth(HEALTH))

/**
 * Mirrors `AppNavigator.onLayoutChange` (AppNavigator.js:56-134) for the flags that
 * decide top-bar layout. Reproduced, not imported, because that handler is private to
 * the module and reaching it would mean booting the whole navigator; it reads from the
 * same exported constants, so a breakpoint move cannot silently desync the two.
 *
 * Note `widthScreen` subtracts the sidebar only ABOVE the nav breakpoint — that
 * discontinuity is why `smallScreenNavigation` does not imply `isMiddleScreen`.
 */
const responsiveFlagsFor = (width, sidebarExpanded) => {
    const screenBreakpointNav = sidebarExpanded ? SCREEN_BREAKPOINT_NAV : SCREEN_BREAKPOINT_NAV_SIDEBAR_COLLAPSED
    const widthScreen = width < screenBreakpointNav ? width : width - SIDEBAR_MENU_WIDTH
    return {
        reallySmallScreenNavigation: width <= SCREEN_SMALL_BREAKPOINT_NAV,
        smallScreenNavigation: width <= screenBreakpointNav,
        smallScreen: widthScreen <= SCREEN_BREAKPOINT,
        isMiddleScreen: widthScreen <= SCREEN_BREAKPOINT_MIDDLE - SIDEBAR_MENU_WIDTH,
    }
}

const applyViewportFlags = () => {
    const width = window.innerWidth
    const flags = responsiveFlagsFor(width, SIDEBAR_EXPANDED)
    store.dispatch([
        toggleReallySmallScreenNavigation(flags.reallySmallScreenNavigation),
        toggleSmallScreenNavigation(flags.smallScreenNavigation),
        toggleSmallScreen(flags.smallScreen),
        toggleMiddleScreen(flags.isMiddleScreen),
    ])
    return flags
}

/**
 * The app shell as `RootView` composes it: a row of [sidebar, content column]. The
 * sidebar is a plain spacer — `CustomSideMenu` pulls in the whole navigation tree and
 * contributes nothing but its width to the geometry under test.
 */
function Harness() {
    const belowHeader = showConnectionChipBelowHeader(store.getState())
    const showSidebar = !store.getState().smallScreenNavigation
    return (
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'white' }}>
            {showSidebar && <View style={{ width: SIDEBAR_MENU_WIDTH }} nativeID={'sidebar-spacer'} />}
            <View style={{ flex: 1 }}>
                <View nativeID={'header-slot'} style={{ zIndex: 10 }}>
                    <TopBarContainer />
                </View>
                {/* Stands in for MainViewsContainer's scrollable page content, which is
                    where the stacked chip lives. */}
                <View nativeID={'content-slot'} style={{ flex: 1 }}>
                    {belowHeader && <ConnectionStatusChip belowHeader />}
                </View>
            </View>
            {/* Off-layout probe: the chip's intrinsic width, so `run.js` can compare what
                the chip COSTS against the free space the header actually has. Absolutely
                positioned so it cannot influence the measurement it feeds. */}
            <View nativeID={'chip-probe'} style={{ position: 'absolute', top: -1000, left: 0 }}>
                <ConnectionStatusChip />
            </View>
        </View>
    )
}

// The harness has no backend and runs on the placeholder .env, so auth init fails with
// `auth/invalid-api-key`. Nothing measured here reads Firestore; swallow it so the page
// still boots. (Left in rather than dropped: several top-bar children reach for the
// firestore module on mount, and initialising it keeps those requires resolvable.)
try {
    initFirebase()
} catch (error) {
    console.warn('initFirebase skipped in harness:', error && error.message)
}

const flags = applyViewportFlags()
const root = createRoot(document.getElementById('root'))
root.render(
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

/**
 * Everything `run.js` asserts on. Deliberately measured from the live DOM rather than
 * derived from styles: the whole point is what the browser actually laid out.
 */
window.__measure = () => {
    const headerSlot = document.getElementById('header-slot')
    const contentSlot = document.getElementById('content-slot')
    const probeSlot = document.getElementById('chip-probe')
    if (!headerSlot || !contentSlot || !probeSlot) return null

    // header-slot > TopBarContainer's View > the header component's root.
    //
    // The two headers have DIFFERENT shapes and conflating them silently double-counts:
    // `TopBar`'s root IS the row ([leftArea, rightArea]), while `TopBarMobile`'s root is a
    // COLUMN of [row, collapsible secondary bar], each of them full width — summing those
    // two children reports ~2x the viewport as content and reads as a huge overflow.
    const headerRoot = headerSlot.firstElementChild && headerSlot.firstElementChild.firstElementChild
    if (!headerRoot) return null
    const isMobileHeader = store.getState().smallScreenNavigation
    const headerRow = isMobileHeader ? headerRoot.firstElementChild : headerRoot
    if (!headerRow) return null

    const chipIn = slot => slot.querySelector('[data-testid^="connection-status-chip-"]')
    const probeChip = chipIn(probeSlot)
    const headerChip = chipIn(headerSlot)
    const stackedChip = chipIn(contentSlot)

    const rowStyle = window.getComputedStyle(headerRow)
    const rowRect = headerRow.getBoundingClientRect()
    const contentBox = {
        left: rowRect.left + parseFloat(rowStyle.paddingLeft || 0),
        right: rowRect.right - parseFloat(rowStyle.paddingRight || 0),
    }

    const areas = Array.from(headerRow.children).map(child => rectOf(child))
    const areasWidth = areas.reduce((total, area) => total + area.width, 0)
    const contentWidth = contentBox.right - contentBox.left

    // The direct, visual test. The row is `justifyContent: 'space-between'` with nothing
    // shrinkable in it, so surplus content does not truncate — it pushes the LAST area
    // (search / chat / the notification bell) past the row's right padding edge. That
    // spill, in px, is what the user sees as "it doesn't fit".
    const lastArea = areas.length ? areas[areas.length - 1] : null
    const firstArea = areas.length ? areas[0] : null
    const spillRight = lastArea ? lastArea.right - contentBox.right : 0
    const spillLeft = firstArea ? contentBox.left - firstArea.left : 0

    return {
        viewportWidth: window.innerWidth,
        isMobileHeader,
        smallScreenNavigation: store.getState().smallScreenNavigation,
        isMiddleScreen: store.getState().isMiddleScreen,
        smallScreen: store.getState().smallScreen,
        headerRow: { ...rectOf(headerRow), contentLeft: contentBox.left, contentRight: contentBox.right },
        areas,
        areasWidth,
        contentWidth,
        // Slack left in the row AS LAID OUT — i.e. already accounting for the chip when
        // the chip is present. Negative means the row is over-subscribed.
        headerSlack: contentWidth - areasWidth,
        // What the chip costs when it is added to the row: its own pill plus the 16px
        // marginLeft separating it from NotificationArea. Measured off an off-layout
        // probe so it is available even when the chip is not in the header.
        chipCost: probeChip ? probeChip.getBoundingClientRect().width + 16 : null,
        chipInHeader: !!headerChip,
        chipBelowHeader: !!stackedChip,
        headerChipRect: rectOf(headerChip),
        stackedChipRect: rectOf(stackedChip),
        stackedLabel: stackedChip ? stackedChip.textContent : null,
        spillRight: Math.max(0, spillRight),
        spillLeft: Math.max(0, spillLeft),
        documentScrollWidth: document.documentElement.scrollWidth,
    }
}

window.__ready = true
