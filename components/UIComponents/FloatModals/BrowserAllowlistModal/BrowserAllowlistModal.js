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
 */
export default function BrowserAllowlistModal({ projectId, browserAutomation, closeModal }) {
    const initial = useMemo(() => {
        const stored = browserAutomation && typeof browserAutomation === 'object' ? browserAutomation : {}
        return {
            entries: sanitizeStoredAllowlist(stored.allowedDomains),
            enabled: stored.enabled !== false,
            allowSearchSubmit: stored.allowSearchSubmit !== false,
            limits: stored.limits && typeof stored.limits === 'object' ? stored.limits : {},
        }
    }, [browserAutomation])

    const [entries, setEntries] = useState(initial.entries)
    const [enabled, setEnabled] = useState(initial.enabled)
    const [allowSearchSubmit, setAllowSearchSubmit] = useState(initial.allowSearchSubmit)
    const [draft, setDraft] = useState('')
    const [errorKey, setErrorKey] = useState('')
    const [saveError, setSaveError] = useState('')
    const [saving, setSaving] = useState(false)

    const addEntries = () => {
        const candidates = splitAllowlistInput(draft)
        if (candidates.length === 0) {
            setErrorKey('browser_allowlist_error_empty')
            return
        }

        const accepted = []
        let firstError = ''
        for (const candidate of candidates) {
            const result = validateAllowlistEntry(candidate, [...entries, ...accepted])
            if (result.ok) accepted.push(result.value)
            else if (!firstError) firstError = result.errorKey
        }

        if (accepted.length > 0) setEntries([...entries, ...accepted])
        // A paste of several hosts where one is bad keeps the good ones and reports the bad one,
        // rather than refusing the whole paste and making the user find the offender.
        setDraft(accepted.length === candidates.length ? '' : draft)
        setErrorKey(accepted.length === candidates.length ? '' : firstError)
    }

    const removeEntry = entry => setEntries(entries.filter(value => value !== entry))

    const save = async () => {
        if (saving) return
        setSaving(true)
        setSaveError('')
        try {
            await setProjectBrowserAutomation(projectId, {
                enabled,
                allowedDomains: entries,
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

                <View style={localStyles.switchRow}>
                    <Switch value={enabled} onValueChange={setEnabled} />
                    <Text style={localStyles.switchLabel}>{translate('Browsing enabled for this project')}</Text>
                </View>

                <View style={localStyles.addRow}>
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
                        <Text style={localStyles.empty}>{translate('browser_allowlist_empty')}</Text>
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
