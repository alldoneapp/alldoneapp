import React from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, View, Text } from 'react-native'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import { setAssistantLikeDefault } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { GLOBAL_PROJECT_ID } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function DefaultProperty({ disabled, assistant, projectId }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)

    const { isDefault } = assistant

    const setLikeDefault = () => {
        setAssistantLikeDefault(projectId, assistant.uid)
    }

    return (
        <View style={localStyles.container}>
            <Icon name="hexagon" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Default')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Hotkeys
                    keyName={'alt+A'}
                    disabled={blockShortcuts || disabled || isDefault}
                    onKeyDown={(sht, event) => execShortcutFn(this.btnRef, setLikeDefault, event)}
                    filter={e => true}
                >
                    <Button
                        ref={ref => (this.btnRef = ref)}
                        type={'ghost'}
                        icon={'edit'}
                        onPress={setLikeDefault}
                        disabled={disabled || isDefault}
                        shortcutText={'A'}
                        title={isDefault ? 'Default' : 'Non default'}
                    />
                </Hotkeys>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    button: {
        marginHorizontal: 0,
    },
})
