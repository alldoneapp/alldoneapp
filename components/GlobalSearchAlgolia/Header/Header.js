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
import { GLOBAL_SEARCH_ARTIFACTS_TAB, GLOBAL_SEARCH_WIKI_TAB } from '../searchIndexes'

// The order the tabs are SHOWN in, which is not the order of their numbers: the numbers are
// shared with the @-mention picker (tabs 0-4) and the two global-search-only tabs were appended
// as 5 and 6. Artifacts sits before Chats (AT-2905), matching the main navigation, where
// Artifacts took the Chats slot. The Tab key, its shortcut hint and the "jump to the first tab
// with results" fallback all walk this list, never `activeTab + 1`.
export const GLOBAL_SEARCH_TAB_ORDER = [
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_CONTACTS_TAB,
    GLOBAL_SEARCH_ARTIFACTS_TAB,
    MENTION_MODAL_TOPICS_TAB,
    GLOBAL_SEARCH_WIKI_TAB,
]

export const getNextGlobalSearchTab = activeTab => {
    const index = GLOBAL_SEARCH_TAB_ORDER.indexOf(activeTab)
    return GLOBAL_SEARCH_TAB_ORDER[(index + 1) % GLOBAL_SEARCH_TAB_ORDER.length]
}

const TAB_LABELS = {
    [MENTION_MODAL_TASKS_TAB]: 'Tasks',
    [MENTION_MODAL_GOALS_TAB]: 'Goals',
    [MENTION_MODAL_NOTES_TAB]: 'Notes',
    [MENTION_MODAL_CONTACTS_TAB]: 'Contacts',
    [GLOBAL_SEARCH_ARTIFACTS_TAB]: 'Artifacts',
    [MENTION_MODAL_TOPICS_TAB]: 'Chats',
    [GLOBAL_SEARCH_WIKI_TAB]: 'Wiki',
}

export default function Header({
    activeTab,
    setActiveTab,
    tasksResultAmount,
    goalsResultAmount,
    contactsResultAmount,
    notesResultAmount,
    chatsResultAmount,
    artifactsResultAmount = 0,
    wikiResultAmount = 0,
    showShortcuts,
    mobile,
    compact,
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
            changeTab(getNextGlobalSearchTab(activeTab))
        }
    }

    const badgeValues = {
        [MENTION_MODAL_TASKS_TAB]: tasksResultAmount,
        [MENTION_MODAL_GOALS_TAB]: goalsResultAmount,
        [MENTION_MODAL_NOTES_TAB]: notesResultAmount,
        [MENTION_MODAL_CONTACTS_TAB]: contactsResultAmount,
        [GLOBAL_SEARCH_ARTIFACTS_TAB]: artifactsResultAmount,
        [MENTION_MODAL_TOPICS_TAB]: chatsResultAmount,
        [GLOBAL_SEARCH_WIKI_TAB]: wikiResultAmount,
    }
    const nextShortcutTab = getNextGlobalSearchTab(activeTab)

    return (
        <View
            testID="global-search-tabs"
            style={[
                localStyles.container,
                mobile && localStyles.mobileContainer,
                compact && localStyles.compactContainer,
            ]}
        >
            {GLOBAL_SEARCH_TAB_ORDER.map(tab => (
                <HeaderTab
                    key={tab}
                    text={TAB_LABELS[tab]}
                    onPress={() => changeTab(tab)}
                    isActive={activeTab === tab}
                    isNextShortcutTab={tab === nextShortcutTab}
                    badgeValue={badgeValues[tab]}
                    showShortcuts={showShortcuts}
                    mobile={mobile}
                />
            ))}
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
    mobileContainer: {
        marginTop: 16,
        marginBottom: 4,
        paddingHorizontal: 8,
    },
    compactContainer: {
        marginTop: 8,
        marginBottom: 0,
    },
})
