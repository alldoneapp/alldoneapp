import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import CheatShortcutItem from '../../UIComponents/ShortcutCheatSheet/CheatShortcutItem'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

export default function General() {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    return (
        <View style={localStyles.section}>
            <View style={localStyles.header}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('General shortcuts')}</Text>
            </View>

            <View style={{ flexDirection: isMiddleScreen ? 'column' : 'row' }}>
                <View style={{ flex: 1, marginRight: isMiddleScreen ? 0 : 8 }}>
                    <CheatShortcutItem
                        shortcuts={[
                            { win: 'Alt + ?', mac: '/= + ?' },
                            { win: 'Alt + Shift + ?', mac: '/= + Shift + /' },
                        ]}
                        description={translate('Shows the keyboard shortcuts cheat sheet')}
                        style={{ marginTop: 0 }}
                    />
                    <CheatShortcutItem shortcuts={[{ win: 'Tab' }]} description={translate('Toggles any tab bar')} />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + F', mac: '/= + F' }]}
                        description={translate('Sets focus to the search field')}
                    />
                    <CheatShortcutItem
                        shortcuts={[
                            { win: 'Alt + K', mac: '/= + K' },
                            { win: 'Alt + Shift + F', mac: '/= + Shift + F' },
                        ]}
                        description={translate('Opens the Global Search pop-up')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: '+' }]}
                        description={translate('Opens the Add new item in any focused list view')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + H', mac: '/= + H' }]}
                        description={translate('Toggles highlighted-normal states')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + P', mac: '/= + P' }]}
                        description={translate('Toggles public-private privacy')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + C', mac: '/= + C' }]}
                        description={translate('Opens comment pop-up')}
                    />
                </View>
                <View style={{ flex: 1 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + M', mac: '/= + M' }]}
                        description={translate('Opens pop-up to create a Google Meet room')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + O', mac: '/= + O' }]}
                        description={translate('Opens detailed view')}
                    />
                    <CheatShortcutItem
                        shortcuts={[
                            { win: 'Alt + ^|', mac: '/= + ^|' },
                            { win: 'Alt + |-', mac: '/= + |-' },
                        ]}
                        description={translate('Goes up and goes down respectively')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + Shift + 0', mac: '/= + Shift + 0' }]}
                        description={translate('Focus to sidebar with All projects section selected')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + Shift + 1 /_ to /_ 9', mac: '/= + Shift + 1 /_ to /_ 9' }]}
                        description={translate('Select projects in sidebar respectively')}
                    />
                    {/*<CheatShortcutItem
                        shortcuts={[{ win: '<|' }]}
                        description={translate('Focus to projects sidebar on the left')}
                    />*/}
                    {/*<CheatShortcutItem
                        shortcuts={[{ win: '|>' }]}
                        description={translate('Focus to elements on the right excluding the sidebar')}
                    />*/}
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Esc' }]}
                        description={translate('Closes/Cancel any pop-up/dialog window')}
                    />
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Enter' }]}
                        description={translate('Activates primary button in any pop-up/dialog window')}
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
