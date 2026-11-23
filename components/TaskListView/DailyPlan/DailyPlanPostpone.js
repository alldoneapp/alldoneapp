import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { isRowTicked } from '../../../utils/dailyPlan/dailyPlanModel'
import { planStyles as s } from './dailyPlanStyles'
import { getDestinationDateText, getDestinationLabel } from './dailyPlanText'

function Checkbox({ checked, partial, testID }) {
    return (
        <View
            testID={testID}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: partial ? 'mixed' : !!checked }}
            style={[s.checkbox, (checked || partial) && s.checkboxChecked]}
        >
            {checked ? (
                <Icon name="check" size={14} color="#ffffff" />
            ) : partial ? (
                <View style={s.partialMark} />
            ) : null}
        </View>
    )
}

const tickState = (tickedCount, total) => ({
    checked: total > 0 && tickedCount === total,
    partial: tickedCount > 0 && tickedCount < total,
})

/** The reconciliation line: planned + postponed + stay = due today. */
export function Reconciliation({ totals }) {
    return (
        <Text style={s.reconciliation} testID="daily-plan-reconciliation">
            {translate('dailyPlan reconciliation', totals)}
        </Text>
    )
}

/** Destination first (3 days … 1 year, Someday), then project within each destination. */
export function DestinationGroup({ group, projectsById, expanded, onToggleExpanded, onTick, ticks, nowMs }) {
    const state = tickState(group.tickedCount, group.rows.length)
    const dateText = getDestinationDateText(group.key, nowMs)
    return (
        <View testID={`daily-plan-destination-${group.key}`}>
            <View style={s.destinationRow}>
                <TouchableOpacity
                    testID={`daily-plan-destination-tick-${group.key}`}
                    style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minHeight: 48 }}
                    onPress={() => onTick(group.rows, !state.checked)}
                >
                    <Checkbox checked={state.checked} partial={state.partial} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.destinationTitle} numberOfLines={1}>
                            {getDestinationLabel(group.key)}
                            {dateText ? ` · ${dateText}` : ''}
                            {group.isSomeday ? ` · ${translate('dailyPlan opt in')}` : ''}
                        </Text>
                        <Text style={s.mutedText} numberOfLines={1}>
                            {translate('dailyPlan ticked of', { ticked: group.tickedCount, total: group.rows.length })}
                            {' · '}
                            {group.projects
                                .map(project => `${projectsById[project.projectId]?.name || ''} ${project.rows.length}`)
                                .join(', ')}
                        </Text>
                    </View>
                </TouchableOpacity>
                <TouchableOpacity
                    testID={`daily-plan-destination-expand-${group.key}`}
                    style={{ width: 40, height: 48, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => onToggleExpanded(group.key)}
                    accessibilityState={{ expanded }}
                >
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.Text03} />
                </TouchableOpacity>
            </View>
            {group.isSomeday && (
                <Text style={[s.mutedText, { marginTop: 4, marginBottom: 4 }]}>
                    {translate('dailyPlan someday note')}
                </Text>
            )}
            {expanded &&
                group.projects.map(project => {
                    const projectState = tickState(project.tickedCount, project.rows.length)
                    return (
                        <View key={project.projectId} style={s.nested}>
                            <TouchableOpacity
                                testID={`daily-plan-destination-project-${group.key}-${project.projectId}`}
                                style={s.destinationRow}
                                onPress={() => onTick(project.rows, !projectState.checked)}
                            >
                                <Checkbox checked={projectState.checked} partial={projectState.partial} />
                                <View
                                    style={[
                                        s.projectDot,
                                        !!projectsById[project.projectId]?.color && {
                                            backgroundColor: projectsById[project.projectId].color,
                                        },
                                    ]}
                                />
                                <Text style={s.projectName} numberOfLines={1}>
                                    {projectsById[project.projectId]?.name || ''}
                                </Text>
                                <Text style={s.projectMeta}>
                                    {translate('dailyPlan ticked of', {
                                        ticked: project.tickedCount,
                                        total: project.rows.length,
                                    })}
                                </Text>
                            </TouchableOpacity>
                            {project.rows.map(row => {
                                const ticked = isRowTicked(row, ticks)
                                return (
                                    <TouchableOpacity
                                        key={row.key}
                                        testID={`daily-plan-postpone-${row.key}`}
                                        style={[s.taskRow, s.nested]}
                                        onPress={() => onTick([row], !ticked)}
                                    >
                                        <Checkbox checked={ticked} />
                                        <View style={s.rowText}>
                                            <Text style={s.taskName} numberOfLines={1}>
                                                {row.candidate.name}
                                            </Text>
                                            {row.candidate.protected && (
                                                <Text style={s.reason}>
                                                    {translate('dailyPlan reason protected', {
                                                        count: row.candidate.timesPostponed,
                                                    })}
                                                </Text>
                                            )}
                                        </View>
                                    </TouchableOpacity>
                                )
                            })}
                        </View>
                    )
                })}
        </View>
    )
}

/**
 * Per project and overall: planned + postponed + stay = due today, as one sum per line so it reads
 * the same as the sentence above and fits a phone (four labelled columns do not).
 */
export function ReconciliationTable({ view, projectsById }) {
    const Row = ({ name, values, total, testID }) => (
        <View style={[s.tableRow, total && s.tableTotal]} testID={testID}>
            <Text style={s.tableName} numberOfLines={1}>
                {name}
            </Text>
            <Text style={s.tableSum}>{`${values[0]} + ${values[1]} + ${values[2]} = ${values[3]}`}</Text>
        </View>
    )
    return (
        <View style={s.table} testID="daily-plan-reconciliation-table">
            <Text style={[s.mutedText, { textAlign: 'right' }]}>{translate('dailyPlan table legend')}</Text>
            {view.perProject.map(project => (
                <Row
                    key={project.projectId}
                    testID={`daily-plan-reconcile-${project.projectId}`}
                    name={projectsById[project.projectId]?.name || ''}
                    values={[project.planned, project.postponed, project.stays, project.all]}
                />
            ))}
            <Row
                total
                testID="daily-plan-reconcile-total"
                name={translate('dailyPlan all projects')}
                values={[view.totals.planned, view.totals.postponed, view.totals.stays, view.totals.all]}
            />
        </View>
    )
}
