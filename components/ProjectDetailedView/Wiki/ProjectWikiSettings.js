import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import Switch from '../../UIControls/Switch'
import Spinner from '../../UIComponents/Spinner'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import AssistantModelModal from '../../UIComponents/FloatModals/AssistantModelModal/AssistantModelModal'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { translate, useTranslator } from '../../../i18n/TranslationService'
import URLsProjects, { URL_PROJECT_DETAILS_WIKI } from '../../../URLSystem/Projects/URLsProjects'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import {
    requestKnowledgeBaseRefresh,
    saveKnowledgeBaseSettings,
} from '../../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import {
    KNOWLEDGE_BASE_INSTRUCTIONS_MAX_CHARS,
    MAX_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
    MIN_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
    toKnowledgeBaseSettingsView,
} from '../../../functions/KnowledgeBase/knowledgeBaseModel'
import { SELECTABLE_ASSISTANT_MODELS } from '../../../functions/Assistant/selectableAssistantModels'
import {
    formatWikiDate,
    isKnowledgeBaseRunning,
    useKnowledgeBaseDoc,
    useKnowledgeRuns,
} from '../../WikiView/useKnowledgeBase'
import { openProjectWiki } from '../../WikiView/wikiLinks'

const RUN_STATUS_LABELS = {
    running: 'Running',
    completed: 'Completed',
    partial: 'Continues in the next run',
    stopped: 'Stopped',
    failed: 'Failed',
}

const STOP_REASON_LABELS = {
    monthly_cap: 'Monthly Gold limit reached',
    insufficient_gold: 'Not enough Gold',
    time: 'Time limit reached',
    no_owner: 'No paying member',
}

function currentMonthSpent(knowledgeBase, now = Date.now()) {
    const month = new Date(now).toISOString().slice(0, 7)
    return knowledgeBase?.monthlyGold?.month === month ? Number(knowledgeBase.monthlyGold.spent) || 0 : 0
}

// Mirrors canManageKnowledgeBase on the server: the member who switched the wiki on pays for it, so
// while it is on only they change it, unless they have left the project.
export function canManageWiki(knowledgeBase, userId, projectUserIds = []) {
    if (!knowledgeBase || knowledgeBase.enabled !== true) return true
    if (!knowledgeBase.ownerUserId || knowledgeBase.ownerUserId === userId) return true
    return !projectUserIds.includes(knowledgeBase.ownerUserId)
}

function ModelPicker({ model, disabled, onChange }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)
    const option = SELECTABLE_ASSISTANT_MODELS.find(entry => entry.model === model)

    const close = () => {
        setOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <AppPopover
            content={<AssistantModelModal model={model} updateModel={onChange} closeModal={close} />}
            align={'start'}
            position={['bottom']}
            onClickOutside={close}
            isOpen={open}
            contentLocation={mobile ? null : undefined}
        >
            <Button
                type={'ghost'}
                icon={'edit-2'}
                disabled={disabled || open}
                onPress={() => {
                    setOpen(true)
                    dispatch(showFloatPopup())
                }}
                title={translate(option?.labelKey || model)}
            />
        </AppPopover>
    )
}

