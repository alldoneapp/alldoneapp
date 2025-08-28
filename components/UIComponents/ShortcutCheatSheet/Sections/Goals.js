import React from 'react'
import { View } from 'react-native'
import CheatShortcutItem from '../CheatShortcutItem'
import SectionInfo from '../SectionInfo'
import { translate } from '../../../../i18n/TranslationService'

export default function Goals() {
    return (
        <View>
            <View style={{ flex: 1 }}>
                <CheatShortcutItem
                    shortcuts={[{ win: 'Alt + G', mac: '/= + G' }]}
                    description={translate('Toggles between Followed and All')}
                />
            </View>

            <SectionInfo text={translate('The following shortcuts are available only when the goal is on edit mode')} />

            <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
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
