import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { getEstimationIconByValue } from '../../utils/EstimationHelper'
import { translate } from '../../i18n/TranslationService'
import Avatar from '../Avatar'
import OptionShortcutCaption from './OptionShortcutCaption'
import { getUserPresentationData } from '../ContactsView/Utils/ContactsHelper'
import { chronoEntriesOrder } from '../../utils/HelperFunctions'

export default function ChangeReviewerEstimation({
    estimations,
    task,
    projectId,
    openReviewerEstimationModal,
    steps,
    currentStep,
}) {
    const shortcutText = '2'

    const { stepHistory } = task
    const currentEstimation = estimations[stepHistory[stepHistory.length - 1]] || 0
    const icon = `count-circle-${getEstimationIconByValue(projectId, currentEstimation)}`
    const currentStepPhotoURL = getUserPresentationData(
        Object.entries(steps).sort(chronoEntriesOrder)[currentStep][1].reviewerUid
    ).photoURL

    return (
        <View style={localStyles.estimationContainer}>
            <Hotkeys keyName={shortcutText} onKeyDown={openReviewerEstimationModal} filter={e => true}>
                <TouchableOpacity style={localStyles.estimation} onPress={openReviewerEstimationModal}>
                    <Icon name={icon} size={24} color="white" />
                    <Text style={localStyles.uploadText}>{translate('Change step estimation')}</Text>
                    <Avatar
                        reviewerPhotoURL={currentStepPhotoURL}
                        externalStyle={localStyles.userImage}
                        borderSize={0}
                        size={24}
                    />
                    <OptionShortcutCaption text={shortcutText} />
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    estimationContainer: {
        borderTopColor: colors.funnyWhite,
        borderTopWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    uploadText: {
        ...styles.subtitle1,
        color: 'white',
        marginLeft: 8,
    },
    estimation: {
        height: 40,
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
    },
    userImage: {
        marginLeft: 8,
        backgroundColor: undefined,
    },
})
