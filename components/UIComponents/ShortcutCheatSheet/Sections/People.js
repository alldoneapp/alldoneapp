import React from 'react'
import { View } from 'react-native'
import CheatShortcutItem from '../CheatShortcutItem'
import SectionInfo from '../SectionInfo'
import { translate } from '../../../../i18n/TranslationService'

export default function People() {
    return (
        <View>
            <View style={{ flex: 1 }}>
                <CheatShortcutItem
                    shortcuts={[{ win: 'Alt + G', mac: '/= + G' }]}
                    description={translate('Toggles between Followed and All')}
                />
            </View>

            <SectionInfo
                text={translate('The following shortcuts are available only when the new person is on edit mode')}
            />

            <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + I', mac: '/= + 1' }]}
                        description={translate('Opens the pop-up to enter the person information')}
                    />
                </View>
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <CheatShortcutItem
                        shortcuts={[{ win: 'Alt + 1', mac: '/= + I' }]}
                        description={translate('Opens the pop-up to upload the person avatar')}
                    />
                </View>
            </View>
        </View>
    )
}
