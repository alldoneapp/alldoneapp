import React, { Component } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors, hexColorToRGBa } from '../../styles/global'
import { DONE_STEP, OPEN_STEP } from '../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../i18n/TranslationService'
import { checkIsLimitedByXp } from '../../Premium/PremiumHelper'
import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'
import {
    moveTasksFromDone,
    moveTasksFromMiddleOfWorkflow,
    moveTasksFromOpen,
} from '../../../utils/backends/Tasks/tasksFirestore'

export default class StatusPickerStepItem extends Component {
    render() {
        const { step, open, done, stepNum, selected, active } = this.props
        const normal = open || done

        return (
            <TouchableOpacity
                style={[localStyles.container, active && localStyles.activeContainer]}
                onPress={this.onPressed}
            >
                <View style={localStyles.titleContainer}>
                    <View
                        style={[
                            !done ? localStyles.stepMarker : localStyles.doneStepMarker,

                            !done
                                ? {
                                      borderColor: selected ? colors.Primary100 : 'white',
                                      backgroundColor: selected ? colors.Primary100 : undefined,
                                  }
                                : undefined,
                        ]}
                    >
                        {!normal && <Text style={{ color: 'white' }}>{stepNum}</Text>}
                        {done && (
                            <Icon
                                name={'square-checked-gray'}
                                size={24}
                                color={selected ? colors.Primary100 : 'white'}
                            />
                        )}
                    </View>
                    <Text style={[styles.subtitle1, { color: 'white', marginLeft: 10 }]} numberOfLines={1}>
                        {open ? translate('Open') : done ? translate('Done') : step[1].description}
                    </Text>
                </View>
                {!(open || done) && (
                    <View style={localStyles.reviewerContainer}>
                        <Text style={localStyles.sentTo}>{translate('Sent to')}</Text>
                        <Image
                            style={[localStyles.userImage, selected ? localStyles.selected : undefined]}
                            source={{ uri: getUserPresentationData(step[1].reviewerUid).photoURL }}
                        />
                    </View>
                )}
            </TouchableOpacity>
        )
    }

    onPressed = () => {
        const { projectId, task, open, done, selected, step, hidePopover, onPress } = this.props
        if (!checkIsLimitedByXp(projectId)) {
            if (selected) {
                hidePopover()
                return
            }

            if (!done && task.done) {
                moveTasksFromDone(projectId, task, open ? OPEN_STEP : step[0])
            } else if (!open && task.userIds.length === 1) {
                moveTasksFromOpen(projectId, task, done ? DONE_STEP : step[0], null, null, task.estimations, '')
            } else {
                moveTasksFromMiddleOfWorkflow(
                    projectId,
                    task,
                    open ? OPEN_STEP : done ? DONE_STEP : step[0],
                    null,
                    null,
                    task.estimations,
                    ''
                )
            }

            onPress()
        }
        hidePopover()
    }
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    activeContainer: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
        marginHorizontal: -8,
        paddingHorizontal: 8,
    },
    titleContainer: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
    },
    reviewerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    stepMarker: {
        borderColor: 'white',
        borderRadius: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
        width: 20,
    },
    doneStepMarker: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
        width: 20,
    },
    sentTo: {
        ...styles.caption1,
        color: colors.Text03,
        marginHorizontal: 4,
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    selected: {
        borderColor: colors.Primary300,
        borderWidth: 2,
    },
})
