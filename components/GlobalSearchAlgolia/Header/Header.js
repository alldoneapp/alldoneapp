import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import HeaderTab from './HeaderTab'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
} from '../../Feeds/CommentsTextInput/textInputHelper'

export default function Header({
    activeTab,
    setActiveTab,
    tasksResultAmount,
    goalsResultAmount,
    contactsResultAmount,
    notesResultAmount,
    chatsResultAmount,
    showShortcuts,
}) {
    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const changeTab = tab => {
        if (activeTab !== tab) {
            setActiveTab(tab)
        }
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Tab') {
            if (activeTab === MENTION_MODAL_TOPICS_TAB) {
                changeTab(MENTION_MODAL_TASKS_TAB)
            } else {
                changeTab(activeTab + 1)
            }
        }
    }

    const activeTasksTab = () => {
        changeTab(MENTION_MODAL_TASKS_TAB)
    }
    const activeNotesTab = () => {
        changeTab(MENTION_MODAL_NOTES_TAB)
    }
    const activeGoalsTab = () => {
        changeTab(MENTION_MODAL_GOALS_TAB)
    }
    const activeContactsTab = () => {
        changeTab(MENTION_MODAL_CONTACTS_TAB)
    }
    const activeTopicsTab = () => {
        changeTab(MENTION_MODAL_TOPICS_TAB)
    }

    return (
        <View style={localStyles.container}>
            <HeaderTab
                text={'Tasks'}
                onPress={activeTasksTab}
                isActive={activeTab === MENTION_MODAL_TASKS_TAB}
                isNextShortcutTab={activeTab === MENTION_MODAL_TOPICS_TAB}
                badgeValue={tasksResultAmount}
                showShortcuts={showShortcuts}
            />
            <HeaderTab
                text={'Goals'}
                onPress={activeGoalsTab}
                isActive={activeTab === MENTION_MODAL_GOALS_TAB}
                isNextShortcutTab={activeTab === MENTION_MODAL_TASKS_TAB}
                badgeValue={goalsResultAmount}
                showShortcuts={showShortcuts}
            />
            <HeaderTab
                text={'Notes'}
                onPress={activeNotesTab}
                isActive={activeTab === MENTION_MODAL_NOTES_TAB}
                isNextShortcutTab={activeTab === MENTION_MODAL_GOALS_TAB}
                badgeValue={notesResultAmount}
                showShortcuts={showShortcuts}
            />
            <HeaderTab
                text={'Contacts'}
                onPress={activeContactsTab}
                isActive={activeTab === MENTION_MODAL_CONTACTS_TAB}
                isNextShortcutTab={activeTab === MENTION_MODAL_NOTES_TAB}
                badgeValue={contactsResultAmount}
                showShortcuts={showShortcuts}
            />
            <HeaderTab
                text={'Chats'}
                onPress={activeTopicsTab}
                isActive={activeTab === MENTION_MODAL_TOPICS_TAB}
                isNextShortcutTab={activeTab === MENTION_MODAL_CONTACTS_TAB}
                badgeValue={chatsResultAmount}
                showShortcuts={showShortcuts}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 8,
        paddingHorizontal: 16,
    },
})
