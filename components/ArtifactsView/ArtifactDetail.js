import React, { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Button from '../UIControls/Button'
import { translate } from '../../i18n/TranslationService'
import {
    deleteArtifact,
    getArtifactUrl,
    resetArtifactLink,
    restoreArtifactVersion,
    setArtifactDataAccess,
    setArtifactPrivacy,
    updateArtifactMetadata,
} from '../../utils/backends/Artifacts/artifactsFirestore'
import {
    ARTIFACT_KINDS,
    MAX_ARTIFACT_DESCRIPTION_CHARS,
    MAX_ARTIFACT_TITLE_CHARS,
} from '../../functions/Artifacts/artifactModel'
import ArtifactPreview from './ArtifactPreview'
import ArtifactBacklinks from './ArtifactBacklinks'
import ArtifactContextLink from './ArtifactContextLink'
import { openUploadSource } from './uploadSourceLinks'
import ArtifactAssistantForm from './ArtifactAssistantForm'
import ArtifactChat from './ArtifactChat'
import ArtifactHistory from './ArtifactHistory'
import {
    ARTIFACT_SECTION_ARTIFACT,
    ARTIFACT_SECTION_CHAT,
    ARTIFACT_SECTION_DETAILS,
    ARTIFACT_SECTION_UPDATES,
    useArtifactSection,
} from './artifactsNavigationState'
import URLsArtifacts, { getArtifactDetailsUrl } from '../../URLSystem/Artifacts/URLsArtifacts'
import { ArtifactFileInput, ArtifactUploadStatus, useArtifactUploader } from './ArtifactUpload'
import { useArtifact, useArtifactVersions } from './useArtifacts'
import { getProjectArtifactsPath } from './artifactLinks'
import useWindowSize from '../../utils/useWindowSize'
import {
    formatArtifactDate,
    formatArtifactSize,
    getArtifactKindIcon,
    getArtifactSourceLabelKey,
} from './artifactPresentation'

function SectionSwitch({ section, onChange, commentCount }) {
    const options = [
        { value: ARTIFACT_SECTION_ARTIFACT, label: translate('Artifact') },
        {
            value: ARTIFACT_SECTION_CHAT,
            label: commentCount > 0 ? `${translate('Chat')} · ${commentCount}` : translate('Chat'),
        },
        { value: ARTIFACT_SECTION_UPDATES, label: translate('Updates') },
        { value: ARTIFACT_SECTION_DETAILS, label: translate('Details') },
    ]
    return (
        <View style={localStyles.sectionSwitch} accessibilityRole="tablist">
            {options.map(option => {
                const active = option.value === section
                return (
                    <TouchableOpacity
                        key={option.value}
                        testID={`artifact-section-${option.value}`}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                        style={[localStyles.sectionTab, active && localStyles.sectionTabActive]}
                        onPress={() => onChange(option.value)}
                        accessible={false}
                    >
                        <Text style={[localStyles.sectionTabText, active && localStyles.sectionTabTextActive]}>
                            {option.label}
                        </Text>
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

// A small icon button of the header row. The label doubles as the browser tooltip, since an icon
// alone does not say what "upload" replaces or what the assistant will change.
function HeaderAction({ testID, icon, label, onPress, disabled, active }) {
    const button = (
        <TouchableOpacity
            testID={testID}
            accessibilityLabel={label}
            accessibilityRole="button"
            onPress={onPress}
            disabled={disabled}
            style={[localStyles.headerAction, active && localStyles.headerActionActive, disabled && { opacity: 0.4 }]}
        >
            <Icon name={icon} size={18} color={active ? colors.Primary100 : colors.Text02} />
        </TouchableOpacity>
    )
    if (Platform.OS !== 'web') return button
    return (
        <span title={label} style={webStyles.tooltip}>
            {button}
        </span>
    )
}

// The page offset of a node as if nothing were scrolled: offsetTop summed up the offsetParent
// chain ignores every scroll position, so the result does not depend on where the list was
// scrolled to before the artifact opened.
function getUnscrolledTop(node) {
    let top = 0
    let current = node
    while (current && typeof current.offsetTop === 'number') {
        top += current.offsetTop
        current = current.offsetParent
    }
    return top
}

export const MIN_PREVIEW_HEIGHT = 420
// Room left under the frame for the project card's own bottom padding, so the frame ends at the
// bottom of the window and nothing of the app shows below it.
export const PREVIEW_BOTTOM_GAP = 24

// The height that lets a framed artifact (a web page, a PDF) fill the window from where it starts
// down to the bottom edge (AT-2879). Measured on layout and on every resize; never below
// MIN_PREVIEW_HEIGHT, so a short window still shows a usable frame and scrolls instead.
export function computePreviewHeight(windowHeight, top) {
    const available = (Number(windowHeight) || 0) - (Number(top) || 0) - PREVIEW_BOTTOM_GAP
    return Math.max(MIN_PREVIEW_HEIGHT, Math.round(available))
}

function useFillHeight(ref) {
    const [, windowHeight] = useWindowSize()
    const [top, setTop] = useState(null)
    const measure = () => {
        const node = ref.current
        if (!node || typeof node.offsetTop !== 'number') return
        const next = getUnscrolledTop(node)
        setTop(current => (current === next ? current : next))
    }
    useEffect(measure, [windowHeight])
    return [top === null ? null : computePreviewHeight(windowHeight, top), measure]
}

// Whether the page may ask the app for live project data (functions/Artifacts/artifactDataBridge.js).
// Only the owner switches it, and switching it on is confirmed, because it hands the page what every
// project member can see.
function LiveDataSetting({ projectId, artifact, isOwner, onError }) {
    const [confirming, setConfirming] = useState(false)
    const [saving, setSaving] = useState(false)

    useEffect(() => setConfirming(false), [artifact.id, artifact.dataAccess])

    const toggle = () => {
        if (!artifact.dataAccess && !confirming) return setConfirming(true)
        setSaving(true)
        setArtifactDataAccess(projectId, artifact.id, !artifact.dataAccess)
            .catch(onError)
            .finally(() => {
                setSaving(false)
                setConfirming(false)
            })
    }

    return (
        <View testID="artifact-live-data">
            <SectionLabel>{translate('Live project data')}</SectionLabel>
            <View style={localStyles.visibilityRow}>
                <Text style={localStyles.body}>
                    {translate(artifact.dataAccess ? 'Artifact live data on' : 'Artifact live data off')}
                </Text>
                {isOwner && (
                    <TouchableOpacity
                        testID="artifact-toggle-live-data"
                        onPress={toggle}
                        disabled={saving}
                        accessible={false}
                    >
                        <Text style={localStyles.link}>
                            {translate(
                                artifact.dataAccess ? 'Switch off' : confirming ? 'Switch on live data' : 'Switch on'
                            )}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
            <Text style={localStyles.hint}>{translate('Artifact live data hint')}</Text>
            {confirming && (
                <View testID="artifact-live-data-warning" style={localStyles.warning}>
                    <Text style={localStyles.warningText}>{translate('Artifact live data warning')}</Text>
                    <TouchableOpacity
                        testID="artifact-live-data-cancel"
                        onPress={() => setConfirming(false)}
                        accessible={false}
                    >
                        <Text style={localStyles.link}>{translate('Cancel')}</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    )
}

function SectionLabel({ children }) {
    return <Text style={localStyles.sectionLabel}>{children}</Text>
}

function EditableField({ testID, value, placeholder, multiline, maxLength, onSave }) {
    const [draft, setDraft] = useState(value)
    const focused = useRef(false)

    useEffect(() => {
        if (!focused.current) setDraft(value)
    }, [value])

    const save = () => {
        focused.current = false
        const next = draft.trim()
        if (next !== value) onSave(next)
    }

    return (
        <TextInput
            testID={testID}
            value={draft}
            placeholder={placeholder}
            placeholderTextColor={colors.Text03}
            multiline={multiline}
            maxLength={maxLength}
            onFocus={() => (focused.current = true)}
            onChangeText={setDraft}
            onBlur={save}
            onSubmitEditing={multiline ? undefined : save}
            style={[localStyles.input, multiline && localStyles.inputMultiline]}
        />
    )
}

function VersionList({ projectId, artifact, versions, onError }) {
    if (versions.length === 0) return null
    return (
        <View testID="artifact-versions">
            <SectionLabel>{translate('Versions')}</SectionLabel>
            {versions.map(version => {
                const current = version.id === artifact.currentVersionId
                return (
                    <View key={version.id} style={localStyles.versionRow} testID={`artifact-version-${version.id}`}>
                        <View style={localStyles.versionTexts}>
                            <Text style={localStyles.versionTitle}>
                                {translate('Artifact version', { number: version.versionNumber })}
                                {current ? ` · ${translate('Current version')}` : ''}
                            </Text>
                            <Text style={localStyles.meta}>
                                {formatArtifactDate(version.createdAt)} · {formatArtifactSize(version.sizeBytes)}
                                {version.changeSummary ? ` · ${version.changeSummary}` : ''}
                            </Text>
                        </View>
                        {!current && (
                            <TouchableOpacity
                                testID={`artifact-restore-${version.id}`}
                                onPress={() =>
                                    restoreArtifactVersion(projectId, artifact.id, version.id).catch(onError)
                                }
                                accessible={false}
                            >
                                <Text style={localStyles.link}>{translate('Restore version')}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )
            })}
        </View>
    )
}

export default function ArtifactDetail({ projectId, artifactId, onBack }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const artifact = useArtifact(projectId, artifactId)
    const versions = useArtifactVersions(projectId, artifactId)
    const fileInput = useRef(null)
    const previewRef = useRef(null)
    const [previewHeight, measurePreview] = useFillHeight(previewRef)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [notice, setNotice] = useState('')
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [showAssistantForm, setShowAssistantForm] = useState(false)
    const [confirmOutsideShare, setConfirmOutsideShare] = useState(false)
    const [section, setSection] = useArtifactSection(projectId)
    const { uploading, error, uploadFiles } = useArtifactUploader({ projectId, artifactId })

    useEffect(() => {
        setNotice('')
        setConfirmDelete(false)
        setConfirmOutsideShare(false)
        setShowAssistantForm(false)
    }, [artifactId])

    const reportError = actionError => {
        console.warn('[artifacts] Action failed', { projectId, artifactId, error: actionError })
        // Offline every callable fails fast with code 'offline' (runHttpsCallableFunction).
        setNotice(
            translate(actionError?.code === 'offline' ? 'Artifact action needs internet' : 'Artifact action failed')
        )
    }

    const backLink = (
        <TouchableOpacity
            testID="artifact-back"
            style={localStyles.backLink}
            onPress={onBack}
            accessibilityLabel={translate('All artifacts')}
            accessibilityRole="button"
        >
            <Icon name="arrow-left" size={18} color={colors.Primary100} />
        </TouchableOpacity>
    )

    if (artifact === undefined) {
        return (
            <View style={localStyles.header}>
                {backLink}
                <Text style={localStyles.meta}>{translate('Loading artifact')}</Text>
            </View>
        )
    }
    if (artifact === null) {
        return (
            <View testID="artifact-not-found" style={localStyles.header}>
                {backLink}
                <Text style={localStyles.body}>{translate('Artifact not found')}</Text>
            </View>
        )
    }

    const isOwner = artifact.userId === loggedUserId
    const url = getArtifactUrl(projectId, artifact)

    const openFullScreen = () => {
        if (Platform.OS === 'web' && url) window.open(url, '_blank', 'noopener,noreferrer')
    }

    const resetLink = () =>
        resetArtifactLink(projectId, artifact.id)
            .then(() => setNotice(translate('Artifact link was reset')))
            .catch(reportError)

    // Lazy: HelperFunctions reaches the store and much of the app.
    const copyToClipboard = text => require('../../utils/HelperFunctions').copyTextToClipboard(text)

    // The in-app address: it needs sign-in and access to the artifact, like a note link.
    const copyAppLink = () => {
        copyToClipboard(`${window.location.origin}${getProjectArtifactsPath(projectId, artifact.id)}`)
        setNotice(translate('Artifact app link copied'))
    }

    // The serve address works without signing in, so handing it out is a deliberate act: the first
    // press explains what it means, the second copies.
    const copyOutsideLink = () => {
        if (!confirmOutsideShare) return setConfirmOutsideShare(true)
        if (url) copyToClipboard(url)
        setConfirmOutsideShare(false)
        setNotice(translate('Artifact outside link copied'))
    }

    const remove = () => {
        if (!confirmDelete) return setConfirmDelete(true)
        deleteArtifact(projectId, artifact.id).then(onBack).catch(reportError)
    }

    const showSection = nextSection => {
        setSection(nextSection)
        URLsArtifacts.push(getArtifactDetailsUrl(nextSection), null, projectId, artifact.id, artifact.title)
    }

    const toggleAssistantForm = () => {
        if (section !== ARTIFACT_SECTION_ARTIFACT) {
            showSection(ARTIFACT_SECTION_ARTIFACT)
            return setShowAssistantForm(true)
        }
        setShowAssistantForm(shown => !shown)
    }

    // One row above the artifact and nothing below it (AT-2879): back, title, the four sections
    // and the three things one does to the artifact itself. Everything else lives under Details.
    const header = (
        <View style={localStyles.header} testID="artifact-header">
            <View style={[localStyles.titleGroup, mobile && localStyles.titleGroupMobile]}>
                {backLink}
                <Icon name={getArtifactKindIcon(artifact.kind)} size={18} color={colors.Text02} />
                <Text style={localStyles.title} numberOfLines={1} testID="artifact-title">
                    {artifact.title}
                </Text>
                {artifact.isPrivate && <Icon name="lock" size={14} color={colors.Text03} />}
            </View>
            <SectionSwitch
                section={section}
                onChange={showSection}
                commentCount={Number(artifact.commentsData?.amount) || 0}
            />
            <View style={localStyles.headerActions}>
                <HeaderAction
                    testID="artifact-open-full-screen"
                    icon="maximize-2"
                    label={translate('Open full screen')}
                    onPress={openFullScreen}
                />
                <HeaderAction
                    testID="artifact-change-with-assistant"
                    icon="message-circle"
                    label={translate('Change with assistant')}
                    onPress={toggleAssistantForm}
                    active={showAssistantForm && section === ARTIFACT_SECTION_ARTIFACT}
                />
                <HeaderAction
                    testID="artifact-upload-version"
                    icon="upload"
                    label={translate('Upload new version')}
                    onPress={() => fileInput.current?.open()}
                    disabled={uploading}
                />
                <ArtifactFileInput ref={fileInput} onFiles={uploadFiles} />
            </View>
        </View>
    )

    return (
        <View testID={`artifact-detail-${artifact.id}`}>
            {header}
            <ArtifactUploadStatus uploading={uploading} error={error} />

            {section === ARTIFACT_SECTION_CHAT ? (
                <ArtifactChat key={artifact.id} projectId={projectId} artifact={artifact} />
            ) : section === ARTIFACT_SECTION_UPDATES ? (
                <ArtifactHistory key={artifact.id} projectId={projectId} artifactId={artifact.id} />
            ) : section === ARTIFACT_SECTION_DETAILS ? (
                <View style={localStyles.properties} testID="artifact-details">
                    <SectionLabel>{translate('Title')}</SectionLabel>
                    <EditableField
                        testID="artifact-title-input"
                        value={artifact.title}
                        maxLength={MAX_ARTIFACT_TITLE_CHARS}
                        onSave={title =>
                            title && updateArtifactMetadata(projectId, artifact.id, { title }).catch(reportError)
                        }
                    />
                    <SectionLabel>{translate('Description')}</SectionLabel>
                    <EditableField
                        testID="artifact-description-input"
                        value={artifact.description}
                        placeholder={translate('Artifact description placeholder')}
                        multiline
                        maxLength={MAX_ARTIFACT_DESCRIPTION_CHARS}
                        onSave={description =>
                            updateArtifactMetadata(projectId, artifact.id, { description }).catch(reportError)
                        }
                    />

                    <SectionLabel>{translate('Visibility')}</SectionLabel>
                    <View style={localStyles.visibilityRow}>
                        <Text style={localStyles.body}>
                            {translate(artifact.isPrivate ? 'Only visible to you' : 'Visible to the project')}
                        </Text>
                        {isOwner && (
                            <TouchableOpacity
                                testID="artifact-toggle-privacy"
                                onPress={() =>
                                    setArtifactPrivacy(projectId, artifact, !artifact.isPrivate).catch(reportError)
                                }
                                accessible={false}
                            >
                                <Text style={localStyles.link}>
                                    {translate(artifact.isPrivate ? 'Share with the project' : 'Make private')}
                                </Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {artifact.kind === ARTIFACT_KINDS.WEB && (
                        <LiveDataSetting
                            projectId={projectId}
                            artifact={artifact}
                            isOwner={isOwner}
                            onError={reportError}
                        />
                    )}

                    <Text style={localStyles.meta} testID="artifact-meta">
                        {artifact.entryPath} · {formatArtifactSize(artifact.sizeBytes)} ·{' '}
                        {translate(getArtifactSourceLabelKey(artifact.source))} ·{' '}
                        {translate('Artifact edited at', { date: formatArtifactDate(artifact.lastEditionDate) })}
                    </Text>

                    <ArtifactContextLink
                        projectId={projectId}
                        artifact={artifact}
                        onOpen={source => openUploadSource(projectId, source)}
                        testID="artifact-context"
                    />

                    <ArtifactBacklinks projectId={projectId} artifactId={artifact.id} />

                    <VersionList projectId={projectId} artifact={artifact} versions={versions} onError={reportError} />

                    <SectionLabel>{translate('Link')}</SectionLabel>
                    <Text style={localStyles.hint}>{translate('Artifact reset link hint')}</Text>
                    <View style={localStyles.actions}>
                        <Button
                            type="ghost"
                            icon="link"
                            title={translate('Copy link')}
                            onPress={copyAppLink}
                            buttonStyle={localStyles.actionButton}
                        />
                        <Button
                            type="ghost"
                            icon="share-2"
                            title={translate(
                                confirmOutsideShare ? 'Copy link for outside' : 'Share outside the project'
                            )}
                            onPress={copyOutsideLink}
                            buttonStyle={localStyles.actionButton}
                        />
                        <Button
                            type="ghost"
                            icon="refresh-cw"
                            title={translate('Reset link')}
                            onPress={resetLink}
                            buttonStyle={localStyles.actionButton}
                        />
                        <Button
                            type="ghost"
                            icon="trash-2"
                            title={translate(confirmDelete ? 'Really delete artifact' : 'Delete artifact')}
                            onPress={remove}
                            buttonStyle={localStyles.actionButton}
                        />
                    </View>
                    {confirmOutsideShare && (
                        <View testID="artifact-outside-share-warning" style={localStyles.warning}>
                            <Text style={localStyles.warningText}>{translate('Artifact outside share warning')}</Text>
                            <TouchableOpacity
                                testID="artifact-outside-share-cancel"
                                onPress={() => setConfirmOutsideShare(false)}
                                accessible={false}
                            >
                                <Text style={localStyles.link}>{translate('Cancel')}</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                    {!!notice && (
                        <Text testID="artifact-notice" style={localStyles.hint}>
                            {notice}
                        </Text>
                    )}
                </View>
            ) : (
                <>
                    {showAssistantForm && (
                        <ArtifactAssistantForm
                            projectId={projectId}
                            artifact={artifact}
                            onClose={() => setShowAssistantForm(false)}
                            onSent={() => {
                                setShowAssistantForm(false)
                                showSection(ARTIFACT_SECTION_CHAT)
                            }}
                        />
                    )}
                    <View
                        ref={previewRef}
                        onLayout={measurePreview}
                        style={localStyles.preview}
                        testID="artifact-preview-area"
                    >
                        <ArtifactPreview projectId={projectId} artifact={artifact} height={previewHeight} />
                    </View>
                </>
            )}
        </View>
    )
}

const webStyles = {
    tooltip: {
        display: 'inline-flex',
    },
}

const localStyles = StyleSheet.create({
    warning: {
        marginTop: 4,
        padding: 10,
        borderRadius: 4,
        backgroundColor: colors.UtilityYellow112,
        maxWidth: 720,
    },
    warningText: {
        ...styles.body2,
        color: colors.Text01,
        marginBottom: 6,
    },
    header: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
    },
    titleGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        minWidth: 0,
        maxWidth: 480,
        marginRight: 20,
        paddingVertical: 6,
    },
    titleGroupMobile: {
        width: '100%',
        maxWidth: '100%',
        marginRight: 0,
    },
    title: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginHorizontal: 6,
        flexShrink: 1,
    },
    sectionSwitch: {
        flexDirection: 'row',
        alignSelf: 'stretch',
        alignItems: 'flex-end',
    },
    sectionTab: {
        paddingVertical: 10,
        marginRight: 16,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
        marginBottom: -1,
    },
    sectionTabActive: {
        borderBottomColor: colors.Primary100,
    },
    sectionTabText: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    sectionTabTextActive: {
        color: colors.Primary100,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 'auto',
    },
    headerAction: {
        width: 32,
        height: 32,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
    },
    headerActionActive: {
        backgroundColor: colors.Grey200,
    },
    backLink: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 4,
        marginLeft: -6,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 12,
    },
    actionButton: {
        marginRight: 8,
        marginBottom: 8,
    },
    preview: {
        marginTop: 8,
    },
    properties: {
        paddingTop: 8,
        maxWidth: 720,
    },
    sectionLabel: {
        ...styles.overline,
        color: colors.Text03,
        marginTop: 16,
        marginBottom: 6,
    },
    input: {
        ...styles.body1,
        color: colors.Text01,
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#FFFFFF',
    },
    inputMultiline: {
        minHeight: 72,
        textAlignVertical: 'top',
    },
    visibilityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        marginBottom: 8,
    },
    body: {
        ...styles.body2,
        color: colors.Text01,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
    hint: {
        ...styles.caption2,
        color: colors.Text02,
    },
    link: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
    versionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
    },
    versionTexts: {
        flex: 1,
        minWidth: 0,
        marginRight: 8,
    },
    versionTitle: {
        ...styles.subtitle2,
        color: colors.Text01,
    },
})
