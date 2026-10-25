/**
 * AT-2594 browser harness: render the real global-search modal so its bottom
 * sheet, flex layout and React Native Web measurements can be verified in
 * Chromium. Jest cannot catch the clipping/unused-height regressions here.
 */
import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import { showGlobalSearchPopup, toggleSmallScreenNavigation } from '../../redux/actions'
import { installEscapeStack } from '../../utils/escapeStack'
import { setLanguage } from '../../i18n/TranslationService'
import GlobalSearchModal from '../../components/GlobalSearchAlgolia/GlobalSearchModal'

initFirebase()
installEscapeStack()

const ACTIVE_PROJECT_ID = 'project-active'
const ARCHIVED_PROJECT_ID = 'project-archived'
const UID = 'user-1'
const user = {
    uid: UID,
    displayName: 'Mobile Search Tester',
    email: 'mobile-search@example.com',
    photoURL: '',
    photoURL300: '',
    defaultProjectId: ACTIVE_PROJECT_ID,
    activeProjects: [ACTIVE_PROJECT_ID],
    inactiveProjects: [ARCHIVED_PROJECT_ID],
    projectIds: [ACTIVE_PROJECT_ID],
    archivedProjectIds: [ARCHIVED_PROJECT_ID],
    realProjectIds: [ACTIVE_PROJECT_ID],
    realArchivedProjectIds: [ARCHIVED_PROJECT_ID],
    realGuideProjectIds: [],
    realTemplateProjectIds: [],
    isAnonymous: false,
    premium: { status: 'FREE' },
    workstreams: {},
}

store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: {
        id: ACTIVE_PROJECT_ID,
        name: 'Active project',
        color: '#0D55CF',
        isShared: false,
        parentTemplateId: null,
    },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})

const searchParams = new URLSearchParams(window.location.search)
const mobile = searchParams.get('mobile') === '1'
setLanguage(searchParams.get('language') || 'en')
store.dispatch(toggleSmallScreenNavigation(mobile))

const rect = element => {
    if (!element) return null
    const { left, right, top, bottom, width, height } = element.getBoundingClientRect()
    return { left, right, top, bottom, width, height }
}

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <GlobalSearchModal />
    </Provider>
)

store.dispatch(showGlobalSearchPopup(false))

window.__measureSearchLayout = () => {
    const popup = document.querySelector('[data-testid="global-search-popup"]')
    const sheet = document.querySelector('[data-testid="bottom-sheet"]')
    const filters = document.querySelector('[data-testid="global-search-filters"]')
    const results = document.querySelector('[data-testid="global-search-results"]')
    const tabs = document.querySelector('[data-testid="global-search-tabs"]')
    const input = document.querySelector('input[placeholder="Search term..."]')
    if (!popup || !filters || !results || !tabs || !input) return null

    const tabLabels = Array.from(tabs.querySelectorAll('[dir="auto"]')).map(rect)
    const filterChips = Array.from(
        filters.querySelectorAll(
            '[data-testid="search-filter-scope"], [data-testid="search-filter-created-by-me"], [data-testid="search-filter-archived"], [data-testid="search-filter-open-tasks"]'
        )
    ).map(element => ({
        ...rect(element),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
    }))
    const filterRowTops = filterChips.reduce((tops, chip) => {
        if (!tops.some(top => Math.abs(top - chip.top) <= 1)) tops.push(chip.top)
        return tops
    }, [])
    return {
        popup: rect(popup),
        sheet: rect(sheet),
        filters: rect(filters),
        results: rect(results),
        tabs: rect(tabs),
        input: rect(input),
        tabLabels,
        filterChips,
        filterRowCount: filterRowTops.length,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
    }
}

window.__ready = true
