/**
 * AT-3123 harness — is the section name with its arrow centred in the mobile card?
 *
 * Renders the REAL `MainSectionTabsHeader` in the "Anna on top" sidebar mode (the card shows the
 * section's name with a picker arrow instead of the tabs) and reports where the name, its arrow and
 * the toggle sit inside the light-blue card. jsdom has no layout, so the jest suite can only pin
 * the styles; this measures the rendered boxes.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Text, View } from 'react-native'
import { Provider } from 'react-redux'
import { legacy_createStore as createStore } from 'redux'

import MainSectionTabsHeader from '../../components/TaskListView/Header/MainSectionTabsHeader'
import { setLanguage } from '../../i18n/TranslationService'

const reducer = (state, action) => (action.type === 'SET' ? { ...state, ...action.payload } : state)

let root = null

const box = (node, hostRect) => {
    const rect = node.getBoundingClientRect()
    return { left: rect.left - hostRect.left, right: rect.right - hostRect.left, width: rect.width }
}

window.__measure = ({ language, viewportWidth, containerWidth, sectionTab }) =>
    new Promise(resolve => {
        setLanguage(language)
        const store = createStore(reducer, {
            selectedSidebarTab: sectionTab,
            selectedProjectIndex: -1,
            loggedUserProjects: [],
            loggedUser: { realProjectIds: [], isAnonymous: false, sidebarNavigationMode: 'sectionsTop' },
            screenDimensions: { width: viewportWidth },
            smallScreenNavigation: viewportWidth < 818,
        })
        if (root) root.unmount()
        root = createRoot(document.getElementById('root'))
        root.render(
            <Provider store={store}>
                <View style={{ width: containerWidth }} nativeID="host">
                    <MainSectionTabsHeader
                        showSectionToggle={true}
                        renderSectionToggle={() => (
                            <View nativeID="toggle" style={{ width: 200, height: 32 }}>
                                <Text>toggle</Text>
                            </View>
                        )}
                    />
                </View>
            </Provider>
        )
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                const host = document.getElementById('host')
                const hostRect = host.getBoundingClientRect()
                const title = host.querySelector('[data-testid="section-title"]')
                const card = title.parentElement
                const label = Array.from(title.querySelectorAll('[dir="auto"]')).find(node => node.textContent.trim())
                const arrow = title.lastElementChild
                const toggle = document.getElementById('toggle')
                resolve({
                    text: label.textContent,
                    truncated: label.scrollWidth > label.clientWidth + 0.5,
                    card: box(card, hostRect),
                    title: box(title, hostRect),
                    label: box(label, hostRect),
                    arrow: box(arrow, hostRect),
                    toggle: toggle && box(toggle, hostRect),
                    cardPadding: parseFloat(getComputedStyle(card).paddingLeft),
                    cardBorder: parseFloat(getComputedStyle(card).borderLeftWidth),
                })
            })
        )
    })

Promise.all([document.fonts.load('16px Roboto-Medium'), document.fonts.load('16px Roboto-Regular')]).then(() => {
    window.__ready = true
})
