import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { OPEN_STEP } from '../../../TaskListView/Utils/TasksHelper'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { translate } from '../../../../i18n/TranslationService'
import { getEstimationIconByValue } from '../../../../utils/EstimationHelper'

export default function EstimationOption({ projectId, openEstimationModal, estimations }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return (
        <View style={localStyles.container}>
            <Hotkeys keyName={'2'} onKeyDown={openEstimationModal} filter={e => true}>
                <TouchableOpacity style={localStyles.button} onPress={openEstimationModal}>
                    <Icon
                        name={`count-circle-${getEstimationIconByValue(projectId, estimations[OPEN_STEP])}`}
                        size={24}
                        color="white"
                    />
                    <Text style={localStyles.text}>{translate('Change estimation')}</Text>
                    <View style={{ marginLeft: 'auto' }}>
                        {smallScreenNavigation ? (
                            <Icon name={'chevron-right'} size={24} color={colors.Text03} />
                        ) : (
                            <Shortcut text={'2'} theme={SHORTCUT_LIGHT} />
                        )}
                    </View>
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    button: {
        height: 40,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle1,
        color: 'white',
        marginLeft: 8,
    },
})
