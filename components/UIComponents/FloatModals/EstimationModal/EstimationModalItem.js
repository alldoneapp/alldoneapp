import React from 'react'
import {
    ESTIMATION_OPTIONS_SHORTCUTS,
    getEstimationIconByValue,
    getEstimationText,
} from '../../../../utils/EstimationHelper'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

export default function EstimationModalItem({ projectId, item, isSelected, onPress, disabled }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    const estimationTexts = getEstimationText(projectId)

    return (
        <Hotkeys
            key={item}
            keyName={ESTIMATION_OPTIONS_SHORTCUTS[item]}
            onKeyDown={(sht, e) => onPress(e)}
            filter={e => true}
        >
            <TouchableOpacity
                style={localStyles.pointSectionItem}
                disabled={disabled}
                onPress={onPress}
                accessible={false}
            >
                <View style={localStyles.pointSectionItem}>
                    <View style={localStyles.sectionItemText}>
                        {isSelected ? (
                            <View style={localStyles.icon}>
                                <Icon
                                    name={`count-${getEstimationIconByValue(projectId, item)}`}
                                    size={24}
                                    color={'#ffffff'}
                                />
                            </View>
                        ) : (
                            <Icon
                                name={`count-circle-${getEstimationIconByValue(projectId, item)}`}
                                size={24}
                                color={colors.Text03}
                            />
                        )}

                        <Text style={[styles.subtitle1, { color: '#ffffff', marginLeft: 9 }]}>
                            {translate(estimationTexts[item])}
                        </Text>
                    </View>
                    <View style={localStyles.sectionItemCheck}>
                        {isSelected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                        {!mobile && (
                            <Shortcut
                                text={ESTIMATION_OPTIONS_SHORTCUTS[item]}
                                theme={SHORTCUT_LIGHT}
                                containerStyle={{ marginLeft: 4 }}
                            />
                        )}
                    </View>
                </View>
            </TouchableOpacity>
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    pointSectionItem: {
        flex: 1,
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
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
})
