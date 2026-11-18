import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import Switch from '../../../UIControls/Switch'
import Spinner from '../../../UIComponents/Spinner'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { translate, useTranslator } from '../../../../i18n/TranslationService'
import { ModelPicker } from '../../../ProjectDetailedView/Wiki/ProjectWikiSettings'
import { formatWikiDate } from '../../../WikiView/useKnowledgeBase'
import AssistantProfileChangeModal from '../../../AssistantProfile/AssistantProfileChangeModal'
import { getAssistantProfileRevisionSummary } from '../../../AssistantProfile/revisionSummary'
import {
    requestAssistantProfileRefresh,
    saveAssistantProfileSettings,
    watchAssistantProfile,
    watchAssistantProfileRevisions,
} from '../../../../utils/backends/AssistantProfile/assistantProfileFirestore'
import {
    ASSISTANT_PROFILE_INSTRUCTIONS_MAX_CHARS,
    ASSISTANT_PROFILE_MAX_CHARS,
    ASSISTANT_PROFILE_SOURCE_KEYS,
    MAX_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP,
    MIN_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP,
    toAssistantProfileSettingsView,
} from '../../../../functions/AssistantProfile/assistantProfileModel'

const SOURCE_LABELS = {
    memory: { icon: 'cpu', label: 'Assistant memory' },
    tasks: { icon: 'check-square', label: 'Completed tasks' },
    goals: { icon: 'target', label: 'Goals' },
    notes: { icon: 'file-text', label: 'Notes you edited' },
    contacts: { icon: 'users', label: 'Contacts you edited' },
    chats: { icon: 'message-circle', label: 'Your conversations' },
}

const MODE_LABELS = {
    run: 'Updated automatically',
    user: 'Edited by you',
    restore: 'Restored',
}

const RESULT_LABELS = {
    changed: 'Profile updated',
    unchanged: 'Nothing worth changing',
    no_activity: 'No new activity',
    conflict: 'You edited the profile meanwhile',
    undecided: 'No update',
}

const STOP_REASON_LABELS = {
    monthly_cap: 'Monthly Gold limit reached',
    insufficient_gold: 'Not enough Gold',
    owner_inactive: 'Paused while you are away',
    time: 'Time limit reached',
}

function useAssistantProfileDoc(userId) {
    // undefined while loading, null when the user has no profile document yet.
    const [profile, setProfile] = useState(undefined)
    useEffect(() => {
        setProfile(undefined)
        return watchAssistantProfile(userId, setProfile, () => setProfile(null))
    }, [userId])
    return profile
}

function useAssistantProfileRevisions(userId) {
    const [revisions, setRevisions] = useState([])
    useEffect(() => watchAssistantProfileRevisions(userId, setRevisions, () => setRevisions([])), [userId])
    return revisions
}

function isRunning(profile, now = Date.now()) {
    return !!profile?.leaseOwner && Number(profile.leaseExpiresAt) > now
}

function RevisionRow({ revision, openRevision, setOpenRevision }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const open = openRevision === revision.revision
    const close = () => {
        setOpenRevision(null)
        dispatch(hideFloatPopup())
    }
    return (
        <View testID={`assistant-profile-revision-${revision.revision}`} style={localStyles.revisionRow}>
            <View style={localStyles.revisionText}>
                <Text style={localStyles.revisionMeta}>
                    {[formatWikiDate(revision.createdAt), translate(MODE_LABELS[revision.mode] || MODE_LABELS.run)]
                        .filter(Boolean)
                        .join(' · ')}
                </Text>
                {!!getAssistantProfileRevisionSummary(revision) && (
                    <Text style={localStyles.revisionSummary}>{getAssistantProfileRevisionSummary(revision)}</Text>
                )}
            </View>
            <AppPopover
                content={<AssistantProfileChangeModal revision={revision.revision} closeModal={close} />}
                align={'end'}
                position={['bottom', 'left', 'top']}
                onClickOutside={close}
                isOpen={open}
                contentLocation={mobile ? null : undefined}
            >
                <Button
                    type={'ghost'}
                    title={translate('Show changes')}
                    disabled={open}
                    onPress={() => {
                        setOpenRevision(revision.revision)
                        dispatch(showFloatPopup())
                    }}
                />
            </AppPopover>
        </View>
    )
}

