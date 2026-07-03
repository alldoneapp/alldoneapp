import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import moment from 'moment'
import MilestoneItem from './MilestoneItem'
import styles, { colors } from '../../../styles/global'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Line from './Line'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'
import { cleanTextMetaData } from '../../../../functions/Utils/parseTextUtils'
import {
    MILESTONE_TYPE_FIXED,
    MILESTONE_TYPE_LINEAR,
    normalizeMilestoneType,
} from '../../../../utils/GoalMilestonesHelper'

const getDynamicShortcut = index => String.fromCharCode('E'.charCodeAt(0) + index)

export default function OptionsArea({
    updateMilestone,
    selectedDate,
    selectedMilestoneType = MILESTONE_TYPE_FIXED,
    milestones,
    dynamicMilestones = [],
    openCalendar,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const lastSelectedDueDate = useSelector(state => state.lastSelectedDueDate)

    const lastSelectedCustomDate =
        lastSelectedDueDate === BACKLOG_DATE_NUMERIC
            ? BACKLOG_DATE_NUMERIC
            : moment(lastSelectedDueDate).startOf('day').hour(12).minute(0).valueOf()
    const fixedMilestones = milestones.filter(
        milestone => normalizeMilestoneType(milestone.milestoneType) === MILESTONE_TYPE_FIXED
    )

    return (
        <View style={{ flex: 1 }}>
            <CustomScrollView showsVerticalScrollIndicator={false} indicatorStyle={{ right: -10 }}>
                {fixedMilestones.map((milestone, index) => {
                    const { date, extendedName, id } = milestone
                    const description = cleanTextMetaData(extendedName)
                    const isSelected = date === selectedDate && selectedMilestoneType === MILESTONE_TYPE_FIXED
                    return (
                        <MilestoneItem
                            key={id}
                            updateMilestone={date => updateMilestone(date, milestone)}
                            isSelected={isSelected}
                            milestoneDate={date}
                            description={description}
                            shortcutKey={`${index + 1}`}
                        />
                    )
                })}
                <Line />
                <MilestoneItem
                    updateMilestone={date => updateMilestone(date, { milestoneType: MILESTONE_TYPE_FIXED })}
                    isBacklog={true}
                    isSelected={BACKLOG_DATE_NUMERIC === selectedDate && selectedMilestoneType === MILESTONE_TYPE_FIXED}
                    milestoneDate={BACKLOG_DATE_NUMERIC}
                    description={translate('Someday')}
                    shortcutKey="0"
                />
                <Line />
                <Text style={localStyles.sectionLabel}>{translate('Dynamic')}</Text>
                {dynamicMilestones.map((milestone, index) => (
                    <MilestoneItem
                        key={milestone.periodKey}
                        updateMilestone={date => updateMilestone(date, milestone)}
                        isSelected={milestone.date === selectedDate && selectedMilestoneType === MILESTONE_TYPE_LINEAR}
                        milestoneDate={milestone.date}
                        description={milestone.extendedName}
                        shortcutKey={getDynamicShortcut(index)}
                    />
                ))}
            </CustomScrollView>
            <Line />
            <Text style={localStyles.sectionLabel}>{translate('Fixed')}</Text>
            <MilestoneItem
                updateMilestone={date => updateMilestone(date, { milestoneType: MILESTONE_TYPE_FIXED })}
                milestoneDate={lastSelectedCustomDate}
                description={translate('Last selected')}
                shortcutKey="C"
            />
            <TouchableOpacity style={localStyles.pickDate} onPress={openCalendar}>
                <Hotkeys keyName="D" onKeyDown={(sht, event) => openCalendar(event)} filter={e => true}>
                    <Text style={localStyles.pickDateText}>{translate('Custom date')}</Text>
                    <View>{!smallScreenNavigation && <Shortcut text="D" theme={SHORTCUT_LIGHT} />}</View>
                </Hotkeys>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    sectionLabel: {
        ...styles.subtitle2,
        color: colors.Text03,
        height: 32,
        paddingTop: 8,
    },
    pickDate: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    pickDateText: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
