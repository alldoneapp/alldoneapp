import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'
import v4 from 'uuid/v4'

import ModalHeader from '../ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import { colors } from '../../../styles/global'
import DueDateCalendarModal from '../DueDateCalendarModal/DueDateCalendarModal'
import useWindowSize from '../../../../utils/useWindowSize'
import BackButton from '../GoalMilestoneModal/BackButton'
import Backend from '../../../../utils/BackendBridge'
import { GOALS_OPEN_TAB_INDEX } from '../../../GoalsView/GoalsHelper'
import TabsList, { COMPLETION_TAB, STARTING_TAB } from './TabsList'
import OptionsArea from '../GoalMilestoneModal/OptionsArea'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function GoalMilestoneRangeModal({
    projectId,
    closeModal,
    updateMilestoneDateRange,
    startingMilestoneDate,
    completionMilestoneDate,
    setModalWidth,
    setModalHeight,
    ownerId,
}) {
    const [width, height] = useWindowSize()
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const [showCalendar, setShowCalendar] = useState(false)
    const [activeTab, setActiveTab] = useState(COMPLETION_TAB)
    const [milestones, setMilestones] = useState([])

    const tmpHeight = height - MODAL_MAX_HEIGHT_GAP
    const finalHeight = tmpHeight < 597 ? tmpHeight : 597

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

    const updateMilestone = date => {
        updateMilestoneDateRange(date, activeTab === STARTING_TAB ? 'startingMilestoneDate' : 'completionMilestoneDate')
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

    const milestoneDate = activeTab === STARTING_TAB ? startingMilestoneDate : completionMilestoneDate

    return (
        <View
            onLayout={setModalWidth && setModalHeight ? onLayout : null}
            style={[localStyles.container, applyPopoverWidth(), { maxHeight: finalHeight }]}
        >
            <ModalHeader
                closeModal={closeModal}
                title={translate('Select Milestones of Goal')}
                description={translate('Select when the goal should be completed and when it started')}
            />

            <TabsList tabStyle={{ width: '50%' }} setActiveTab={setActiveTab} activeTab={activeTab} />

            {showCalendar ? (
                <View>
                    <DueDateCalendarModal
                        closePopover={closeModal}
                        initialDate={
                            milestoneDate === BACKLOG_DATE_NUMERIC
                                ? moment().startOf('day').hour(12).minute(0)
                                : milestoneDate
                        }
                        externalStyle={{ marginHorizontal: -16 }}
                        updateGoalMilestone={updateMilestone}
                    />
                    <BackButton onPress={closeCalendar} />
                </View>
            ) : (
                <OptionsArea
                    updateMilestone={updateMilestone}
                    selectedDate={milestoneDate}
                    milestones={milestones}
                    openCalendar={openCalendar}
                />
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
