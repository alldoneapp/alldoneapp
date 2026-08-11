import React from 'react'
import { StyleSheet, View } from 'react-native'
import HeaderTab from '../../../Feeds/CommentsTextInput/MentionsModal/HeaderTab'
import { translate } from '../../../../i18n/TranslationService'

export const PROJECT_MODAL_ACTIVE_TAB = 0
export const PROJECT_MODAL_GUIDE_TAB = 1
export const PROJECT_MODAL_ARCHIVED_TAB = 2

export default function Header({ activeTab, changeTab, hideGuideTab, hideArchiveTab }) {
    const setActiveTab = () => {
        changeTab(PROJECT_MODAL_ACTIVE_TAB)
    }
    const setGuideTab = () => {
        changeTab(PROJECT_MODAL_GUIDE_TAB)
    }
    const setArchivedTab = () => {
        changeTab(PROJECT_MODAL_ARCHIVED_TAB)
    }

    return (
        <View style={localStyles.container}>
            <HeaderTab
                text={translate('Active')}
                onPress={setActiveTab}
                isActive={activeTab === PROJECT_MODAL_ACTIVE_TAB}
                isNextShortcutTab={activeTab === PROJECT_MODAL_GUIDE_TAB}
            />
            {!hideGuideTab && (
                <HeaderTab
                    text={translate('Community')}
                    onPress={setGuideTab}
                    isActive={activeTab === PROJECT_MODAL_GUIDE_TAB}
                    isNextShortcutTab={activeTab === PROJECT_MODAL_ARCHIVED_TAB}
                />
            )}
            {!hideArchiveTab && (
                <HeaderTab
                    text={translate('Archived')}
                    onPress={setArchivedTab}
                    isActive={activeTab === PROJECT_MODAL_ARCHIVED_TAB}
                    isNextShortcutTab={activeTab === PROJECT_MODAL_ACTIVE_TAB}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
})
