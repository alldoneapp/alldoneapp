import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import ModalHeader from '../ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { colors } from '../../../styles/global'
import DueDateCalendarModal from '../DueDateCalendarModal/DueDateCalendarModal'
import useWindowSize from '../../../../utils/useWindowSize'
import BackButton from './BackButton'
import Backend from '../../../../utils/BackendBridge'
import { GOALS_OPEN_TAB_INDEX } from '../../../GoalsView/GoalsHelper'
import OptionsArea from './OptionsArea'
import { translate } from '../../../../i18n/TranslationService'
import { DEFAULT_WORKSTREAM_ID } from '../../../Workstreams/WorkstreamHelper'

export default function GoalMilestoneModal({
    projectId,
    closeModal,
    updateMilestone,
    milestoneDate,
    openOrganizationModal,
    setModalWidth,
    setModalHeight,
    ownerId,
}) {
    const [width, height] = useWindowSize()
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const [showCalendar, setShowCalendar] = useState(false)
    const [milestones, setMilestones] = useState([])

    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 548 ? tmpHeight : 548

    const openCalendar = event => {
        event.preventDefault()
        event.stopPropagation()
        setShowCalendar(true)
    }

    const closeCalendar = () => {
        setShowCalendar(false)
    }

    const updateMilestones = (projectId, milestones) => {
        setMilestones(milestones)
    }

    const onLayout = event => {
        const { width, height } = event.nativeEvent.layout
        setModalWidth(width)
        setModalHeight(height)
    }

    useEffect(() => {
        const watcherKey = v4()
        Backend.watchMilestones(
            projectId,
            updateMilestones,
            goalsActiveTab !== GOALS_OPEN_TAB_INDEX,
            watcherKey,
            ownerId
        )
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [])

    return (
        <View
            onLayout={setModalWidth && setModalHeight ? onLayout : null}
            style={[localStyles.container, applyPopoverWidth(), { maxHeight: finalHeight }]}
        >
            <ModalHeader
                closeModal={closeModal}
                title={translate('Select reminder')}
                description={translate('Select the date to postpone the milestone')}
            />
            {showCalendar ? (
                <View>
                    <DueDateCalendarModal
                        closePopover={closeModal}
                        initialDate={milestoneDate}
                        externalStyle={{ marginHorizontal: -16 }}
                        updateGoalMilestone={updateMilestone}
                    />
                    <BackButton onPress={closeCalendar} />
                </View>
            ) : (
                <View style={{ flex: 1 }}>
                    <OptionsArea
                        updateMilestone={updateMilestone}
                        selectedDate={milestoneDate}
                        milestones={milestones}
                        openCalendar={openCalendar}
                        projectId={projectId}
                    />
                    <BackButton onPress={openOrganizationModal} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        padding: 16,
        paddingBottom: 8,
    },
})