// Settings → Profile: the private assistant profile (AT-3072). The text, its history and what keeps
// it current; everything is saved through callables, the profile is read straight from Firestore.
export default function AssistantProfileSection() {
    useTranslator()
    const userId = useSelector(state => state.loggedUser.uid)
    const profile = useAssistantProfileDoc(userId)
    const revisions = useAssistantProfileRevisions(userId)
    const stored = toAssistantProfileSettingsView(userId, profile || {})
    // No document yet: the default switches the profile on for every active user (the daily sweep
    // or the next login), so it is shown as on, and the first save keeps it on.
    const settings = profile === null ? { ...stored, enabled: true, enabledByDefault: true } : stored

    const [text, setText] = useState('')
    const [instructions, setInstructions] = useState('')
    const [cap, setCap] = useState('')
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState(null)
    const [refreshState, setRefreshState] = useState(null)
    const [requestedEnabled, setRequestedEnabled] = useState(null)
    const [showSettings, setShowSettings] = useState(false)
    const [openRevision, setOpenRevision] = useState(null)

    // Reset the inputs whenever the stored values change (a nightly run, or our own save).
    useEffect(() => {
        if (profile === undefined) return
        setText(settings.text)
        setInstructions(settings.instructions)
        setCap(String(settings.monthlyGoldCap))
    }, [profile === undefined, settings.text, settings.instructions, settings.monthlyGoldCap])

    useEffect(() => {
        if (requestedEnabled !== null && settings.enabled === requestedEnabled) setRequestedEnabled(null)
    }, [settings.enabled, requestedEnabled])

    const save = async patch => {
        setSaving(true)
        setMessage(null)
        try {
            await saveAssistantProfileSettings(patch)
            setMessage({ type: 'success', text: translate('Saved') })
            return true
        } catch (error) {
            setMessage({
                type: 'error',
                text:
                    error?.code === 'offline'
                        ? translate('Assistant profile settings need a connection')
                        : error?.message || '',
            })
            return false
        } finally {
            setSaving(false)
        }
    }

    const toggle = async enabled => {
        setRequestedEnabled(enabled)
        if (!(await save({ enabled }))) setRequestedEnabled(null)
    }

    const refresh = async () => {
        setRefreshState('pending')
        try {
            const result = await requestAssistantProfileRefresh()
            setRefreshState(result?.alreadyRequested ? 'alreadyRequested' : 'requested')
        } catch (error) {
            setRefreshState('failed')
        }
    }

    if (profile === undefined) {
        return (
            <View style={localStyles.container}>
                <Text style={localStyles.header}>{translate('Assistant profile')}</Text>
                <Text style={localStyles.hint}>{translate('Loading')}</Text>
            </View>
        )
    }

    const parsedCap = Number(cap)
    const capValid =
        Number.isInteger(parsedCap) &&
        parsedCap >= MIN_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP &&
        parsedCap <= MAX_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP
    const capResumes = settings.pausedAtMonthlyCap && capValid && parsedCap > settings.monthlyGoldSpent
    const running = isRunning(profile)
    const switchedOn = requestedEnabled !== null ? requestedEnabled : settings.enabled
    const switching = requestedEnabled !== null && saving && settings.enabled !== requestedEnabled
    const textChanged = text.trim() !== settings.text
    const lastRunLabel = settings.lastRunStopReason
        ? STOP_REASON_LABELS[settings.lastRunStopReason]
        : settings.lastRunStatus === 'failed'
          ? 'Failed'
          : RESULT_LABELS[profile?.lastRunResult]

    return (
        <View testID="assistant-profile-settings" style={localStyles.container}>
            <Text style={localStyles.header}>{translate('Assistant profile')}</Text>
            <Text style={localStyles.intro}>{translate('Assistant profile explanation')}</Text>

            <View style={localStyles.row}>
                <Icon name="user-check" size={24} color={colors.Text03} />
                <Text style={localStyles.label}>{translate('Keep my assistant profile up to date')}</Text>
                <View style={[localStyles.right, localStyles.inline]}>
                    {switching && (
                        <View style={localStyles.switching}>
                            <Spinner containerSize={20} spinnerSize={16} containerColor={'transparent'} />
                        </View>
                    )}
                    <Switch
                        active={switchedOn}
                        disabled={saving}
                        activeSwitch={() => toggle(true)}
                        deactiveSwitch={() => toggle(false)}
                    />
                </View>
            </View>
            {settings.enabledByDefault && (
                <Text testID="assistant-profile-default-hint" style={localStyles.hint}>
                    {translate('Assistant profile switched on by default')}
                </Text>
            )}
            {!settings.enabled && <Text style={localStyles.hint}>{translate('Assistant profile off hint')}</Text>}
            {settings.pausedForInactiveOwner && (
                <Text style={localStyles.hint}>{translate('Assistant profile paused while you are away')}</Text>
            )}
            {settings.pausedAtMonthlyCap && (
                <Text testID="assistant-profile-cap-reached" style={[localStyles.hint, localStyles.error]}>
                    {translate('Assistant profile monthly cap reached', { date: formatWikiDate(settings.nextRunAt) })}
                </Text>
            )}

            <TextInput
                testID="assistant-profile-text"
                style={localStyles.profileText}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={ASSISTANT_PROFILE_MAX_CHARS}
                placeholder={translate('Assistant profile placeholder')}
                placeholderTextColor={colors.Text03}
                editable={!saving}
                accessible={false}
            />
            <View style={localStyles.actionsBetween}>
                <Text style={localStyles.counter}>
                    {settings.lastChangedAt
                        ? `${translate('Last changed', { date: formatWikiDate(settings.lastChangedAt) })} · `
                        : ''}
                    {`${text.length}/${ASSISTANT_PROFILE_MAX_CHARS}`}
                </Text>
                <Button
                    type={'primary'}
                    title={translate('Save')}
                    disabled={saving || !textChanged}
                    onPress={() => save({ text })}
                />
            </View>

            {message && (
                <Text style={[localStyles.hint, message.type === 'error' && localStyles.error]}>{message.text}</Text>
            )}

            <View style={localStyles.statusBlock}>
                <Text style={localStyles.hint}>
                    {running
                        ? translate('Your assistant profile is being updated right now')
                        : settings.lastRunAt
                          ? [
                                translate('Assistant profile last checked', {
                                    date: formatWikiDate(settings.lastRunAt),
                                }),
                                lastRunLabel ? translate(lastRunLabel) : null,
                            ]
                                .filter(Boolean)
                                .join(' · ')
                          : translate('Assistant profile not run yet')}
                </Text>
                {settings.enabled && settings.nextRunAt && !running && (
                    <Text style={localStyles.hint}>
                        {translate('Next assistant profile update', { date: formatWikiDate(settings.nextRunAt) })}
                    </Text>
                )}
                <View style={localStyles.actions}>
                    <Button
                        type={'ghost'}
                        icon={'refresh-cw'}
                        title={translate('Update now')}
                        disabled={!stored.enabled || refreshState === 'pending' || running}
                        onPress={refresh}
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

            {revisions.length > 0 && (
                <View testID="assistant-profile-history" style={localStyles.history}>
                    <Text style={localStyles.sectionLabel}>{translate('Recent changes')}</Text>
                    {revisions.map(revision => (
                        <RevisionRow
                            key={revision.id}
                            revision={revision}
                            openRevision={openRevision}
                            setOpenRevision={setOpenRevision}
                        />
                    ))}
                </View>
            )}

            <TouchableOpacity
                testID="assistant-profile-settings-toggle"
                style={localStyles.toggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: showSettings }}
                onPress={() => setShowSettings(value => !value)}
            >
                <Text style={localStyles.toggleText}>
                    {translate(showSettings ? 'Hide profile settings' : 'Show profile settings')}
                </Text>
                <Icon name={showSettings ? 'chevron-up' : 'chevron-down'} size={16} color={colors.Primary100} />
            </TouchableOpacity>

            {showSettings && (
                <View testID="assistant-profile-advanced">
                    <Text style={[localStyles.label, localStyles.blockLabel]}>
                        {translate('Instructions for the profile')}
                    </Text>
                    <TextInput
                        testID="assistant-profile-instructions"
                        style={localStyles.instructions}
                        value={instructions}
                        onChangeText={setInstructions}
                        multiline
                        maxLength={ASSISTANT_PROFILE_INSTRUCTIONS_MAX_CHARS}
                        placeholder={translate('Assistant profile instructions placeholder')}
                        placeholderTextColor={colors.Text03}
                        editable={!saving}
                        accessible={false}
                    />
                    <View style={localStyles.actions}>
                        <Button
                            type={'ghost'}
                            title={translate('Save instructions')}
                            disabled={saving || instructions.trim() === settings.instructions}
                            onPress={() => save({ instructions })}
                        />
                    </View>

                    <Text style={[localStyles.label, localStyles.blockLabel]}>
                        {translate('What the profile is built from')}
                    </Text>
                    {ASSISTANT_PROFILE_SOURCE_KEYS.map(key => (
                        <View key={key} testID={`assistant-profile-source-${key}`} style={localStyles.row}>
                            <Icon name={SOURCE_LABELS[key].icon} size={20} color={colors.Text03} />
                            <Text style={localStyles.label}>{translate(SOURCE_LABELS[key].label)}</Text>
                            <View style={localStyles.right}>
                                <Switch
                                    active={settings.sources[key] !== false}
                                    disabled={saving}
                                    activeSwitch={() => save({ sources: { [key]: true } })}
                                    deactiveSwitch={() => save({ sources: { [key]: false } })}
                                />
                            </View>
                        </View>
                    ))}

                    <View style={localStyles.row}>
                        <Icon name="cpu" size={24} color={colors.Text03} />
                        <Text style={localStyles.label}>{translate('Model')}</Text>
                        <View style={localStyles.right}>
                            <ModelPicker model={settings.model} disabled={saving} onChange={model => save({ model })} />
                        </View>
                    </View>

                    <View style={localStyles.row}>
                        <Icon name="dollar-sign" size={24} color={colors.Text03} />
                        <Text style={localStyles.label}>{translate('Monthly Gold limit')}</Text>
                        <View style={[localStyles.right, localStyles.inline]}>
                            <TextInput
                                testID="assistant-profile-cap"
                                style={localStyles.capInput}
                                value={cap}
                                onChangeText={setCap}
                                keyboardType={'numeric'}
                                editable={!saving}
                                accessible={false}
                            />
                            <Button
                                type={'ghost'}
                                title={translate('Save')}
                                disabled={saving || !capValid || (parsedCap === settings.monthlyGoldCap && !capResumes)}
                                onPress={() => save({ monthlyGoldCap: parsedCap })}
                            />
                        </View>
                    </View>
                    <Text style={localStyles.hint}>
                        {translate('Assistant profile Gold spent this month', {
                            spent: settings.monthlyGoldSpent,
                            cap: settings.monthlyGoldCap,
                        })}
                    </Text>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 32,
        marginBottom: 32,
    },
    header: {
        ...styles.title6,
        color: colors.Text01,
        marginBottom: 4,
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
        flexShrink: 1,
    },
    blockLabel: {
        marginTop: 16,
        marginBottom: 8,
    },
    right: {
        marginLeft: 'auto',
        paddingLeft: 8,
    },
    inline: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    switching: {
        marginRight: 12,
    },
    profileText: {
        ...styles.body1,
        minHeight: 200,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        padding: 12,
        marginTop: 12,
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
    counter: {
        ...styles.caption2,
        color: colors.Text03,
        flexShrink: 1,
        marginRight: 8,
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
    actionsBetween: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
    },
    statusBlock: {
        marginTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
        paddingTop: 12,
    },
    history: {
        marginTop: 16,
    },
    sectionLabel: {
        ...styles.overline,
        color: colors.Text03,
        marginBottom: 8,
        marginLeft: 8,
    },
    revisionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
    },
    revisionText: {
        flex: 1,
        marginRight: 8,
    },
    revisionMeta: {
        ...styles.caption2,
        color: colors.Text03,
    },
    revisionSummary: {
        ...styles.body2,
        color: colors.Text02,
    },
    toggle: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        paddingVertical: 12,
        paddingLeft: 8,
        marginTop: 8,
    },
    toggleText: {
        ...styles.body2,
        color: colors.Primary100,
    },
})
