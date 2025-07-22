import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import CheatShortcutItem from '../../UIComponents/ShortcutCheatSheet/CheatShortcutItem'
import SectionInfo from '../../UIComponents/ShortcutCheatSheet/SectionInfo'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

export default function Feed() {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    return (
        <View style={localStyles.section}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Updates')}</Text>
            </View>

            <View style={{ flex: 1 }}>
                <CheatShortcutItem
                    shortcuts={[{ win: 'Alt + G', mac: '/= + G' }]}
                    description={translate('Toggles between Followed and All')}
                    style={{ marginTop: 0 }}
                />
            </View>

            <SectionInfo
                text={translate(
                    'The following shortcuts are available only when an object is in edit mode'
                )}
            />

            <View style={{ flexDirection: isMiddleScreen ? 'column' : 'row' }}>
                <View style={{ flex: 1, marginRight: isMiddleScreen ? 0 : 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + O', mac: '/= + O' }]}
                        description={translate('Opens the object detailed view')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + T', mac: '/= + T' }]}
                        description={translate('Opens a pop-up for adding a linked task to the object')}
                    />
                </View>
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + W', mac: '/= + W' }]}
                        description={translate('Toggles the object between Followed and Not Followed')}
                    />
                </View>
            </View>

            <SectionInfo
                text={translate(
                    'The following shortcuts are available only when an update is in edit mode'
                )}
            />

            <View style={{ flexDirection: isMiddleScreen ? 'column' : 'row' }}>
                <View style={{ flex: 1, marginRight: isMiddleScreen ? 0 : 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + U', mac: '/= + U' }]}
                        description={translate('Attach a file to the update')}
                    />
                </View>
                <View style={{ flex: 1, paddingRight: 8 }} />
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
