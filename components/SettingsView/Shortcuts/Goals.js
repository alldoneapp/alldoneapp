import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import CheatShortcutItem from '../../UIComponents/ShortcutCheatSheet/CheatShortcutItem'
import SectionInfo from '../../UIComponents/ShortcutCheatSheet/SectionInfo'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

export default function Goals() {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    return (
        <View style={localStyles.section}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Goals')}</Text>
            </View>

            <View style={{ flex: 1 }}>
                <CheatShortcutItem
                    shortcuts={[{ win: 'Alt + G', mac: '/= + G' }]}
                    description={translate('Toggles between Followed and All')}
                    style={{ marginTop: 0 }}
                />
            </View>

            <SectionInfo text={translate('The following shortcuts are available only when the goal is on edit mode')} />

            <View style={{ flexDirection: isMiddleScreen ? 'column' : 'row' }}>
                <View style={{ flex: 1, marginRight: isMiddleScreen ? 0 : 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + O', mac: '/= + O' }]}
                        description={translate('Opens the goal detailed view')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + A', mac: '/= + A' }]}
                        description={translate('Opens the pop-up to assign capacity planning')}
                    />
                </View>
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + P', mac: '/= + P' }]}
                        description={translate('Opens the pop-up to change the progress of the goal')}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        marginBottom: 24,
    },
    header: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'flex-end',
        flexDirection: 'row',
    },
})
