/**
 * Section tabs browser harness — do the five root tab labels fit on a phone?
 *
 * Renders the REAL `MainSectionTabsHeader` against a react-redux store at the two widths the app
 * gives it on a 320px phone: 272px inside a project (16px view margin + 8px navigation padding a
 * side) and 288px in All projects. jsdom computes no text metrics, so the jest suite can pin the
 * styles but never whether a label is cut off; that is what this measures.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { View } from 'react-native'
import { Provider } from 'react-redux'
import { legacy_createStore as createStore } from 'redux'

import MainSectionTabsHeader from '../../components/TaskListView/Header/MainSectionTabsHeader'
import { setLanguage } from '../../i18n/TranslationService'

const reducer = (state, action) => (action.type === 'SET' ? { ...state, ...action.payload } : state)

const baseState = {
    selectedSidebarTab: 'Tasks',
    selectedProjectIndex: -1,
    loggedUserProjects: [],
    loggedUser: { realProjectIds: [], isAnonymous: false },
}

let root = null

// Renders one header and reports, per tab, whether its label is truncated.
window.__measure = ({ language, viewportWidth, containerWidth }) =>
    new Promise(resolve => {
        setLanguage(language)
        const store = createStore(reducer, { ...baseState, screenDimensions: { width: viewportWidth } })
        if (root) root.unmount()
        root = createRoot(document.getElementById('root'))
        root.render(
            <Provider store={store}>
                <View style={{ width: containerWidth }} nativeID="tabs-host">
                    <MainSectionTabsHeader />
                </View>
            </Provider>
        )
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                const host = document.getElementById('tabs-host')
                const labels = Array.from(host.querySelectorAll('[dir="auto"]')).filter(node => node.textContent.trim())
                const hostRect = host.getBoundingClientRect()
                resolve({
                    labels: labels.map(node => {
                        const rect = node.getBoundingClientRect()
                        return {
                            text: node.textContent,
                            fontSize: parseFloat(getComputedStyle(node).fontSize),
                            truncated: node.scrollWidth > node.clientWidth + 0.5,
                            left: rect.left - hostRect.left,
                            right: rect.right - hostRect.left,
                        }
                    }),
                    hostWidth: hostRect.width,
                    scrolls: !!host.querySelector('[class*="ScrollView"], [data-testid="scroll"]'),
                })
            })
        )
    })

// A label measured in a fallback font measures a different row, so wait for the real faces.
Promise.all([document.fonts.load('15px Roboto-Medium'), document.fonts.load('15px Roboto-Regular')]).then(() => {
    window.__ready = true
})
