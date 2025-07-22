import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import MilestoneAssigneeCapacityWrapper from './MilestoneAssigneeCapacityWrapper'
import { CAPACITY_AUTOMATIC } from './GoalsHelper'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'

export default function MilestoneCapacityView({
    milestoneAssignees,
    milestoneId,
    projectId,
    assigneesCapacityDates,
    automaticCapacity,
    milestoneCapacity,
    disableTagsActions,
}) {
    return (
        <View style={localStyles.container}>
            <Text style={localStyles.header1}>
                {translate('Available capacity per project member from today to the due date of the milestone')}
            </Text>
            <Text style={localStyles.header2}>
                {translate('It is automatically calculated but you can adjust to account for holiday / sickness etc')}
            </Text>
            {milestoneAssignees.length > 0 && (
                <View style={localStyles.tagsContainer}>
                    {milestoneAssignees.map((assignee, index) => {
                        const capacityDate = assigneesCapacityDates[assignee.uid]
                        return assignee ? (
                            <MilestoneAssigneeCapacityWrapper
                                projectId={projectId}
                                milestoneId={milestoneId}
                                assignee={assignee}
                                automaticCapacity={automaticCapacity}
                                capacityDate={capacityDate ? capacityDate : CAPACITY_AUTOMATIC}
                                milestoneCapacity={milestoneCapacity[index]}
                                disabled={disableTagsActions}
                            />
                        ) : null
                    })}
                </View>
            )}
            {milestoneAssignees.length === 0 && (
                <View style={localStyles.infoContainer}>
                    <Icon style={{ marginTop: 2 }} name="info" size={18} color={colors.Text03} />
                    <Text style={localStyles.info}>{translate('Milestone capacity view info')}</Text>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 8,
        paddingTop: 8,
    },
    header1: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    header2: {
        ...styles.body2,
        color: colors.Text03,
    },
    tagsContainer: {
        marginTop: 16,
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    infoContainer: {
        marginTop: 16,
        flexDirection: 'row',
    },
    info: {
        ...styles.body2,
        color: colors.Text03,
        marginLeft: 8,
        marginBottom: 8,
    },
})
