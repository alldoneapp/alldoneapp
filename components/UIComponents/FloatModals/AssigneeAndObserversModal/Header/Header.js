import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import HeaderTab from './HeaderTab'
import { translate } from '../../../../../i18n/TranslationService'

export const ASSIGNEE_TAB = 0
export const OBSERVERS_TAB = 1

export default function Header({ setTab, filterText = '', assigneesList = [], observersList = [], hideAssigneeTab }) {
    const [activeTab, setActiveTab] = useState(hideAssigneeTab ? OBSERVERS_TAB : ASSIGNEE_TAB)

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const changeTab = tab => {
        if (activeTab !== tab) {
            setActiveTab(tab)
            setTab?.(tab)
        }
    }

    const onKeyDown = event => {
        const { key } = event

        if (key === 'Tab' && !hideAssigneeTab) {
            changeTab(activeTab === ASSIGNEE_TAB ? OBSERVERS_TAB : ASSIGNEE_TAB)
        }
    }

    const activeAssigneeTab = e => {
        e?.preventDefault()
        e?.stopPropagation()
        changeTab(ASSIGNEE_TAB)
    }

    const activeObserversTab = e => {
        e?.preventDefault()
        e?.stopPropagation()
        changeTab(OBSERVERS_TAB)
    }

    return (
        <View style={localStyles.container}>
            {!hideAssigneeTab && (
                <HeaderTab
                    text={translate('Assignee')}
                    onPress={activeAssigneeTab}
                    isActive={activeTab === ASSIGNEE_TAB}
                    isNextShortcutTab={activeTab === OBSERVERS_TAB}
                    badgeValue={filterText === '' ? 0 : assigneesList.length}
                />
            )}
            <HeaderTab
                text={translate('Observers')}
                onPress={activeObserversTab}
                isActive={activeTab === OBSERVERS_TAB}
                isNextShortcutTab={activeTab === ASSIGNEE_TAB}
                badgeValue={filterText === '' ? 0 : observersList.length}
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
