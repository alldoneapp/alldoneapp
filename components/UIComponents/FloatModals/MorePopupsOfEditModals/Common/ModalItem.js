import React from 'react'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import { TouchableOpacity } from 'react-native-gesture-handler'
import { StyleSheet, Text, View } from 'react-native'
import styles from '../../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../../UIControls/Shortcut'
import Icon from '../../../../Icon'
import { translate } from '../../../../../i18n/TranslationService'

export default function ModalItem({ icon, text, notTranslatedText, shortcut, onPress }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <View>
            <Hotkeys keyName={shortcut} onKeyDown={(sht, event) => onPress(event)} filter={e => true}>
                <TouchableOpacity style={localStyles.sectionItem} onPress={onPress} accessible={false}>
                    <View style={localStyles.sectionItem}>
                        <View style={localStyles.sectionItemText}>
                            <Icon name={icon} size={24} color={'#ffffff'} style={localStyles.icon} />
                            <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                                {notTranslatedText || translate(text)}
                            </Text>
                        </View>
                        <View style={localStyles.sectionItemShortcut}>
                            {!mobile && <Shortcut text={shortcut} theme={SHORTCUT_LIGHT} />}
                        </View>
                    </View>
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    sectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    icon: {
        marginRight: 8,
    },
    sectionItemShortcut: {
        justifyContent: 'flex-end',
    },
})
