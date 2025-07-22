import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import moment from 'moment'
import MilestoneItem from './MilestoneItem'
import styles from '../../../styles/global'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Line from './Line'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'
import { cleanTextMetaData } from '../../../../functions/Utils/parseTextUtils'

export default function OptionsArea({ updateMilestone, selectedDate, milestones, openCalendar }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const lastSelectedDueDate = useSelector(state => state.lastSelectedDueDate)

    const lastSelectedCustomDate =
        lastSelectedDueDate === BACKLOG_DATE_NUMERIC
            ? BACKLOG_DATE_NUMERIC
            : moment(lastSelectedDueDate).startOf('day').hour(12).minute(0).valueOf()

    return (
        <View style={{ flex: 1 }}>
            <CustomScrollView showsVerticalScrollIndicator={false} indicatorStyle={{ right: -10 }}>
                {milestones.map((milestone, index) => {
                    const { date, extendedName, id } = milestone
                    const description = cleanTextMetaData(extendedName)
                    const isSelected = date === selectedDate
                    return (
                        <MilestoneItem
                            key={id}
                            updateMilestone={updateMilestone}
                            isSelected={isSelected}
                            milestoneDate={date}
                            description={description}
                            shortcutKey={`${index + 1}`}
                        />
                    )
                })}
            </CustomScrollView>
            <Line />
            <MilestoneItem
                updateMilestone={updateMilestone}
                isBacklog={true}
                isSelected={BACKLOG_DATE_NUMERIC === selectedDate}
                milestoneDate={BACKLOG_DATE_NUMERIC}
                description={translate('Someday')}
                shortcutKey="0"
            />
            <Line />
            <MilestoneItem
                updateMilestone={updateMilestone}
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
