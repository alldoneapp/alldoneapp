import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import HeaderTab from '../AssigneeAndObserversModal/Header/HeaderTab'

export const ASSIGNEE_TAB = 1
export const OBSERVERS_TAB = 0

export default function TabsList({ setActiveTab, activeTab }) {
    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Tab') {
            setActiveTab(activeTab === ASSIGNEE_TAB ? OBSERVERS_TAB : ASSIGNEE_TAB)
        }
    }

    const activeAssigneeTab = e => {
        setActiveTab(ASSIGNEE_TAB)
    }

    const activeObserversTab = e => {
        setActiveTab(OBSERVERS_TAB)
    }

    return (
        <View style={localStyles.container}>
            <HeaderTab
                text={'Observers'}
                onPress={activeObserversTab}
                isActive={activeTab === OBSERVERS_TAB}
                isNextShortcutTab={activeTab === ASSIGNEE_TAB}
            />
            <HeaderTab
                text={'Assignee'}
                onPress={activeAssigneeTab}
                isActive={activeTab === ASSIGNEE_TAB}
                isNextShortcutTab={activeTab === OBSERVERS_TAB}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        marginBottom: 16,
    },
})
