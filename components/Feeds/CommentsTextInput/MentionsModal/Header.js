import React from 'react'
import { StyleSheet, View } from 'react-native'

import HeaderTab from './HeaderTab'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
    MENTION_MODAL_GOALS_TAB,
} from '../textInputHelper'

export default function Header({
    activeTab,
    changeTab,
    showHints,
    tasksAmount,
    goalsAmount,
    notesAmount,
    contactsAmount,
    chatsAmount,
}) {
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
                text="Tasks"
                onPress={activeTasksTab}
                isActive={activeTab === MENTION_MODAL_TASKS_TAB}
                isNextShortcutTab={showHints && activeTab === MENTION_MODAL_TOPICS_TAB}
                badgeValue={tasksAmount}
            />
            <HeaderTab
                text="Goals"
                onPress={activeGoalsTab}
                isActive={activeTab === MENTION_MODAL_GOALS_TAB}
                isNextShortcutTab={showHints && activeTab === MENTION_MODAL_TASKS_TAB}
                badgeValue={goalsAmount}
            />
            <HeaderTab
                text="Notes"
                onPress={activeNotesTab}
                isActive={activeTab === MENTION_MODAL_NOTES_TAB}
                isNextShortcutTab={showHints && activeTab === MENTION_MODAL_GOALS_TAB}
                badgeValue={notesAmount}
            />
            <HeaderTab
                text="Contacts"
                onPress={activeContactsTab}
                isActive={activeTab === MENTION_MODAL_CONTACTS_TAB}
                isNextShortcutTab={showHints && activeTab === MENTION_MODAL_NOTES_TAB}
                badgeValue={contactsAmount}
            />
            <HeaderTab
                text="Chats"
                onPress={activeTopicsTab}
                isActive={activeTab === MENTION_MODAL_TOPICS_TAB}
                isNextShortcutTab={showHints && activeTab === MENTION_MODAL_CONTACTS_TAB}
                badgeValue={chatsAmount}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
})
