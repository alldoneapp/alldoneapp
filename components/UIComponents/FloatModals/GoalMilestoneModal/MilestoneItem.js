import moment from 'moment'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../../i18n/TranslationService'
import { setLastSelectedDueDate } from '../../../../redux/actions'

export default function MilestoneItem({ updateMilestone, isSelected, milestoneDate, description, shortcutKey }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const textDate =
        milestoneDate === BACKLOG_DATE_NUMERIC ? translate('Someday') : moment(milestoneDate).format('D MMM')

    const selectMilestone = () => {
        dispatch(setLastSelectedDueDate(milestoneDate))
        updateMilestone(milestoneDate)
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={selectMilestone}>
            <Hotkeys
                keyName={shortcutKey}
                disabled={!isNaN(shortcutKey) && parseInt(shortcutKey) > 10}
                onKeyDown={selectMilestone}
                filter={e => true}
            >
                <View style={localStyles.containerOption}>
                    <Text style={localStyles.description} numberOfLines={1}>
                        {description}
                    </Text>
                    {textDate !== '' && (
                        <Text
                            style={[localStyles.date, isSelected ? localStyles.description : localStyles.text]}
                        >{` • ${textDate}`}</Text>
                    )}
                </View>
                <View>
                    {!smallScreenNavigation && (isNaN(shortcutKey) || parseInt(shortcutKey) < 10) && (
                        <Shortcut text={shortcutKey} theme={SHORTCUT_LIGHT} />
                    )}
                </View>
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        height: 40,
        minHeight: 40,
        maxHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    containerOption: {
        flex: 1,
        flexDirection: 'row',
    },
    date: {
        flexShrink: 0,
        marginRight: 8,
    },
    description: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
    },
})
