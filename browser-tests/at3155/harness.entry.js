/**
 * AT-3155 harness — the section icon before the section name in the "Anna on top" card.
 *
 * Renders the REAL `MainSectionTabsHeader` (sidebar mode 'sectionsTop') once per section, with a
 * stand-in for the Open / Workflow / Done toggle under it (the toggle itself is not part of this
 * change), in the requested colour mode and width, and reports the geometry of icon, name and arrow.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Text, View } from 'react-native'
import { Provider } from 'react-redux'
import { legacy_createStore as createStore } from 'redux'

import MainSectionTabsHeader from '../../components/TaskListView/Header/MainSectionTabsHeader'
import { colors } from '../../components/styles/global'
import { setLanguage } from '../../i18n/TranslationService'
import { setColorModePreference } from '../../Themes/colorMode'

export const SECTIONS = [
    'ROOT_TASKS',
    'ROOT_GOALS',
    'ROOT_NOTES',
    'ROOT_CONTACTS',
    'ROOT_CHATS',
    'ROOT_ARTIFACTS',
    'ROOT_WIKI',
]

const reducer = (state, action) => (action.type === 'SET' ? { ...state, ...action.payload } : state)

const ToggleStandIn = () => (
    <View
        style={{
            flexDirection: 'row',
            borderRadius: 18,
            paddingHorizontal: 12,
            height: 32,
            alignItems: 'center',
            backgroundColor: colors.Grey300,
        }}
    >
        <Text style={{ color: colors.Text02, fontFamily: 'Roboto-Regular' }}>Open 1 · 0 · 57</Text>
    </View>
)

let root = null

window.__render = ({ language, mode, viewportWidth, containerWidth }) =>
    new Promise(resolve => {
        setLanguage(language)
        setColorModePreference(mode)
        if (root) root.unmount()
        root = createRoot(document.getElementById('root'))
        root.render(
            <View style={{ backgroundColor: colors.Surface, padding: 16, width: containerWidth + 32 }}>
                {SECTIONS.map(section => (
                    <Provider
                        key={section}
                        store={createStore(reducer, {
                            selectedSidebarTab: section,
                            selectedProjectIndex: -1,
                            loggedUserProjects: [],
                            loggedUser: {
                                realProjectIds: [],
                                isAnonymous: false,
                                sidebarNavigationMode: 'sectionsTop',
                            },
                            screenDimensions: { width: viewportWidth },
                            smallScreenNavigation: viewportWidth < 768,
                        })}
                    >
                        <View style={{ width: containerWidth }} nativeID={`host-${section}`}>
                            <MainSectionTabsHeader
                                showSectionToggle={true}
                                renderSectionToggle={() => <ToggleStandIn />}
                            />
                        </View>
                    </Provider>
                ))}
            </View>
        )
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                const rect = node => node.getBoundingClientRect()
                resolve(
                    SECTIONS.map(section => {
                        const host = document.getElementById(`host-${section}`)
                        const title = host.querySelector('[data-testid="section-title"]')
                        const label = host.querySelector('[data-testid="section-title-label"]')
                        // The title holds [icon, label, arrow]; each Icon is a View around a glyph <div dir=auto>.
                        const glyphs = Array.from(title.children)
                            .filter(child => child !== label)
                            .map(child => child.querySelector('[dir="auto"]') || child)
                        const [iconRect, arrowRect] = glyphs.map(rect)
                        const labelRect = rect(label)
                        const cardRect = rect(host.firstElementChild.firstElementChild)
                        return {
                            section,
                            label: label.textContent,
                            iconColor: getComputedStyle(glyphs[0]).color,
                            labelColor: getComputedStyle(label).color,
                            truncated: label.scrollWidth > label.clientWidth + 0.5,
                            icon: {
                                left: iconRect.left,
                                right: iconRect.right,
                                cy: (iconRect.top + iconRect.bottom) / 2,
                                w: iconRect.width,
                                h: iconRect.height,
                            },
                            labelBox: {
                                left: labelRect.left,
                                right: labelRect.right,
                                cy: (labelRect.top + labelRect.bottom) / 2,
                            },
                            arrow: { left: arrowRect.left, cy: (arrowRect.top + arrowRect.bottom) / 2 },
                            card: { left: cardRect.left, right: cardRect.right },
                        }
                    })
                )
            })
        )
    })

Promise.all([
    document.fonts.load('16px Roboto-Medium'),
    document.fonts.load('15px Roboto-Regular'),
    document.fonts.load('20px alldone'),
]).then(() => {
    window.__ready = true
})
