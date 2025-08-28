import React from 'react'
import { StyleSheet, View } from 'react-native'

import HeaderTab from '../../../Feeds/CommentsTextInput/MentionsModal/HeaderTab'
import { translate } from '../../../../i18n/TranslationService'

export default function Header({ activeTabIndex, changeTab, tabs }) {
    return (
        <View style={localStyles.container}>
            {tabs.map((tab, index) => {
                const previousIndex = index === 0 ? tabs.length - 1 : index - 1
                const isNextShortcutTab = previousIndex === activeTabIndex
                return (
                    <HeaderTab
                        text={translate(tab.name)}
                        onPress={() => {
                            changeTab(index)
                        }}
                        isActive={activeTabIndex === index}
                        isNextShortcutTab={isNextShortcutTab}
                    />
                )
            })}
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
