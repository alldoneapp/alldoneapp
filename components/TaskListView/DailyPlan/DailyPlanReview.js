import React from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import {
    ASSUMED_MEETING_OPTIONS,
    ESTIMATE_OPTIONS,
    PLAN_FILL_SHARE,
    PLAN_TIERS,
    RULE_MILESTONE_AT_RISK,
    TIER_COULD,
    TIER_LATER,
    TIER_SHOULD,
    formatPlanDuration,
} from '../../../utils/dailyPlan/dailyPlanModel'
import { formatWorkingHoursRange } from '../../../utils/meetingTimeToday'
import { planStyles as s } from './dailyPlanStyles'
import { TIER_LABEL_KEYS, TIER_SHORT_KEYS, getDestinationLabel, getRowReason } from './dailyPlanText'

const nextInCycle = (list, value) => list[(list.indexOf(value) + 1) % list.length]

/** Cross-project capacity: one budget for the whole day, the bar, and the per-project line. */
export function CapacityCard({
    capacity,
    summary,
    grouped,
    projectsById,
    meetingCount,
    assumedMeetings,
    onAssume,
    onRepropose,
    proposalStale,
}) {
    const used = summary.selectedMinutes
    const aheadCount = summary.rows.filter(row => row.selected && row.rule === RULE_MILESTONE_AT_RISK).length
    const budget = capacity.budgetMinutes
    const fillRatio = budget > 0 ? Math.min(1, used / budget) : used > 0 ? 1 : 0
    const over = summary.isOverBudget
    const range = formatWorkingHoursRange(capacity.workingHours)
    const meetingsText = capacity.provisional
        ? translate('dailyPlan meetings assumed', { duration: formatPlanDuration(capacity.meetingMinutes) })
        : translate('dailyPlan meetings known', { duration: formatPlanDuration(capacity.meetingMinutes) })

    return (
        <View style={s.capacityCard} testID="daily-plan-capacity">
            <Text style={s.mutedText}>{translate('dailyPlan all projects budget')}</Text>
            <View style={[s.capacityRow, { marginTop: 4 }]}>
                <Text style={s.capacityBig} testID="daily-plan-time-to-work">
                    {formatPlanDuration(capacity.freeMinutes)}
                </Text>
                <Text style={s.capacityLabel}>{translate('meetingTime time to work')}</Text>
                <Text style={s.capacityBig} testID="daily-plan-planned">
                    {formatPlanDuration(used)}
                </Text>
                <Text style={s.capacityLabel}>
                    {translate('dailyPlan planned of budget', {
                        count: summary.selectedCount,
                        budget: formatPlanDuration(budget),
                    })}
                </Text>
            </View>
            <View style={s.barTrack} accessibilityRole="progressbar" testID="daily-plan-bar">
                <View style={[s.barFill, over && s.barOver, { width: `${Math.round(fillRatio * 100)}%` }]} />
            </View>
            <Text style={[s.capacityDetail, over ? s.warning : s.ok]} testID="daily-plan-remaining">
                {over
                    ? translate('dailyPlan over by', { duration: formatPlanDuration(summary.overMinutes) })
                    : translate('dailyPlan left in plan', { duration: formatPlanDuration(summary.remainingMinutes) })}
                {'  ·  '}
                {translate('dailyPlan buffer', {
                    duration: formatPlanDuration(capacity.bufferMinutes),
                    percent: Math.round((1 - PLAN_FILL_SHARE) * 100),
                })}
            </Text>
            <Text style={s.capacityDetail} testID="daily-plan-equation">
                {`${range} · ${formatPlanDuration(capacity.windowMinutes)} − ${meetingsText} = ${formatPlanDuration(
                    capacity.freeMinutes
                )}`}
                {!capacity.provisional && (capacity.meetingCount || meetingCount) > 0
                    ? ` · ${translate('dailyPlan meetings not planned', {
                          count: capacity.meetingCount || meetingCount,
                      })}`
                    : ''}
                {summary.unknownEstimateCount > 0
                    ? ` · ${translate('dailyPlan unknown estimates', { count: summary.unknownEstimateCount })}`
                    : ''}
            </Text>
            <Text style={s.capacityDetail} testID="daily-plan-order-note">
                {translate('dailyPlan order note')}
                {aheadCount > 0 ? ` ${translate('dailyPlan ahead count', { count: aheadCount })}` : ''}
            </Text>
            {grouped.projects.length > 1 && (
                <Text style={s.capacityDetail} testID="daily-plan-per-project-line">
                    {grouped.projects
                        .filter(project => project.selectedCount > 0)
                        .map(
                            project =>
                                `${projectsById[project.projectId]?.name || ''} ${formatPlanDuration(
                                    project.selectedMinutes
                                )} · ${project.selectedCount}`
                        )
                        .join(' + ')}
                </Text>
            )}
            {capacity.provisional && (
                <View testID="daily-plan-provisional">
                    <Text style={[s.capacityDetail, s.warning]}>
                        {translate(
                            capacity.calendarState === 'calendarUnavailable'
                                ? 'dailyPlan calendar unavailable'
                                : 'dailyPlan calendar missing'
                        )}
                    </Text>
                    <View style={s.chipRow}>
                        {ASSUMED_MEETING_OPTIONS.map(minutes => (
                            <TouchableOpacity
                                key={minutes}
                                testID={`daily-plan-assume-${minutes}`}
                                style={[s.chip, assumedMeetings === minutes && s.chipSelected]}
                                onPress={() => onAssume(minutes)}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: assumedMeetings === minutes }}
                            >
                                <Text style={s.chipText}>
                                    {minutes === 0 ? translate('dailyPlan no meetings') : formatPlanDuration(minutes)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                        {proposalStale && (
                            <TouchableOpacity testID="daily-plan-repropose" style={s.chip} onPress={onRepropose}>
                                <Text style={s.chipText}>{translate('dailyPlan repropose')}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            )}
        </View>
    )
}

/** Over budget: Anna's suggested moves, or keep everything. Must tasks are never suggested. */
export function OverloadCard({ summary, suggestions, onMove, onMoveAll, onKeepAll }) {
    return (
        <View style={s.overloadCard} testID="daily-plan-overload">
            <Text style={s.overloadTitle}>
                {translate('dailyPlan over by', { duration: formatPlanDuration(summary.overMinutes) })}
            </Text>
            {summary.isOverloaded && (
                <Text style={[s.mutedText, { marginTop: 4 }]}>
                    {translate('dailyPlan must alone over', { duration: formatPlanDuration(summary.mustMinutes) })}
                </Text>
            )}
            {suggestions.moves.length > 0 && (
                <Text style={[s.bodyText, { marginTop: 6 }]}>{translate('dailyPlan suggestions intro')}</Text>
            )}
            {suggestions.moves.map(row => (
                <View key={row.key} style={s.taskRow}>
                    <View style={s.rowText}>
                        <Text style={s.taskName} numberOfLines={1}>
                            {row.candidate.name}
                        </Text>
                        <Text style={s.reason}>{formatPlanDuration(row.estimate)}</Text>
                    </View>
                    <TouchableOpacity
                        testID={`daily-plan-suggestion-${row.key}`}
                        style={s.smallChip}
                        onPress={() => onMove(row.key)}
                    >
                        <Text style={s.smallChipText}>{translate('dailyPlan move out')}</Text>
                    </TouchableOpacity>
                </View>
            ))}
            <View style={s.chipRow}>
                {suggestions.moves.length > 1 && (
                    <TouchableOpacity testID="daily-plan-move-all" style={s.chip} onPress={onMoveAll}>
                        <Text style={s.chipText}>{translate('dailyPlan move all suggested')}</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity testID="daily-plan-keep-all" style={s.chip} onPress={onKeepAll}>
                    <Text style={s.chipText}>{translate('dailyPlan keep everything')}</Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

function PlanRow({ row, onSetTier, onSetEstimate, compact }) {
    const selected = row.tier !== TIER_LATER
    return (
        <View style={s.taskRow} testID={`daily-plan-row-${row.key}`}>
            <TouchableOpacity
                testID={`daily-plan-toggle-${row.key}`}
                style={[s.rowButton, { backgroundColor: selected ? colors.Secondary200 : colors.Primary100 }]}
                onPress={() =>
                    onSetTier(
                        row.key,
                        selected ? TIER_LATER : row.candidate.priority === 'could_do' ? TIER_COULD : TIER_SHOULD
                    )
                }
                accessibilityLabel={
                    selected ? translate('dailyPlan remove from today') : translate('dailyPlan add to today')
                }
            >
                <Icon name={selected ? 'minus' : 'plus'} size={16} color="#ffffff" />
            </TouchableOpacity>
            <View style={s.rowText}>
                <Text style={s.taskName} numberOfLines={compact ? 2 : 1}>
                    {row.candidate.name}
                </Text>
                <Text style={s.reason} numberOfLines={2} testID={`daily-plan-reason-${row.key}`}>
                    {selected
                        ? getRowReason(row)
                        : `${getRowReason(row)} · ${getDestinationLabel(row.candidate.destinationKey)}`}
                </Text>
            </View>
            <View style={s.rowControls}>
                {selected && (
                    <TouchableOpacity
                        testID={`daily-plan-tier-${row.key}`}
                        style={s.smallChip}
                        onPress={() => onSetTier(row.key, nextInCycle(PLAN_TIERS, row.tier))}
                        accessibilityLabel={translate(TIER_LABEL_KEYS[row.tier])}
                    >
                        <Text style={s.smallChipText}>{translate(TIER_SHORT_KEYS[row.tier])}</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity
                    testID={`daily-plan-estimate-${row.key}`}
                    style={s.smallChip}
                    onPress={() => onSetEstimate(row.key, nextInCycle(ESTIMATE_OPTIONS, row.estimate))}
                    accessibilityLabel={
                        row.estimateKnown ? translate('dailyPlan estimate') : translate('dailyPlan estimate assumed')
                    }
                >
                    <Text style={[s.smallChipText, !row.estimateKnown && s.unknownEstimate]}>
                        {row.estimateKnown ? formatPlanDuration(row.estimate) : `~${formatPlanDuration(row.estimate)}`}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

/** One project: header with selected count + subtotal, rows by priority, collapsed Not today. */
export function ProjectGroup({
    project,
    projectData,
    laterOpen,
    onToggleLater,
    onSetTier,
    onSetEstimate,
    searching,
    compact,
}) {
    const showLater = laterOpen || (searching && project.visibleLater.length > 0)
    if (searching && project.visibleSelected.length === 0 && project.visibleLater.length === 0) return null
    return (
        <View testID={`daily-plan-project-${project.projectId}`}>
            <View style={s.projectHeader}>
                <View style={[s.projectDot, !!projectData?.color && { backgroundColor: projectData.color }]} />
                <Text style={s.projectName} numberOfLines={1}>
                    {projectData?.name || ''}
                </Text>
                <Text style={s.projectMeta} testID={`daily-plan-project-subtotal-${project.projectId}`}>
                    {translate('dailyPlan project subtotal', {
                        count: project.selectedCount,
                        duration: formatPlanDuration(project.selectedMinutes),
                    })}
                </Text>
                <Text style={s.tierCounts}>
                    {PLAN_TIERS.filter(tier => project.tierCounts[tier] > 0)
                        .map(tier => `${translate(TIER_SHORT_KEYS[tier])} ${project.tierCounts[tier]}`)
                        .join(' · ')}
                </Text>
            </View>
            {project.visibleSelected.map(row => (
                <PlanRow
                    key={row.key}
                    row={row}
                    onSetTier={onSetTier}
                    onSetEstimate={onSetEstimate}
                    compact={compact}
                />
            ))}
            {project.laterCount > 0 && (
                <TouchableOpacity
                    testID={`daily-plan-later-toggle-${project.projectId}`}
                    style={s.laterToggle}
                    onPress={() => onToggleLater(project.projectId)}
                    accessibilityState={{ expanded: showLater }}
                >
                    <Icon name={showLater ? 'chevron-up' : 'chevron-down'} size={16} color={colors.Grey400} />
                    <Text style={s.laterToggleText}>
                        {translate('dailyPlan not today count', { count: project.laterCount })}
                    </Text>
                </TouchableOpacity>
            )}
            {showLater &&
                project.visibleLater.map(row => (
                    <PlanRow
                        key={row.key}
                        row={row}
                        onSetTier={onSetTier}
                        onSetEstimate={onSetEstimate}
                        compact={compact}
                    />
                ))}
        </View>
    )
}

export function SearchField({ value, onChange }) {
    return (
        <TextInput
            testID="daily-plan-search"
            style={s.search}
            value={value}
            onChangeText={onChange}
            placeholder={translate('dailyPlan search placeholder')}
            placeholderTextColor={colors.Text03}
        />
    )
}
