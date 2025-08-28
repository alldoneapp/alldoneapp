import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors, hexColorToRGBa } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import { getUserPresentationData } from '../ContactsView/Utils/ContactsHelper'

export default function WorkflowStepItem({
    step,
    open,
    done,
    estimations,
    assignee,
    selectStep,
    selectedNextStep,
    stepIndex,
    currentStep,
    active = false,
}) {
    const middleStep = !open && !done
    const isSelected = selectedNextStep === stepIndex
    const isDisabled = currentStep === stepIndex
    const estimationIcons = [
        { key: 0, value: 'count-circle-0' },
        { key: 1, value: 'count-circle-1' },
        { key: 2, value: 'count-circle-2' },
        { key: 3, value: 'count-circle-3' },
        { key: 5, value: 'count-circle-5' },
        { key: 8, value: 'count-circle-8' },
        { key: 13, value: 'count-circle-13' },
        { key: 21, value: 'count-circle-21' },
    ]

    let stepIco = ''
    let photoUrl = ''

    const getEstimationIco = estimation => {
        for (let i = 0; i < estimationIcons.length; i++) {
            if (estimation == null) {
                return estimationIcons[0].value
            } else if (estimationIcons[i].key === estimation) {
                return estimationIcons[i].value
            }
        }
    }

    if (done) {
        stepIco = 'square-checked-gray'
    } else if (open) {
        stepIco = getEstimationIco(estimations[OPEN_STEP])
        photoUrl = assignee.photoURL
    } else {
        stepIco = getEstimationIco(estimations[step[0]])
        photoUrl = getUserPresentationData(step[1].reviewerUid).photoURL
    }

    const selectThisStep = () => {
        selectStep(stepIndex)
    }

    return (
        <TouchableOpacity
            style={[localStyles.container, active && !isDisabled && localStyles.activeContainer]}
            onPress={selectThisStep}
            disabled={isDisabled}
        >
            <View style={localStyles.titleContainer}>
                <Icon
                    name={stepIco}
                    size={23}
                    color={isSelected ? colors.Primary100 : isDisabled ? colors.Text03 : 'white'}
                />
                <Text
                    style={[
                        styles.subtitle1,
                        { marginLeft: 10 },
                        { color: isSelected ? colors.Primary100 : isDisabled ? colors.Text03 : 'white' },
                    ]}
                >
                    {open ? translate('Open') : done ? translate('Done') : step[1].description}
                </Text>
            </View>

            {photoUrl !== '' ? (
                <View style={localStyles.reviewerContainer}>
                    {middleStep ? (
                        <Text style={[styles.caption1, localStyles.sentText]}>{translate('Sent to')}</Text>
                    ) : null}
                    <Image
                        style={[
                            localStyles.userImage,
                            isSelected ? { borderWidth: 2, borderColor: colors.Primary100 } : null,
                        ]}
                        source={{ uri: photoUrl }}
                    />
                </View>
            ) : null}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
        justifyContent: 'space-between',
        paddingVertical: 8,
    },
    activeContainer: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
        marginHorizontal: -8,
        paddingHorizontal: 8,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    reviewerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    sentText: {
        color: colors.Text03,
        fontWeight: '500',
        marginRight: 4,
    },
})
