import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { OPEN_STEP } from '../../TaskListView/Utils/TasksHelper'
import { useSelector } from 'react-redux'
import Button from '../../UIControls/Button'
import SharedHelper from '../../../utils/SharedHelper'
import { translate } from '../../../i18n/TranslationService'
import { getEstimationIconByValue, getEstimationTagText } from '../../../utils/EstimationHelper'

export default function WorkflowOpen({
    isCurrentStep,
    onStepPress,
    currentEstimation,
    showModal,
    projectId,
    disabled,
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const loggedUser = useSelector(state => state.loggedUser)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    return (
        <View>
            <TouchableOpacity
                style={[
                    localStyles.openTaskContainer,
                    isCurrentStep ? { backgroundColor: colors.UtilityBlue100 } : undefined,
                ]}
                onPress={() => onStepPress(OPEN_STEP)}
                disabled={disabled}
            >
                <Icon name="square" size={24} color={colors.Gray400} />
                <View style={{ marginLeft: 8 }}>
                    <Text style={[styles.subtitle2, { color: colors.Text02 }]}>{translate('Open task')}</Text>
                </View>
                <View style={localStyles.buttons}>
                    <Button
                        title={!isMiddleScreen && translate(getEstimationTagText(projectId, currentEstimation))}
                        type={'ghost'}
                        icon={`count-circle-${getEstimationIconByValue(projectId, currentEstimation)}`}
                        onPress={showModal}
                        disabled={!accessGranted || disabled}
                        buttonStyle={isMiddleScreen && { paddingRight: 0 }}
                    />
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    openTaskContainer: {
        flexDirection: 'row',
        height: 56,
        alignItems: 'center',
        paddingLeft: 10,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
    },
    buttons: {
        marginLeft: 'auto',
        paddingRight: 8,
    },
})
