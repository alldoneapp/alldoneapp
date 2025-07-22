import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { translate } from '../../../../i18n/TranslationService'

export default function CustomDate({ setVisibleCalendar }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const calendarShortcut = event => {
        event.preventDefault()
        event.stopPropagation()
        setVisibleCalendar(true)
    }

    return (
        <TouchableOpacity style={localStyles.dateSectionItem} onPress={calendarShortcut} accessible={false}>
            <Hotkeys key={9} keyName={'D'} onKeyDown={(sht, event) => calendarShortcut(event)} filter={e => true}>
                <View style={localStyles.dateSectionItem}>
                    <View style={localStyles.sectionItemText}>
                        <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{translate('Custom date')}</Text>
                    </View>
                    <View
                        style={[
                            localStyles.navigateIndicator,
                            localStyles.sectionItemCheck,
                            !smallScreenNavigation && { marginTop: -4 },
                        ]}
                    >
                        <Text style={[styles.body1, { color: colors.Text03 }]}>
                            {!smallScreenNavigation ? (
                                <Shortcut text={'D'} theme={SHORTCUT_LIGHT} />
                            ) : (
                                <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                            )}
                        </Text>
                    </View>
                </View>
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    dateSectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        justifyContent: 'flex-end',
    },
    navigateIndicator: {
        marginTop: 4,
    },
})
