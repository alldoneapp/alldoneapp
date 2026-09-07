import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import ModalHeader from '../ModalHeader'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import Switch from '../../../UIControls/Switch'
import { translate } from '../../../../i18n/TranslationService'
import { setProjectBrowserAutomation } from '../../../../utils/backends/Projects/projectsFirestore'
import {
    BROWSER_ACCESS_MODE_ALL_PUBLIC,
    BROWSER_ACCESS_MODE_SELECTED,
    normalizeBrowserAccessMode,
    sanitizeStoredAllowlist,
    splitAllowlistInput,
    validateAllowlistEntry,
} from '../../../../utils/browserAllowlistInput'

/**
 * The editor for which websites the assistant may open (`browser_automation`).
 *
 * Two things about it are deliberate:
 *
 * - It is DEFAULT DENY and says so. An empty list is not "everything"; it is "browsing is off", and
 *   the empty state states that rather than showing a blank box that reads like a missing feature.
 * - It validates as you type and names the specific problem, because the alternative — the server
 *   quietly dropping an unusable entry on the next read — looks exactly like the allowlist being
 *   ignored. `validateAllowlistEntry` never accepts anything the server would drop; that contract
 *   is pinned by browserAllowlistParity.test.js.
 *
 * The list is per PROJECT even though it is reached from an assistant's Tools Access: two
 * assistants in one project must not be able to disagree about which sites may be opened. The
 * header says so, so nobody has to infer it.
 *
 * Three modes, and the ordering on screen is the ordering of risk: off, only selected sites
 * (the default), all public sites. The third one is opt-in and carries a warning that says what it
 * actually changes — the assistant may open ANY public page, including one a page it is reading
 * links to. What it does NOT change is stated too, because "all websites" invites the reading that
 * the safety rules were switched off: private and internal addresses stay blocked, and every
 * booking, payment, login, upload, send and delete still pauses for an approval.
 */
function ModeOption({ label, description, selected, onPress }) {
    return (
        <TouchableOpacity style={localStyles.modeRow} onPress={onPress} accessibilityLabel={label}>
            <Icon
                name={selected ? 'check-circle' : 'circle'}
                size={18}
                color={selected ? colors.Primary100 : colors.Text03}
            />
            <View style={localStyles.modeTextBlock}>
                <Text style={localStyles.modeLabel}>{label}</Text>
                <Text style={localStyles.hint}>{description}</Text>
            </View>
        </TouchableOpacity>
    )
}

