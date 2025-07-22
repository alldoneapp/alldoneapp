import React from 'react'
import { StyleSheet, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import { useSelector } from 'react-redux'
import { translate } from '../../../../i18n/TranslationService'

export default function Buttons({ moveNextOrSelectedStep, stopObserving, isNonTeamMember, isAssistant }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return isNonTeamMember || isAssistant ? (
        <View style={localStyles.container}>
            <Hotkeys keyName={'alt+x'} onKeyDown={stopObserving} filter={e => true}>
                <Button
                    title={translate('Stop observing')}
                    type={'secondary'}
                    onPress={stopObserving}
                    shortcutText={'X'}
                    shortcutStyle={localStyles.shortcut}
                    buttonStyle={{ marginRight: 8 }}
                />
            </Hotkeys>
            <Button
                icon={smallScreenNavigation ? null : 'next-workflow'}
                title={translate('Mark as done')}
                type={'primary'}
                onPress={moveNextOrSelectedStep}
                shortcutText={'Enter'}
                shortcutStyle={localStyles.shortcut}
            />
        </View>
    ) : (
        <View style={localStyles.container}>
            <Hotkeys keyName={'alt+x'} onKeyDown={moveNextOrSelectedStep} filter={e => true}>
                <Button
                    icon={smallScreenNavigation ? null : 'next-workflow'}
                    title={translate('Go to next step')}
                    type={'secondary'}
                    onPress={moveNextOrSelectedStep}
                    shortcutText={'X'}
                    shortcutStyle={localStyles.shortcut}
                    buttonStyle={{ marginRight: 8 }}
                />
            </Hotkeys>
            <Button
                title={translate('Stop observing')}
                type={'primary'}
                onPress={stopObserving}
                shortcutText={'Enter'}
                shortcutStyle={localStyles.shortcut}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
        paddingBottom: 16,
    },
    shortcut: {
        backgroundColor: colors.Secondary200,
    },
})
