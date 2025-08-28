import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

export default function EstimationModalBackButton({ closePopover }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <Hotkeys key={20} keyName={'B'} onKeyDown={() => closePopover()} filter={e => true}>
            <TouchableOpacity
                style={localStyles.backContainer}
                onPress={e => {
                    if (e) {
                        e.preventDefault()
                        e.stopPropagation()
                    }
                    closePopover()
                }}
            >
                <Icon name={'chevron-left'} size={24} color={colors.Text03} />
                <Text style={[styles.subtitle1, localStyles.backText]}>{translate('Back')}</Text>

                {!mobile && (
                    <View style={[localStyles.shortcut, { marginTop: 4 }]}>
                        <Shortcut text={'B'} theme={SHORTCUT_LIGHT} />
                    </View>
                )}
            </TouchableOpacity>
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    backContainer: {
        flexDirection: 'row',
        paddingVertical: 20,
        paddingHorizontal: 16,
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
    },
    backText: {
        color: '#FFFFFF',
        fontWeight: '500',
        marginLeft: 8,
    },
    shortcut: {
        position: 'absolute',
        right: 16,
    },
})
