import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import UserTag from '../../Tags/UserTag'
import moment from 'moment'
import { useSelector } from 'react-redux'
import Button from '../../UIControls/Button'
import SharedHelper from '../../../utils/SharedHelper'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../../i18n/TranslationService'
import { getEstimationIconByValue, getEstimationTagText } from '../../../utils/EstimationHelper'
import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'

export default function WorkflowStep({
    onPress,
    showModal,
    currentEstimation,
    isCurrentStep,
    stepNumber,
    step,
    projectId,
    disabled,
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const loggedUser = useSelector(state => state.loggedUser)
    const { description, reviewerUid, addedById, date, id } = step
    const reviewerData = getUserPresentationData(reviewerUid)
    const addedByData = getUserPresentationData(addedById)
    const info = isMiddleScreen
        ? translate('User added on Date', {
              user: addedByData.shortName,
              date: moment(date).format(getDateFormat()),
          })
        : translate('Step added by User, Date', {
              user: addedByData.displayName,
              date: moment(date).format(getDateFormat()),
          })
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    return (
        <TouchableOpacity
            style={[localStyles.container, isCurrentStep ? { backgroundColor: colors.UtilityBlue100 } : undefined]}
            onPress={() => onPress(id)}
            disabled={disabled}
        >
            <View style={localStyles.stepNumberContainer}>
                <Text style={[styles.subtitle1, { color: 'white' }]}>{stepNumber}</Text>
            </View>

            <View style={localStyles.description}>
                <Text numberOfLines={1} style={[styles.body1, { color: colors.Text02 }]}>
                    {description}
                </Text>
                <Text numberOfLines={1} style={[styles.caption2, { color: colors.Text03 }]}>
                    {info}
                </Text>
            </View>

            <View style={localStyles.rightSection}>
                <View style={localStyles.sendToContainer}>
                    {!isMiddleScreen && (
                        <Text style={[styles.body2, { color: colors.Text02 }]}>{translate('Send to')}:</Text>
                    )}
                    <View style={!isMiddleScreen && { marginLeft: 12 }}>
                        <UserTag
                            user={{ displayName: reviewerData.displayName, photoURL: reviewerData.photoURL }}
                            onlyPhoto={isMiddleScreen}
                        />
                    </View>
                </View>

                <View style={{ marginLeft: 12 }}>
                    <Button
                        title={!isMiddleScreen && translate(getEstimationTagText(projectId, currentEstimation))}
                        type={'ghost'}
                        icon={`count-circle-${getEstimationIconByValue(projectId, currentEstimation)}`}
                        onPress={showModal}
                        disabled={!accessGranted || disabled}
                        buttonStyle={isMiddleScreen && { paddingRight: 0 }}
                    />
                </View>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        height: 64,
        alignItems: 'center',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
        paddingLeft: 5,
        paddingRight: 8,
        marginBottom: 16,
    },
    stepNumberContainer: {
        backgroundColor: colors.Gray400,
        borderRadius: 2,
        width: 28,
        height: 54,
        alignItems: 'center',
        justifyContent: 'center',
    },
    description: {
        flex: 1,
        flexDirection: 'column',
        marginLeft: 7,
    },
    sendToContainer: {
        flexDirection: 'row',
        height: 24,
        borderLeftWidth: 1,
        borderLeftColor: colors.Grey200,
        paddingLeft: 12,
    },
    rightSection: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
})