export default function BrowserAllowlistModal({ projectId, browserAutomation, closeModal }) {
    const initial = useMemo(() => {
        const stored = browserAutomation && typeof browserAutomation === 'object' ? browserAutomation : {}
        return {
            entries: sanitizeStoredAllowlist(stored.allowedDomains),
            deniedEntries: sanitizeStoredAllowlist(stored.deniedDomains),
            enabled: stored.enabled !== false,
            accessMode: normalizeBrowserAccessMode(stored.accessMode),
            allowSearchSubmit: stored.allowSearchSubmit !== false,
            limits: stored.limits && typeof stored.limits === 'object' ? stored.limits : {},
        }
    }, [browserAutomation])

    const [entries, setEntries] = useState(initial.entries)
    const [deniedEntries, setDeniedEntries] = useState(initial.deniedEntries)
    const [enabled, setEnabled] = useState(initial.enabled)
    const [accessMode, setAccessMode] = useState(initial.accessMode)
    const [allowSearchSubmit, setAllowSearchSubmit] = useState(initial.allowSearchSubmit)
    const [draft, setDraft] = useState('')
    const [deniedDraft, setDeniedDraft] = useState('')
    const [errorKey, setErrorKey] = useState('')
    const [deniedErrorKey, setDeniedErrorKey] = useState('')
    const [saveError, setSaveError] = useState('')
    const [saving, setSaving] = useState(false)

    const allPublic = accessMode === BROWSER_ACCESS_MODE_ALL_PUBLIC

    /**
     * Shared by both lists, because a denied entry has exactly the same syntax and the same
     * validation as an allowed one — the only difference is which list it lands in.
     */
    const addEntriesTo = (text, currentEntries, setCurrentEntries, setDraftValue, setError) => {
        const candidates = splitAllowlistInput(text)
        if (candidates.length === 0) {
            setError('browser_allowlist_error_empty')
            return
        }

        const accepted = []
        let firstError = ''
        for (const candidate of candidates) {
            const result = validateAllowlistEntry(candidate, [...currentEntries, ...accepted])
            if (result.ok) accepted.push(result.value)
            else if (!firstError) firstError = result.errorKey
        }

        if (accepted.length > 0) setCurrentEntries([...currentEntries, ...accepted])
        // A paste of several hosts where one is bad keeps the good ones and reports the bad one,
        // rather than refusing the whole paste and making the user find the offender.
        setDraftValue(accepted.length === candidates.length ? '' : text)
        setError(accepted.length === candidates.length ? '' : firstError)
    }

    const addEntries = () => addEntriesTo(draft, entries, setEntries, setDraft, setErrorKey)
    const addDeniedEntries = () =>
        addEntriesTo(deniedDraft, deniedEntries, setDeniedEntries, setDeniedDraft, setDeniedErrorKey)

    const removeEntry = entry => setEntries(entries.filter(value => value !== entry))
    const removeDeniedEntry = entry => setDeniedEntries(deniedEntries.filter(value => value !== entry))

    const save = async () => {
        if (saving) return
        setSaving(true)
        setSaveError('')
        try {
            await setProjectBrowserAutomation(projectId, {
                enabled,
                accessMode,
                allowedDomains: entries,
                deniedDomains: deniedEntries,
                allowSearchSubmit,
                limits: initial.limits,
            })
            closeModal()
        } catch (error) {
            setSaving(false)
            setSaveError(translate('browser_allowlist_save_failed'))
        }
    }

    return (
        <View style={localStyles.wrapper}>
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Allowed websites')}
                    description={translate('Allowed websites description')}
                />

                {/* Ordered by risk: off, only selected sites (the default), all public sites. */}
                <ModeOption
                    label={translate('browser_mode_off')}
                    description={translate('browser_mode_off_hint')}
                    selected={!enabled}
                    onPress={() => setEnabled(false)}
                />
                <ModeOption
                    label={translate('browser_mode_selected')}
                    description={translate('browser_mode_selected_hint')}
                    selected={enabled && !allPublic}
                    onPress={() => {
                        setEnabled(true)
                        setAccessMode(BROWSER_ACCESS_MODE_SELECTED)
                    }}
                />
                <ModeOption
                    label={translate('browser_mode_all_public')}
                    description={translate('browser_mode_all_public_hint')}
                    selected={enabled && allPublic}
                    onPress={() => {
                        setEnabled(true)
                        setAccessMode(BROWSER_ACCESS_MODE_ALL_PUBLIC)
                    }}
                />

                {enabled && allPublic && (
                    <View style={localStyles.warning}>
                        <Icon name={'alert-triangle'} size={16} color={colors.UtilityYellow200} />
                        <View style={localStyles.warningTextBlock}>
                            <Text style={localStyles.warningText}>{translate('browser_mode_all_public_warning')}</Text>
                            {/* Said explicitly, because "all websites" invites the reading that the
                                safety rules were switched off along with the list. */}
                            <Text style={localStyles.hint}>{translate('browser_mode_all_public_still_blocked')}</Text>
                        </View>
                    </View>
                )}

                <View style={[localStyles.addRow, allPublic && localStyles.dimmed]}>
                    <TextInput
                        value={draft}
                        onChangeText={value => {
                            setDraft(value)
                            if (errorKey) setErrorKey('')
                        }}
                        onSubmitEditing={addEntries}
                        placeholder={translate('browser_allowlist_entry_placeholder')}
                        placeholderTextColor={colors.Text03}
                        style={[localStyles.input, !!errorKey && localStyles.inputError]}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <Button
                        type={'ghost'}
                        icon={'plus'}
                        onPress={addEntries}
                        title={translate('Add a website')}
                        buttonStyle={localStyles.addButton}
                    />
                </View>
                {!!errorKey && <Text style={localStyles.error}>{translate(errorKey)}</Text>}

                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    {entries.length === 0 ? (
                        <Text style={localStyles.empty}>
                            {/* In all_public an empty list is a choice, not an unfinished setup, so
                                it must not keep saying "browsing is off". */}
                            {translate(
                                allPublic ? 'browser_allowlist_unused_in_all_public' : 'browser_allowlist_empty'
                            )}
                        </Text>
                    ) : (
                        entries.map(entry => (
                            <View key={entry} style={localStyles.entry}>
                                <Text style={localStyles.entryText} numberOfLines={1}>
                                    {entry}
                                </Text>
                                <TouchableOpacity onPress={() => removeEntry(entry)} accessibilityLabel={entry}>
                                    <Icon name={'x'} size={16} color={colors.Text03} />
                                </TouchableOpacity>
                            </View>
                        ))
                    )}
                </CustomScrollView>

                <Text style={localStyles.sectionTitle}>{translate('Blocked websites')}</Text>
                <Text style={localStyles.hint}>{translate('Blocked websites description')}</Text>
                <View style={localStyles.addRow}>
                    <TextInput
                        value={deniedDraft}
                        onChangeText={value => {
                            setDeniedDraft(value)
                            if (deniedErrorKey) setDeniedErrorKey('')
                        }}
                        onSubmitEditing={addDeniedEntries}
                        placeholder={translate('browser_allowlist_entry_placeholder')}
                        placeholderTextColor={colors.Text03}
                        style={[localStyles.input, !!deniedErrorKey && localStyles.inputError]}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <Button
                        type={'ghost'}
                        icon={'plus'}
                        onPress={addDeniedEntries}
                        title={translate('Add a website')}
                        buttonStyle={localStyles.addButton}
                    />
                </View>
                {!!deniedErrorKey && <Text style={localStyles.error}>{translate(deniedErrorKey)}</Text>}
                {deniedEntries.length > 0 && (
                    <CustomScrollView style={localStyles.deniedScroll} showsVerticalScrollIndicator={false}>
                        {deniedEntries.map(entry => (
                            <View key={entry} style={localStyles.entry}>
                                <Text style={localStyles.entryText} numberOfLines={1}>
                                    {entry}
                                </Text>
                                <TouchableOpacity onPress={() => removeDeniedEntry(entry)} accessibilityLabel={entry}>
                                    <Icon name={'x'} size={16} color={colors.Text03} />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </CustomScrollView>
                )}

                <View style={localStyles.switchRow}>
                    <Switch value={allowSearchSubmit} onValueChange={setAllowSearchSubmit} />
                    <Text style={localStyles.switchLabel}>{translate('Allow search forms without asking')}</Text>
                </View>
                <Text style={localStyles.hint}>{translate('browser_allowlist_search_hint')}</Text>

                {!!saveError && <Text style={localStyles.error}>{saveError}</Text>}

                <View style={localStyles.actions}>
                    <Button
                        type="ghost"
                        onPress={closeModal}
                        title={translate('Cancel')}
                        buttonStyle={localStyles.actionButton}
                    />
                    <Button
                        type="primary"
                        onPress={save}
                        disabled={saving}
                        title={translate('Save')}
                        buttonStyle={[localStyles.actionButton, localStyles.saveButton]}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    wrapper: {
        flexDirection: 'column',
    },
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
        padding: 16,
        width: 360,
        maxWidth: 400,
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    modeRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 8,
    },
    modeTextBlock: {
        marginLeft: 12,
        flex: 1,
    },
    modeLabel: {
        color: '#FFFFFF',
    },
    warning: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginTop: 8,
        padding: 12,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.UtilityYellow150,
    },
    warningTextBlock: {
        marginLeft: 12,
        flex: 1,
    },
    warningText: {
        color: colors.UtilityYellow200,
    },
    sectionTitle: {
        color: '#FFFFFF',
        marginTop: 16,
    },
    dimmed: {
        opacity: 0.5,
    },
    deniedScroll: {
        maxHeight: 120,
        marginTop: 8,
    },
    switchLabel: {
        marginLeft: 12,
        color: '#FFFFFF',
        flex: 1,
    },
    addRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
    },
    input: {
        flex: 1,
        height: 36,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
        paddingHorizontal: 8,
        color: '#FFFFFF',
    },
    inputError: {
        borderColor: colors.UtilityRed200,
    },
    addButton: {
        marginLeft: 8,
    },
    error: {
        color: colors.UtilityRed200,
        marginTop: 6,
    },
    scroll: {
        maxHeight: 180,
        marginTop: 12,
    },
    empty: {
        color: colors.Text03,
        paddingVertical: 8,
    },
    entry: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
    },
    entryText: {
        color: '#FFFFFF',
        flex: 1,
        marginRight: 8,
    },
    hint: {
        color: colors.Text03,
        marginTop: 6,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 16,
    },
    actionButton: {
        minWidth: 96,
        marginLeft: 0,
    },
    saveButton: {
        marginLeft: 8,
    },
})