export default function ProjectWikiSettings({ project }) {
    useTranslator()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const knowledgeBase = useKnowledgeBaseDoc(project.id)
    const runs = useKnowledgeRuns(project.id)
    const settings = toKnowledgeBaseSettingsView(project.id, knowledgeBase || {})
    const projectUserIds = Array.isArray(project.userIds) ? project.userIds : []
    const canManage = canManageWiki(knowledgeBase, loggedUserId, projectUserIds)
    const owner = settings.ownerUserId ? TasksHelper.getUserInProject(project.id, settings.ownerUserId) : null

    const [instructions, setInstructions] = useState('')
    const [cap, setCap] = useState('')
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState(null)
    const [refreshState, setRefreshState] = useState(null)
    // The value the switch was just pressed to. Switching the wiki on waits for a cold function, the
    // settings transaction and queueing the first build, which can take several seconds; a switch
    // that only moved once all of that had answered looked as if the press had been lost.
    const [requestedEnabled, setRequestedEnabled] = useState(null)

    useEffect(() => {
        URLsProjects.push(URL_PROJECT_DETAILS_WIKI, { projectId: project.id, userId: loggedUserId }, project.id)
    }, [project.id])

    // Reset the inputs whenever the stored values change (another member's save, or our own).
    useEffect(() => {
        if (knowledgeBase === undefined) return
        setInstructions(settings.instructions)
        setCap(String(settings.monthlyGoldCap))
    }, [knowledgeBase === undefined, settings.instructions, settings.monthlyGoldCap])

    // The watched document is the authority: once it agrees, the switch goes back to showing it.
    useEffect(() => {
        if (requestedEnabled !== null && settings.enabled === requestedEnabled) setRequestedEnabled(null)
    }, [settings.enabled, requestedEnabled])

    const save = async patch => {
        setSaving(true)
        setMessage(null)
        try {
            await saveKnowledgeBaseSettings(project.id, patch)
            setMessage({ type: 'success', text: translate('Saved') })
            return true
        } catch (error) {
            setMessage({
                type: 'error',
                text: error?.code === 'offline' ? translate('Wiki settings need a connection') : error?.message || '',
            })
            return false
        } finally {
            setSaving(false)
        }
    }

    const toggleWiki = async enabled => {
        setRequestedEnabled(enabled)
        // A refused change puts the switch back where the document says it is.
        if (!(await save({ enabled }))) setRequestedEnabled(null)
    }

    const refresh = async () => {
        setRefreshState('pending')
        try {
            const result = await requestKnowledgeBaseRefresh(project.id)
            setRefreshState(result?.alreadyRequested ? 'alreadyRequested' : 'requested')
        } catch (error) {
            setRefreshState('failed')
        }
    }

    if (knowledgeBase === undefined) {
        return <Text style={localStyles.hint}>{translate('Loading wiki')}</Text>
    }

    const parsedCap = Number(cap)
    const capValid =
        Number.isInteger(parsedCap) &&
        parsedCap >= MIN_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP &&
        parsedCap <= MAX_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP
    const disabled = !canManage || saving
    const running = isKnowledgeBaseRunning(knowledgeBase)
    const switchedOn = requestedEnabled !== null ? requestedEnabled : settings.enabled
    // Only while the server has not answered: a document that already agrees, or a finished call,
    // means the change is in place even if the other one is still on its way.
    const switching = requestedEnabled !== null && saving && settings.enabled !== requestedEnabled

    return (
        <View testID="project-wiki-settings" style={localStyles.container}>
            <Text style={localStyles.intro}>{translate('Wiki explanation')}</Text>

            <View style={localStyles.row}>
                <Icon name="book-open" size={24} color={colors.Text03} />
                <Text style={localStyles.label}>{translate('Project wiki')}</Text>
                <View style={[localStyles.right, localStyles.inline]}>
                    {switching && (
                        <View testID="project-wiki-switching" style={localStyles.switching}>
                            <Spinner containerSize={20} spinnerSize={16} containerColor={'transparent'} />
                            <Text style={localStyles.switchingText}>
                                {translate(requestedEnabled ? 'Switching the wiki on' : 'Switching the wiki off')}
                            </Text>
                        </View>
                    )}
                    <Switch
                        active={switchedOn}
                        disabled={disabled}
                        activeSwitch={() => toggleWiki(true)}
                        deactiveSwitch={() => toggleWiki(false)}
                    />
                </View>
            </View>
            <Text style={localStyles.hint}>
                {settings.enabled && owner
                    ? translate('Wiki paid by', { name: owner.displayName || owner.name || '' })
                    : translate('Wiki payment hint')}
            </Text>
            {!canManage && (
                <Text style={localStyles.hint}>{translate('Only the paying member can change the wiki')}</Text>
            )}

            <View style={localStyles.row}>
                <Icon name="cpu" size={24} color={colors.Text03} />
                <Text style={localStyles.label}>{translate('Model')}</Text>
                <View style={localStyles.right}>
                    <ModelPicker model={settings.model} disabled={disabled} onChange={model => save({ model })} />
                </View>
            </View>

            <View style={localStyles.row}>
                <Icon name="dollar-sign" size={24} color={colors.Text03} />
                <Text style={localStyles.label}>{translate('Monthly Gold limit')}</Text>
                <View style={[localStyles.right, localStyles.inline]}>
                    <TextInput
                        testID="project-wiki-cap"
                        style={localStyles.capInput}
                        value={cap}
                        onChangeText={setCap}
                        keyboardType={'numeric'}
                        editable={!disabled}
                        accessible={false}
                    />
                    <Button
                        type={'ghost'}
                        title={translate('Save')}
                        disabled={disabled || !capValid || parsedCap === settings.monthlyGoldCap}
                        onPress={() => save({ monthlyGoldCap: parsedCap })}
                    />
                </View>
            </View>
            <Text style={localStyles.hint}>
                {translate('Wiki Gold spent this month', {
                    spent: currentMonthSpent(knowledgeBase),
                    cap: settings.monthlyGoldCap,
                })}
            </Text>

            <Text style={[localStyles.label, localStyles.blockLabel]}>{translate('Instructions for the wiki')}</Text>
            <TextInput
                testID="project-wiki-instructions"
                style={localStyles.instructions}
                value={instructions}
                onChangeText={setInstructions}
                multiline
                maxLength={KNOWLEDGE_BASE_INSTRUCTIONS_MAX_CHARS}
                placeholder={translate('Wiki instructions placeholder')}
                placeholderTextColor={colors.Text03}
                editable={!disabled}
                accessible={false}
            />
            <View style={localStyles.actions}>
                <Button
                    type={'ghost'}
                    title={translate('Save instructions')}
                    disabled={disabled || instructions.trim() === settings.instructions}
                    onPress={() => save({ instructions })}
                />
            </View>

            {message && (
                <Text style={[localStyles.hint, message.type === 'error' && localStyles.error]}>{message.text}</Text>
            )}

            <View style={localStyles.statusBlock}>
                <Text style={localStyles.hint}>
                    {running
                        ? translate('The wiki is being updated right now')
                        : settings.lastRunAt
                          ? translate('Wiki last updated', { date: formatWikiDate(settings.lastRunAt) })
                          : translate('The wiki has not run yet')}
                </Text>
                {settings.enabled && settings.nextRunAt && !running && (
                    <Text style={localStyles.hint}>
                        {translate('Next wiki update', { date: formatWikiDate(settings.nextRunAt) })}
                    </Text>
                )}
                <View style={localStyles.actions}>
                    <Button
                        type={'ghost'}
                        icon={'refresh-cw'}
                        title={translate('Update now')}
                        disabled={!settings.enabled || refreshState === 'pending'}
                        onPress={refresh}
                    />
                    <Button
                        type={'ghost'}
                        icon={'book-open'}
                        title={translate('Open wiki')}
                        onPress={() => openProjectWiki(project.id)}
                        buttonStyle={localStyles.secondAction}
                    />
                </View>
                {refreshState && refreshState !== 'pending' && (
                    <Text style={[localStyles.hint, refreshState === 'failed' && localStyles.error]}>
                        {translate(
                            refreshState === 'failed'
                                ? 'Could not request an update'
                                : refreshState === 'alreadyRequested'
                                  ? 'An update was already requested'
                                  : 'Update requested'
                        )}
                    </Text>
                )}
            </View>

            {runs.length > 0 && (
                <View testID="project-wiki-runs" style={localStyles.runs}>
                    <Text style={localStyles.sectionLabel}>{translate('Recent wiki runs')}</Text>
                    {runs.map(run => (
                        <View key={run.id} style={localStyles.runRow}>
                            <Text style={localStyles.runDate}>{formatWikiDate(run.startedAt)}</Text>
                            <Text style={localStyles.runText}>
                                {[
                                    translate(RUN_STATUS_LABELS[run.status] || run.status || ''),
                                    run.stopReason && STOP_REASON_LABELS[run.stopReason]
                                        ? translate(STOP_REASON_LABELS[run.stopReason])
                                        : null,
                                    translate('Wiki run summary', {
                                        sources: Number(run.sources) || 0,
                                        changes: Array.isArray(run.changes) ? run.changes.length : 0,
                                        gold: Number(run.goldSpent) || 0,
                                    }),
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </Text>
                        </View>
                    ))}
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingVertical: 16,
    },
    intro: {
        ...styles.body2,
        color: colors.Text02,
        marginBottom: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingLeft: 8,
    },
    label: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 8,
    },
    blockLabel: {
        marginTop: 16,
        marginBottom: 8,
        marginLeft: 8,
    },
    right: {
        marginLeft: 'auto',
    },
    inline: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    switching: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 12,
    },
    switchingText: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 4,
    },
    capInput: {
        ...styles.body1,
        width: 96,
        height: 40,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        paddingHorizontal: 8,
        marginRight: 8,
        color: colors.Text01,
    },
    instructions: {
        ...styles.body1,
        minHeight: 96,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        padding: 8,
        color: colors.Text01,
    },
    hint: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
        marginTop: 4,
    },
    error: {
        color: colors.UtilityRed200,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 8,
        flexWrap: 'wrap',
    },
    secondAction: {
        marginLeft: 8,
    },
    statusBlock: {
        marginTop: 24,
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
        paddingTop: 12,
    },
    runs: {
        marginTop: 24,
    },
    sectionLabel: {
        ...styles.overline,
        color: colors.Text03,
        marginBottom: 8,
        marginLeft: 8,
    },
    runRow: {
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
    },
    runDate: {
        ...styles.caption2,
        color: colors.Text03,
    },
    runText: {
        ...styles.body2,
        color: colors.Text02,
    },
})
