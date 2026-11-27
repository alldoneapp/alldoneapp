import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useStore } from 'react-redux'
import moment from 'moment'

import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import WorkspaceModal from '../../UIComponents/ModalShell/WorkspaceModal'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import useModalSizing from '../../../hooks/useModalSizing'
import { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import {
    buildApplyTasks,
    buildPlanCandidates,
    buildPostponeView,
    computePlanCapacity,
    groupPlanByProject,
    proposePlan,
    suggestOverloadMoves,
    summarizePlan,
    toggleTicks,
    TIER_LATER,
} from '../../../utils/dailyPlan/dailyPlanModel'
import { applyDailyPlan } from '../../../utils/backends/Tasks/dailyPlan'
import { planStyles as s } from './dailyPlanStyles'
import { CapacityCard, OverloadCard, ProjectGroup, SearchField } from './DailyPlanReview'
import { DestinationGroup, Reconciliation, ReconciliationTable } from './DailyPlanPostpone'

const STEP_REVIEW = 'review'
const STEP_POSTPONE = 'postpone'

/**
 * The Today tasks frozen when the dialog opens, so nothing re-flows under the user while they
 * review (a task completed meanwhile is simply skipped by the server). Reads the store once
 * instead of subscribing to the whole openTasksMap (state-and-performance.md).
 */
export const takePlanSnapshot = (state, nowMs = Date.now()) => {
    const loggedUser = state.loggedUser || {}
    const sortedProjectIds = inFocusTaskProjectId =>
        ProjectHelper.getNormalAndGuideProjectsSortedBySortedAndWithProjectInFocusAtTheTop(
            loggedUser.projectIds || [],
            loggedUser.guideProjectIds || [],
            loggedUser.archivedProjectIds || [],
            loggedUser.templateProjectIds || [],
            state.loggedUserProjectsMap || {},
            loggedUser.uid,
            inFocusTaskProjectId
        )
    // Groups are shown as on Today (focus project on top); the RANKING uses the plain project-list
    // order of the sidebar, so having the focus task in a project does not promote its other tasks.
    const projectOrder = sortedProjectIds(loggedUser.inFocusTaskProjectId)
    const projectPriorityOrder = sortedProjectIds(null)
    const { candidates, projectIds, meetingCount } = buildPlanCandidates({
        openTasksMap: state.openTasksMap || {},
        projectOrder,
        projectPriorityOrder,
        userId: loggedUser.uid,
        endOfDay: moment(nowMs).endOf('day').valueOf(),
        nowMs,
        focusTaskId: loggedUser.inFocusTaskId || null,
        focusProjectId: loggedUser.inFocusTaskProjectId || null,
        // Loaded per project by the Today list (watchAllGoals / watchAllMilestones); a project
        // without them has no milestone data and is ranked without milestones.
        goalsByProject: state.goalsByProjectInTasks || {},
        openMilestonesByProject: state.openMilestonesByProjectInTasks || {},
    })
    return { candidates, projectIds, meetingCount, projectsById: state.loggedUserProjectsMap || {}, nowMs }
}

export function DailyPlanDialog({ meetingView, onClose, onApplied, applyPlan = applyDailyPlan }) {
    const store = useStore()
    const [snapshot] = useState(() => takePlanSnapshot(store.getState()))
    const { candidates, projectIds, meetingCount, projectsById, nowMs } = snapshot
    const { width, maxHeight, isSheet } = useModalSizing({ size: 'L' })

    const [assumedMeetings, setAssumedMeetings] = useState(0)
    const [skipCalendar, setSkipCalendar] = useState(false)
    const capacity = useMemo(
        () =>
            computePlanCapacity(
                skipCalendar && meetingView?.workingHours ? { ...meetingView, status: 'noCalendar' } : meetingView,
                assumedMeetings
            ),
        [meetingView, assumedMeetings, skipCalendar]
    )

    // Anna's proposal is made once (and again only on "Re-propose"); edits are overrides on top.
    const [proposal, setProposal] = useState(null)
    const [proposalBudget, setProposalBudget] = useState(null)
    const [tierOverrides, setTierOverrides] = useState({})
    const [estimateOverrides, setEstimateOverrides] = useState({})
    const [ticks, setTicks] = useState({})
    const [query, setQuery] = useState('')
    const [laterOpen, setLaterOpen] = useState({})
    const [expandedDestinations, setExpandedDestinations] = useState({})
    const [overloadAccepted, setOverloadAccepted] = useState(false)
    const [step, setStep] = useState(STEP_REVIEW)
    const [applying, setApplying] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        if (proposal || capacity.status !== 'ready') return
        setProposal(proposePlan(candidates, capacity.budgetMinutes))
        setProposalBudget(capacity.budgetMinutes)
    }, [capacity, proposal, candidates])

    const ready = capacity.status === 'ready' && !!proposal
    const summary = useMemo(
        () => (ready ? summarizePlan({ candidates, proposal, tierOverrides, estimateOverrides, capacity }) : null),
        [ready, candidates, proposal, tierOverrides, estimateOverrides, capacity]
    )
    const grouped = useMemo(
        () => (summary ? groupPlanByProject(summary, projectIds, query) : null),
        [summary, projectIds, query]
    )
    const suggestions = useMemo(() => (summary ? suggestOverloadMoves(summary) : null), [summary])
    const postponeView = useMemo(
        () => (summary ? buildPostponeView(summary, projectIds, ticks) : null),
        [summary, projectIds, ticks]
    )

    const setTier = (key, tier) => {
        setTierOverrides(previous => {
            const next = { ...previous }
            if (proposal[key]?.tier === tier) delete next[key]
            else next[key] = tier
            return next
        })
        // The default tick depends on who moved the task out; let it follow the new decision.
        setTicks(previous => {
            if (!(key in previous)) return previous
            const next = { ...previous }
            delete next[key]
            return next
        })
        setOverloadAccepted(false)
    }
    const setEstimate = (key, minutes) => setEstimateOverrides(previous => ({ ...previous, [key]: minutes }))
    const reset = () => {
        setTierOverrides({})
        setEstimateOverrides({})
        setTicks({})
        setOverloadAccepted(false)
    }
    const repropose = () => {
        setProposal(proposePlan(candidates, capacity.budgetMinutes, { estimateOverrides, keepTiers: tierOverrides }))
        setProposalBudget(capacity.budgetMinutes)
    }
    const moveOut = keys => keys.forEach(key => setTier(key, TIER_LATER))

    const apply = () => {
        if (applying || !summary) return
        setApplying(true)
        setError('')
        applyPlan(buildApplyTasks(summary, postponeView), { budgetMinutes: summary.budgetMinutes })
            .then(result => {
                onApplied?.(result, { plannedCount: summary.selectedCount, plannedMinutes: summary.selectedMinutes })
                onClose()
            })
            .catch(applyError => {
                setApplying(false)
                setError(
                    applyError?.code === 'offline'
                        ? translate('dailyPlan offline')
                        : (applyError?.message || translate('dailyPlan apply failed')).replace(/^.*?:\s*/, '')
                )
            })
    }

    const close = () => {
        if (!applying) onClose()
    }

    let body
    let footer
    if (candidates.length === 0) {
        body = (
            <Text style={[s.bodyText, { paddingVertical: 16 }]} testID="daily-plan-empty">
                {translate('dailyPlan nothing due')}
            </Text>
        )
        footer = <Button type="primary" title={translate('Close')} onPress={close} />
    } else if (!ready) {
        body = (
            <View style={{ paddingVertical: 16 }} testID="daily-plan-loading">
                <Text style={s.bodyText}>{translate('dailyPlan reading calendar')}</Text>
                {meetingView?.workingHours && (
                    <TouchableOpacity
                        testID="daily-plan-skip-calendar"
                        style={[s.chip, { alignSelf: 'flex-start', marginTop: 8 }]}
                        onPress={() => setSkipCalendar(true)}
                    >
                        <Text style={s.chipText}>{translate('dailyPlan continue without calendar')}</Text>
                    </TouchableOpacity>
                )}
            </View>
        )
        footer = <Button type="secondary" title={translate('Cancel')} onPress={close} />
    } else if (step === STEP_REVIEW) {
        const edited = Object.keys(tierOverrides).length > 0 || Object.keys(estimateOverrides).length > 0
        body = (
            <View testID="daily-plan-review">
                <CapacityCard
                    capacity={capacity}
                    summary={summary}
                    grouped={grouped}
                    projectsById={projectsById}
                    meetingCount={meetingCount}
                    assumedMeetings={assumedMeetings}
                    onAssume={setAssumedMeetings}
                    onRepropose={repropose}
                    proposalStale={proposalBudget !== capacity.budgetMinutes}
                />
                {summary.isOverBudget && !overloadAccepted && (
                    <OverloadCard
                        summary={summary}
                        suggestions={suggestions}
                        onMove={key => moveOut([key])}
                        onMoveAll={() => moveOut(suggestions.moves.map(row => row.key))}
                        onKeepAll={() => setOverloadAccepted(true)}
                    />
                )}
                <SearchField value={query} onChange={setQuery} />
                {grouped.projects.map(project => (
                    <ProjectGroup
                        key={project.projectId}
                        project={project}
                        projectData={projectsById[project.projectId]}
                        laterOpen={!!laterOpen[project.projectId]}
                        onToggleLater={projectId =>
                            setLaterOpen(previous => ({ ...previous, [projectId]: !previous[projectId] }))
                        }
                        onSetTier={setTier}
                        onSetEstimate={setEstimate}
                        searching={!!query.trim()}
                        compact={isSheet}
                    />
                ))}
                {edited && (
                    <TouchableOpacity
                        testID="daily-plan-reset"
                        style={[s.chip, { alignSelf: 'flex-start', marginTop: 12 }]}
                        onPress={reset}
                    >
                        <Text style={s.chipText}>{translate('dailyPlan reset')}</Text>
                    </TouchableOpacity>
                )}
                <View style={{ height: 12 }} />
            </View>
        )
        footer = (
            <>
                <Text style={s.footerNote}>{translate('dailyPlan nothing changes yet')}</Text>
                <View style={s.footerSpacer} />
                <Button type="secondary" title={translate('Cancel')} onPress={close} buttonStyle={{ marginRight: 8 }} />
                <Button
                    type="primary"
                    testID="daily-plan-next"
                    title={translate('dailyPlan next postpone', { count: summary.laterCount })}
                    onPress={() => setStep(STEP_POSTPONE)}
                />
            </>
        )
    } else {
        body = (
            <View testID="daily-plan-postpone">
                <Reconciliation totals={postponeView.totals} />
                {postponeView.groups.length === 0 && (
                    <Text style={s.mutedText}>{translate('dailyPlan nothing to postpone')}</Text>
                )}
                {postponeView.groups.map(group => (
                    <DestinationGroup
                        key={group.key}
                        group={group}
                        projectsById={projectsById}
                        expanded={!!expandedDestinations[group.key]}
                        onToggleExpanded={key =>
                            setExpandedDestinations(previous => ({ ...previous, [key]: !previous[key] }))
                        }
                        onTick={(rows, value) => setTicks(previous => toggleTicks(previous, rows, value))}
                        ticks={ticks}
                        nowMs={nowMs}
                    />
                ))}
                <ReconciliationTable view={postponeView} projectsById={projectsById} />
                <Text style={[s.mutedText, { marginBottom: 12 }]}>{translate('dailyPlan stays note')}</Text>
            </View>
        )
        footer = (
            <>
                <Button
                    type="secondary"
                    title={translate('Back')}
                    onPress={() => setStep(STEP_REVIEW)}
                    disabled={applying}
                    buttonStyle={{ marginRight: 8 }}
                />
                <View style={s.footerSpacer} />
                <Button
                    type="primary"
                    testID="daily-plan-apply"
                    title={applying ? translate('dailyPlan applying') : translate('dailyPlan apply')}
                    onPress={apply}
                    disabled={applying}
                />
            </>
        )
    }

    return (
        <View style={[s.scrim, isSheet && { justifyContent: 'flex-end', paddingBottom: 8 }]} testID="daily-plan-scrim">
            <TouchableOpacity
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
                onPress={close}
                accessibilityLabel={translate('Close')}
            />
            <View
                dataSet={{ adPopup: 'true' }}
                style={[s.card, isSheet && s.sheetCard, { width, maxHeight }]}
                testID="daily-plan-modal"
                accessibilityViewIsModal={true}
            >
                <View style={s.header}>
                    <Text style={s.title}>
                        {step === STEP_POSTPONE ? translate('dailyPlan postpone title') : translate('dailyPlan title')}
                    </Text>
                    <Text style={s.subtitle}>
                        {step === STEP_POSTPONE
                            ? translate('dailyPlan postpone subtitle')
                            : translate('dailyPlan subtitle')}
                    </Text>
                </View>
                <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={s.scroll}>
                    {body}
                </ScrollView>
                {!!error && (
                    <Text style={s.error} testID="daily-plan-error">
                        {error}
                    </Text>
                )}
                <View style={s.footer}>{footer}</View>
                <TouchableOpacity testID="daily-plan-close" style={s.closeButton} onPress={close} disabled={applying}>
                    <Icon name="x" size={22} color={colors.Text03} />
                </TouchableOpacity>
            </View>
        </View>
    )
}

export default function DailyPlanModal({ visible, onClose, meetingView, onApplied }) {
    return (
        <WorkspaceModal visible={visible} onRequestClose={onClose}>
            {visible && <DailyPlanDialog meetingView={meetingView} onClose={onClose} onApplied={onApplied} />}
        </WorkspaceModal>
    )
}
