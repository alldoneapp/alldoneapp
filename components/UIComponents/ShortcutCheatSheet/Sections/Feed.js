import React from 'react'
import { View } from 'react-native'
import CheatShortcutItem from '../CheatShortcutItem'
import SectionInfo from '../SectionInfo'
import { translate } from '../../../../i18n/TranslationService'

export default function Feed() {
    return (
        <View>
            <View style={{ flex: 1 }}>
                <CheatShortcutItem
                    shortcuts={[{ win: 'Alt + G', mac: '/= + G' }]}
                    description={translate('Toggles between Followed and All')}
                />
            </View>

            <SectionInfo
                text={translate('The following shortcuts are available only when an object is in edit mode')}
            />

            <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
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
                text={translate('The following shortcuts are available only when an update is in edit mode')}
            />

            <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
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
