import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import HeaderTab from '../AssigneeAndObserversModal/Header/HeaderTab'
import { translate } from '../../../../i18n/TranslationService'

export const TEAM_MEMBERS_TAB = 0
export const OTHER_CONTACTS_TAB = 1

export default function TabsHeader({ setActiveTab, activeTab, usersAmount, contactsAmount }) {
    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Tab') {
            setActiveTab(activeTab === TEAM_MEMBERS_TAB ? OTHER_CONTACTS_TAB : TEAM_MEMBERS_TAB)
        }
    }

    const activeTeamMembersTab = () => {
        setActiveTab(TEAM_MEMBERS_TAB)
    }

    const activeOtherContactsTab = () => {
        setActiveTab(OTHER_CONTACTS_TAB)
    }

    return (
        <View style={localStyles.container}>
            <HeaderTab
                text={translate('Team members')}
                onPress={activeTeamMembersTab}
                isActive={activeTab === TEAM_MEMBERS_TAB}
                isNextShortcutTab={activeTab === OTHER_CONTACTS_TAB}
                badgeValue={usersAmount}
            />
            <HeaderTab
                text={translate('Other contacts')}
                onPress={activeOtherContactsTab}
                isActive={activeTab === OTHER_CONTACTS_TAB}
                isNextShortcutTab={activeTab === TEAM_MEMBERS_TAB}
                badgeValue={contactsAmount}
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
    },
})
