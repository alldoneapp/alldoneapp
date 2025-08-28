import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import UserTag from '../Tags/UserTag'
import moment from 'moment'
import Spinner from '../UIComponents/Spinner'
import { useSelector } from 'react-redux'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../i18n/TranslationService'
import { getUserPresentationData } from '../ContactsView/Utils/ContactsHelper'

const WorkflowStep = ({ step, stepNumber, updatingStep }) => {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const addedByData = getUserPresentationData(step.addedById)
    const reviewerData = getUserPresentationData(step.reviewerUid)
    const info = isMiddleScreen
        ? translate('User added on Date', {
              user: addedByData.shortName,
              date: moment(step.date).format(getDateFormat()),
          })
        : translate('Step added by User, Date', {
              user: addedByData.displayName,
              date: moment(step.date).format(getDateFormat()),
          })

    return (
        <View style={localStyles.container}>
            <View style={localStyles.stepNumberContainer}>
                <Text style={[styles.subtitle1, { color: 'white' }]}>{stepNumber}</Text>
            </View>

            <View style={localStyles.description}>
                <Text style={[styles.body1, { color: colors.Text01 }]}>{step.description}</Text>
                <Text style={[styles.caption2, { color: colors.Text03 }]}>{info}</Text>
            </View>

            <View style={localStyles.sendToContainer}>
                {!isMiddleScreen && (
                    <Text style={[styles.body2, { color: colors.Text02 }]}>{`${translate('Send to')}:`}</Text>
                )}
                <View style={!isMiddleScreen && { marginLeft: 12 }}>
                    {!updatingStep ? (
                        <UserTag
                            user={{
                                displayName: reviewerData.displayName,
                                photoURL: getUserPresentationData(step.reviewerUid).photoURL,
                            }}
                            onlyPhoto={isMiddleScreen}
                        />
                    ) : (
                        <Spinner containerSize={24} spinnerSize={16} />
                    )}
                </View>
            </View>
        </View>
    )
}

export default WorkflowStep

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        height: 64,
        alignItems: 'center',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.UtilityBlue150,
        paddingLeft: 5,
        paddingRight: 8,
        marginBottom: 16,
    },
    stepNumberContainer: {
        backgroundColor: colors.UtilityBlue200,
        borderRadius: 2,
        width: 28,
        height: 54,
        alignItems: 'center',
        justifyContent: 'center',
    },
    description: {
        flexDirection: 'column',
        marginLeft: 7,
    },
    sendToContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 'auto',
        height: 24,
        borderLeftWidth: 1,
        borderLeftColor: colors.Grey200,
        paddingLeft: 12,
    },
})
