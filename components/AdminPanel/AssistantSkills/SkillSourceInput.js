import React, { useRef, useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'
import { SKILL_SOURCE_PASTE, SKILL_SOURCE_UPLOAD } from './assistantSkillsHelper'
import { buildSkillDraftFromFile, buildSkillDraftFromMarkdown, SKILL_UPLOAD_ACCEPT } from './skillDraftFromSource'
import { describeSkillSourceError, describeSkillSourceWarning } from './skillSourceMessages'

const HIDDEN_INPUT_STYLE = { display: 'none' }
const DROP_WRAPPER_STYLE = { display: 'contents' }

/**
 * The two alternative ways to fill the Add-skill form (AT-2431): upload a
 * SKILL.md / .md / .txt / .zip, or paste the markdown straight in.
 *
 * It only ever *prefills* — it never writes anything. The admin still reviews
 * every field and presses Save, which is what keeps the original manual
 * creation method intact and means a half-parsed document can never reach the
 * catalog. Parse warnings (no frontmatter, derived name, …) are shown next to
 * the fields they explain rather than blocking, because the form's own
 * validation already decides what is savable.
 */
export default function SkillSourceInput({ onApplyDraft, onBusyChange, disabled }) {
    const [status, setStatus] = useState(null)
    const [warnings, setWarnings] = useState([])
    const [pasteVisible, setPasteVisible] = useState(false)
    const [pastedText, setPastedText] = useState('')
    const [busy, setBusy] = useState(false)
    const [isDraggingFile, setIsDraggingFile] = useState(false)
    const fileInputRef = useRef(null)

    const isWeb = Platform.OS === 'web'
    const inactive = disabled || busy

    // Reported upwards so the form can refuse to Save mid-parse. Kept as a
    // callback rather than an effect on `busy`: the parent needs to know before
    // the next render commits, not one render later.
    const setBusyState = value => {
        setBusy(value)
        onBusyChange?.(value)
    }

    const applyResult = (result, sourceLabel) => {
        setWarnings(result.warnings || [])
        setStatus({ type: 'success', text: sourceLabel })
        onApplyDraft(result.draft, result.sourceMeta)
    }

    const reportError = error => {
        setWarnings([])
        setStatus({ type: 'error', text: describeSkillSourceError(error) })
    }

    const handleFile = async file => {
        if (!file) return
        if (inactive) {
            // Silence here reads as "the drop did nothing"; say why instead.
            setStatus({ type: 'error', text: translate('Skill source busy') })
            return
        }
        setBusyState(true)
        setStatus(null)
        setWarnings([])
        try {
            const result = await buildSkillDraftFromFile(file)
            applyResult(
                {
                    ...result,
                    sourceMeta: { type: SKILL_SOURCE_UPLOAD, fileName: file.name },
                },
                translate('Skill loaded from file', { fileName: file.name })
            )
        } catch (error) {
            reportError(error)
        } finally {
            setBusyState(false)
        }
    }

    const openFilePicker = () => {
        if (inactive) return
        // Cleared first so re-picking the same file after a failed parse still
        // fires `change` (the browser suppresses it for an identical value).
        if (fileInputRef.current) fileInputRef.current.value = ''
        fileInputRef.current?.click()
    }

    const applyPastedText = () => {
        if (inactive) return
        setStatus(null)
        setWarnings([])
        try {
            const result = buildSkillDraftFromMarkdown({ markdown: pastedText, fileName: '' })
            applyResult({ ...result, sourceMeta: { type: SKILL_SOURCE_PASTE } }, translate('Skill loaded from text'))
            setPasteVisible(false)
            setPastedText('')
        } catch (error) {
            reportError(error)
        }
    }

    const dragEventHasFile = event => {
        const dataTransfer = event?.dataTransfer || event?.nativeEvent?.dataTransfer
        return Array.from(dataTransfer?.types || []).includes('Files')
    }

    const onDragOver = event => {
        if (!dragEventHasFile(event)) return
        event.preventDefault()
        event.stopPropagation()
        setIsDraggingFile(true)
    }

    const onDragLeave = () => setIsDraggingFile(false)

    const onDrop = event => {
        if (!dragEventHasFile(event)) return
        event.preventDefault()
        event.stopPropagation()
        setIsDraggingFile(false)
        const dataTransfer = event.dataTransfer || event.nativeEvent?.dataTransfer
        const [file] = Array.from(dataTransfer?.files || [])
        if (file) handleFile(file)
    }

    const content = (
        <View style={[localStyles.container, isDraggingFile && localStyles.containerDragging]}>
            <Text style={[styles.subtitle2, { color: colors.Text01 }]}>{translate('Start from a file or text')}</Text>
            <Text style={[styles.caption2, { color: colors.Text03, marginTop: 2 }]}>
                {translate('Start from a file or text hint')}
            </Text>

            <View style={localStyles.buttonRow}>
                {isWeb && (
                    // The hidden file input only exists on the web branch below,
                    // so off-web this button could only ever be a no-op with no
                    // feedback. Pasting still works everywhere.
                    <Button
                        type={'ghost'}
                        icon={'upload'}
                        title={translate('Upload file')}
                        onPress={openFilePicker}
                        disabled={inactive}
                        buttonStyle={localStyles.button}
                    />
                )}
                <Button
                    type={'ghost'}
                    icon={'clipboard'}
                    title={translate(pasteVisible ? 'Hide pasted text' : 'Paste text')}
                    onPress={() => setPasteVisible(visible => !visible)}
                    disabled={inactive}
                    buttonStyle={localStyles.button}
                />
                {busy && <ActivityIndicator color={colors.Primary300} size="small" />}
            </View>

            {pasteVisible && (
                <View style={localStyles.pasteSection}>
                    <TextInput
                        value={pastedText}
                        onChangeText={setPastedText}
                        style={localStyles.pasteInput}
                        placeholder={translate('Paste skill markdown placeholder')}
                        multiline={true}
                        testID={'skill-source-paste-input'}
                    />
                    <View style={localStyles.pasteActions}>
                        <Button
                            type={'primary'}
                            title={translate('Use this text')}
                            onPress={applyPastedText}
                            disabled={inactive || !pastedText.trim()}
                        />
                    </View>
                </View>
            )}

            {!!status && (
                <Text
                    style={[
                        styles.caption2,
                        localStyles.statusText,
                        { color: status.type === 'error' ? colors.UtilityRed200 : colors.UtilityGreen200 },
                    ]}
                    testID={status.type === 'error' ? 'skill-source-error' : 'skill-source-success'}
                >
                    {status.text}
                </Text>
            )}

            {warnings.map((warning, index) => (
                <Text
                    key={`${warning.code}-${index}`}
                    style={[styles.caption2, localStyles.statusText, { color: colors.UtilityYellow200 }]}
                    testID={'skill-source-warning'}
                >
                    {describeSkillSourceWarning(warning)}
                </Text>
            ))}
        </View>
    )

    if (!isWeb) return content

    return (
        <div style={DROP_WRAPPER_STYLE} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
            <input
                ref={fileInputRef}
                type={'file'}
                accept={SKILL_UPLOAD_ACCEPT}
                style={HIDDEN_INPUT_STYLE}
                data-testid={'skill-source-file-input'}
                onChange={event => {
                    const [file] = Array.from(event.target.files || [])
                    // Returned rather than fired and forgotten so the parse is
                    // awaitable — a zip goes through several async decompression
                    // ticks before the draft exists.
                    return handleFile(file)
                }}
            />
            {content}
        </div>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.Grey300,
        borderRadius: 4,
        padding: 12,
        marginBottom: 16,
    },
    containerDragging: {
        borderColor: colors.Primary300,
        borderStyle: 'solid',
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,
        flexWrap: 'wrap',
    },
    button: {
        marginRight: 8,
    },
    pasteSection: {
        marginTop: 10,
    },
    pasteInput: {
        ...styles.body1,
        fontWeight: 400,
        color: colors.Text01,
        borderWidth: 1,
        borderRadius: 4,
        borderColor: colors.Gray400,
        paddingHorizontal: 12,
        paddingVertical: 8,
        minHeight: 140,
        textAlignVertical: 'top',
        fontFamily: 'monospace',
        backgroundColor: '#ffffff',
    },
    pasteActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 8,
    },
    statusText: {
        marginTop: 8,
    },
})
