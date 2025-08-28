import React from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import styles, { colors } from '../../../styles/global'
import Hotkeys from 'react-hot-keys'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import { getDoneTimeValue, TIME_MAX_TO_HOURS } from '../../../../utils/EstimationHelper'

export default function CustomEstimationItem({ isSelected, estimation, openCustomForm, disabled }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <Hotkeys key={'custom-estimation'} keyName={'8'} onKeyDown={(sht, e) => openCustomForm(e)} filter={e => true}>
            <TouchableOpacity onPress={openCustomForm} accessible={false} disabled={disabled}>
                <View style={localStyles.container}>
                    <View style={localStyles.pointSectionItem}>
                        <View style={localStyles.sectionItemText}>
                            {isSelected ? (
                                <View style={localStyles.icon}>
                                    <Icon name={`count-c`} size={24} color={'#ffffff'} />
                                </View>
                            ) : (
                                <Icon name={`count-circle-c`} size={24} color={colors.Text03} />
                            )}

                            <Text style={[styles.subtitle1, { color: '#ffffff', marginLeft: 9 }]}>
                                {translate('Custom')}
                                {isSelected && (
                                    <Text style={localStyles.customValue}>{` • ${getDoneTimeValue(
                                        estimation,
                                        TIME_MAX_TO_HOURS
                                    )}`}</Text>
                                )}
                            </Text>
                        </View>
                        <View style={localStyles.sectionItemCheck}>
                            {isSelected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                            {!mobile && (
                                <Shortcut text={'8'} theme={SHORTCUT_LIGHT} containerStyle={{ marginLeft: 4 }} />
                            )}
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'column',
        alignItems: 'stretch',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
    },
    pointSectionItem: {
        flex: 1,
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionItemText: {
        alignItems: 'center',
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    icon: {
        margin: 0.6,
        width: 22,
        height: 22,
        borderRadius: 1000,
        borderWidth: 2,
        borderColor: colors.Primary200,
        backgroundColor: colors.Primary300,
        justifyContent: 'center',
        alignItems: 'center',
    },
    customValue: {
        ...styles.subtitle1,
        color: colors.Text03,
    },
})
