import React, { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import EstimationModal from '../UIComponents/FloatModals/EstimationModal/EstimationModal'
import { translate } from '../../i18n/TranslationService'
import { getEstimationIconByValue, getEstimationTagText } from '../../utils/EstimationHelper'
import {
    setTaskAutoEstimation,
    setTaskEstimations,
    setTaskObserverEstimations,
} from '../../utils/backends/Tasks/tasksFirestore'
import { getTaskAutoEstimation } from '../TaskListView/Utils/TasksHelper'

const TaskEstimation = ({
    projectId,
    task,
    currentEstimation,
    style,
    photoUrl,
    stepId,
    outline,
    isMobile,
    disabled,
    subscribeClickObserver,
    unsubscribeClickObserver,
    observerId,
    isActiveOrganizeMode,
}) => {
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [visiblePopover, setVisiblePopover] = useState(false)

    const openModal = () => {
        setVisiblePopover(true)
    }

    const closeModal = () => {
        setVisiblePopover(false)
    }

    const setTaskEstimation = estimation => {
        if (observerId) {
            setTaskObserverEstimations(projectId, task.id, currentEstimation, estimation, observerId)
        } else {
            setTaskEstimations(projectId, task.id, task, stepId, estimation)
        }

        closeModal()
    }

    const setAutoEstimation = autoEstimation => {
        setTaskAutoEstimation(projectId, task, autoEstimation)
    }

    useEffect(() => {
        unsubscribeClickObserver?.()
        return () => subscribeClickObserver?.()
    }, [])

    return (
        <Popover
            content={
                <EstimationModal
                    projectId={projectId}
                    estimation={currentEstimation}
                    closePopover={closeModal}
                    setEstimationFn={setTaskEstimation}
                    autoEstimation={getTaskAutoEstimation(projectId, currentEstimation, task?.autoEstimation)}
                    setAutoEstimation={setAutoEstimation}
                    showAutoEstimation={task ? !task.isSubtask : false}
                    disabled={disabled || !!task.calendarData}
                />
            }
            onClickOutside={closeModal}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <TouchableOpacity onPress={openModal} disabled={isActiveOrganizeMode}>
                <View style={[(outline ? otl : localStyles).container, style]}>
                    {!outline && photoUrl && <Image style={localStyles.userImage} source={{ uri: photoUrl }} />}
                    <Icon
                        name={`count-circle-${getEstimationIconByValue(projectId, currentEstimation)}`}
                        size={outline ? 14 : 16}
                        color={outline ? colors.UtilityBlue200 : colors.Text03}
                        style={(outline ? otl : localStyles).icon}
                    />
                    {!smallScreenNavigation && !isMobile && (
                        <Text
                            style={[
                                styles.subtitle2,
                                !smallScreenNavigation && !isMobile && localStyles.text,
                                windowTagStyle(),
                            ]}
                        >
                            {translate(getEstimationTagText(projectId, currentEstimation))}
                        </Text>
                    )}
                </View>
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
    userImage: {
        height: 16,
        width: 16,
        borderRadius: 100,
        marginLeft: 4,
    },
})

const otl = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderRadius: 50,
        borderWidth: 1,
        borderColor: colors.UtilityBlue200,
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
        width: 20,
    },
    icon: {
        marginHorizontal: 3,
    },
})

export default TaskEstimation
