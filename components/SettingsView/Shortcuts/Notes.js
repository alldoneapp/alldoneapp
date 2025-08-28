import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import CheatShortcutItem from '../../UIComponents/ShortcutCheatSheet/CheatShortcutItem'
import SectionInfo from '../../UIComponents/ShortcutCheatSheet/SectionInfo'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

export default function Notes() {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    return (
        <View style={localStyles.section}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Notes')}</Text>
            </View>

            <SectionInfo
                text={translate(
                    'The following shortcuts are available only in the note list'
                )}
                style={{ marginTop: 0 }}
            />

            <View style={{ flexDirection: isMiddleScreen ? 'column' : 'row' }}>
                <View style={{ flex: 1, marginRight: isMiddleScreen ? 0 : 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + G', mac: '/= + G' }]}
                        description={translate('Toggles between Followed and All')}
                    />
                </View>
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + Y', mac: '/= + Y' }]}
                        description={translate('Opens the pop-up to make the note sticky')}
                    />
                </View>
            </View>

            <SectionInfo
                text={translate(
                    'The following shortcuts are available only when the note is on edit mode'
                )}
            />

            <View style={{ flexDirection: isMiddleScreen ? 'column' : 'row' }}>
                <View style={{ flex: 1, marginRight: isMiddleScreen ? 0 : 8 }}>
                    <CheatShortcutItem
                        shortcuts={[
                            { win: 'Ctrl + C', mac: '# + C' },
                            { win: 'Ctrl + V', mac: '# + V' },
                            { win: 'Ctrl + X', mac: '# + X' },
                        ]}
                        description={translate('Copy,paste and cut respectively')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Ctrl + Shift + V', mac: '# + Shift + V' }]}
                        description={translate('Paste without formatting')}
                    />
                    <CheatShortcutItem
                        shortcuts={[
                            { win: 'Ctrl + Z', mac: '# + Z' },
                            { win: 'Ctrl + Alt + Z', mac: '# + Alt + Z' },
                        ]}
                        description={translate('Undo, redo respectively')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Ctrl + A', mac: '# + A' }]}
                        description={translate('Selects all')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Ctrl + B', mac: '# + B' }]}
                        description={translate('Applies bold style')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Ctrl + I', mac: '# + I' }]}
                        description={translate('Applies italic style')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Ctrl + U', mac: '# + U' }]}
                        description={translate('Applies underline style')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Ctrl + K', mac: '# + K' }]}
                        description={translate('Inserts link')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + T', mac: '/= + T' }]}
                        description={translate('Adds a task within the note')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Ctrl + Spacebar', mac: '# + Spacebar' }]}
                        description={translate('Remove formatting to selected text')}
                    />
                </View>
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + I', mac: '/= + I' }]}
                        description={translate('Inserts an image within the note')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + Z', mac: '/= + Z' }]}
                        description={translate('Applies cross out text style')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 1', mac: '/= + 1' }]}
                        description={translate('Opens text predefined styles selector')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 2', mac: '/= + 2' }]}
                        description={translate('Opens text color predefined styles selector')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 3', mac: '/= + 3' }]}
                        description={translate('Opens text highlight color predefined styles selector')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 4', mac: '/= + 4' }]}
                        description={translate('Inserts a timestamp')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 5', mac: '/= + 5' }]}
                        description={translate('Applies numbered list style')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 6', mac: '/= + 6' }]}
                        description={translate('Applies bulleted list style')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 7', mac: '/= + 7' }]}
                        description={translate('Decreases indent')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 8', mac: '/= + 8' }]}
                        description={translate('Increases indent')}
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
