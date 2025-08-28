import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import HeaderTab from '../AssigneeAndObserversModal/Header/HeaderTab'
import { translate } from '../../../../i18n/TranslationService'

export const COMPLETION_TAB = 1
export const STARTING_TAB = 0

export default function TabsList({ setActiveTab, activeTab, tabStyle }) {
    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Tab') {
            setActiveTab(activeTab === COMPLETION_TAB ? STARTING_TAB : COMPLETION_TAB)
        }
    }

    const activeStartingTab = e => {
        setActiveTab(STARTING_TAB)
    }

    const activeCompletionTab = e => {
        setActiveTab(COMPLETION_TAB)
    }

    return (
        <View style={localStyles.container}>
            <HeaderTab
                text={translate('Starting')}
                onPress={activeStartingTab}
                isActive={activeTab === STARTING_TAB}
                isNextShortcutTab={activeTab === COMPLETION_TAB}
                containerStyle={tabStyle}
            />
            <HeaderTab
                text={translate('Completion')}
                onPress={activeCompletionTab}
                isActive={activeTab === COMPLETION_TAB}
                isNextShortcutTab={activeTab === STARTING_TAB}
                containerStyle={tabStyle}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 16,
    },
})
