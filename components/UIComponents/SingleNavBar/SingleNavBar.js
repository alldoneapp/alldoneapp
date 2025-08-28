import React, { useEffect, useRef } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import SingleNavBarItem from './SingleNavBarItem'
import { colors } from '../../styles/global'

export const SINGLE_NAV_BAR_LIGHT = 'SINGLE_NAV_BAR_LIGHT'
export const SINGLE_NAV_BAR_DARK = 'SINGLE_NAV_BAR_DARK'

export default function SingleNavBar({ tabs, theme = SINGLE_NAV_BAR_DARK, onSelectTab, style }) {
    const selectedTab = useRef(tabs[0])

    const themeStyle = () => {
        if (theme === SINGLE_NAV_BAR_LIGHT) {
            return localStyles.containerLight
        } else {
            return localStyles.containerDark
        }
    }

    const selectTab = tab => {
        selectedTab.current = tab
        if (onSelectTab) {
            onSelectTab(tab)
        }
    }

    const onTabSwitch = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }

        if (e.key === 'Tab') {
            const index = tabs.indexOf(selectedTab.current)
            if (index === tabs.length - 1) {
                selectTab(tabs[0])
            } else {
                selectTab(tabs[index + 1])
            }
        }
    }

    useEffect(() => {
        document.addEventListener('keyup', onTabSwitch)
        return () => document.removeEventListener('keyup', onTabSwitch)
    }, [])

    return (
        <View onLayout={this.onLayoutChange} style={[localStyles.container, themeStyle(), style]}>
            <ScrollView
                style={{ flex: 1 }}
                horizontal={true}
                showsHorizontalScrollIndicator={false}
                overScrollMode={'never'}
                contentContainerStyle={[localStyles.itemsContainer]}
            >
                {tabs.map((tabItem, i) => (
                    <View key={i}>
                        <SingleNavBarItem
                            text={tabItem}
                            selected={selectedTab.current === tabItem}
                            theme={theme}
                            onSelect={() => selectTab(tabItem)}
                            isNextShortcutTab={
                                (i === 0 && selectedTab.current === tabs[tabs.length - 1]) ||
                                selectedTab.current === tabs[i - 1]
                            }
                        >
                            {tabItem}
                        </SingleNavBarItem>
                    </View>
                ))}
            </ScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        height: 56,
        alignItems: 'flex-end',
        overflow: 'hidden',
    },
    containerLight: {
        backgroundColor: colors.Secondary400,
        borderBottomColor: colors.Grey400,
    },
    containerDark: {
        backgroundColor: 'white',
        borderBottomColor: colors.Primary400,
    },
    itemsContainer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
})
