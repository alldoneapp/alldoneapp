import React, { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import WorkspaceModal from '../UIComponents/ModalShell/WorkspaceModal'
import useSafeAreaOverlayPadding from '../../hooks/useSafeAreaOverlayPadding'
import { translate } from '../../i18n/TranslationService'
import { ARTIFACT_KINDS } from '../../functions/Artifacts/artifactModel'
import { canShowLinkedUploadInline, getArtifactKindIcon, getArtifactKindTint } from './artifactPresentation'

const OVERLAY_GAP = { top: 16, bottom: 16, left: 16, right: 16 }

function HeaderButton({ icon, label, onPress, testID }) {
    return (
        <TouchableOpacity
            testID={testID}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={localStyles.headerButton}
        >
            <Icon name={icon} size={20} color="#FFFFFF" />
        </TouchableOpacity>
    )
}

function ArrowButton({ direction, onPress }) {
    return (
        <TouchableOpacity
            testID={`artifact-viewer-${direction}`}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={translate(direction === 'previous' ? 'Previous file' : 'Next file')}
            style={[localStyles.arrow, direction === 'previous' ? localStyles.arrowLeft : localStyles.arrowRight]}
        >
            <Icon name={direction === 'previous' ? 'chevron-left' : 'chevron-right'} size={28} color="#FFFFFF" />
        </TouchableOpacity>
    )
}

// What the browser can draw without running anything, or a card that hands the file to a new tab.
function FileStage({ file, failed, onFailed, onOpenInTab, onOpenSource }) {
    if (Platform.OS === 'web' && !failed && canShowLinkedUploadInline(file)) {
        if (file.kind === ARTIFACT_KINDS.IMAGE)
            return (
                <View style={localStyles.mediaFrame}>
                    <img
                        key={file.url}
                        data-testid="artifact-viewer-image"
                        src={file.url}
                        alt={file.title}
                        referrerPolicy="no-referrer"
                        onError={onFailed}
                        style={webStyles.image}
                    />
                </View>
            )
        if (file.kind === ARTIFACT_KINDS.VIDEO)
            return (
                <View style={localStyles.mediaFrame}>
                    <video
                        key={file.url}
                        data-testid="artifact-viewer-video"
                        src={file.url}
                        controls
                        playsInline
                        onError={onFailed}
                        style={webStyles.video}
                    />
                </View>
            )
    }

    const tint = getArtifactKindTint(file.kind)
    const audio = Platform.OS === 'web' && !failed && canShowLinkedUploadInline(file)
    return (
        <View style={localStyles.mediaFrame}>
            <View testID="artifact-viewer-card" style={localStyles.card}>
                <View style={[localStyles.cardIcon, { backgroundColor: tint.background }]}>
                    <Icon name={getArtifactKindIcon(file.kind)} size={28} color={tint.icon} />
                </View>
                <Text style={localStyles.cardTitle} numberOfLines={2}>
                    {file.title}
                </Text>
                {audio ? (
                    <audio
                        key={file.url}
                        data-testid="artifact-viewer-audio"
                        src={file.url}
                        controls
                        onError={onFailed}
                        style={webStyles.audio}
                    />
                ) : (
                    <Text style={localStyles.cardText}>
                        {translate(failed ? 'Artifact preview failed' : 'No preview for this file type')}
                    </Text>
                )}
                <View style={localStyles.cardActions}>
                    {!!file.url && (
                        <TouchableOpacity
                            testID="artifact-viewer-card-open"
                            onPress={onOpenInTab}
                            style={[localStyles.cardButton, localStyles.cardButtonPrimary]}
                        >
                            <Icon name="external-link" size={16} color="#FFFFFF" />
                            <Text style={[localStyles.cardButtonText, localStyles.cardButtonTextPrimary]}>
                                {translate('Open full screen')}
                            </Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        testID="artifact-viewer-card-source"
                        onPress={onOpenSource}
                        style={localStyles.cardButton}
                    >
                        <Icon name="link" size={16} color={colors.Text02} />
                        <Text style={localStyles.cardButtonText}>{translate('Open upload source')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    )
}

// Shows the files behind a project's linked uploads where they are listed, instead of sending the
// user to the task or note that holds them. It reads the address the source itself embeds (see
// mergeLinkedUploads), so it shows nothing a reader of that source could not already open. The
// arrows and ←/→ walk through `files`, the uploads of the list as it is filtered.
export default function ArtifactFileViewer({ files, fileId, onSelect, onClose, onOpenSource }) {
    const index = files.findIndex(file => file.id === fileId)
    const file = index >= 0 ? files[index] : null
    const count = files.length
    const padding = useSafeAreaOverlayPadding(OVERLAY_GAP)
    const [failedUrl, setFailedUrl] = useState(null)

    const step = delta => {
        if (count > 1) onSelect(files[(index + delta + count) % count].id)
    }

    // The file left the list (its source was removed or became private): nothing left to show.
    useEffect(() => {
        if (fileId && !file) onClose()
    }, [fileId, !!file])

    useEffect(() => {
        if (!file || count < 2 || typeof document === 'undefined') return undefined
        const onKeyDown = event => {
            if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
            // A focused player seeks with the arrows.
            if (['VIDEO', 'AUDIO', 'INPUT', 'TEXTAREA'].includes(event.target?.tagName)) return
            if (event.key === 'ArrowLeft') step(-1)
            else if (event.key === 'ArrowRight') step(1)
            else return
            event.preventDefault()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [file?.id, index, count])

    if (!file) return null

    const openInTab = () => {
        if (Platform.OS === 'web' && file.url) window.open(file.url, '_blank', 'noopener,noreferrer')
    }
    const openSource = () => onOpenSource(file)
    const sourceTitle = file.linkedSources?.[0]?.title || translate('File')

    return (
        <WorkspaceModal visible onRequestClose={onClose}>
            <View testID="artifact-file-viewer" style={[localStyles.overlay, padding]}>
                <TouchableOpacity
                    testID="artifact-viewer-backdrop"
                    accessible={false}
                    activeOpacity={1}
                    onPress={onClose}
                    style={localStyles.backdrop}
                />
                <View style={localStyles.header}>
                    <View style={localStyles.headerTexts}>
                        <Text style={localStyles.title} numberOfLines={1}>
                            {file.title}
                        </Text>
                        <Text style={localStyles.subtitle} numberOfLines={1}>
                            {count > 1 ? `${index + 1} / ${count} · ` : ''}
                            {translate('Artifact upload in', { title: sourceTitle })}
                        </Text>
                    </View>
                    <HeaderButton
                        testID="artifact-viewer-source"
                        icon="link"
                        label={translate('Open upload source')}
                        onPress={openSource}
                    />
                    {!!file.url && (
                        <HeaderButton
                            testID="artifact-viewer-open"
                            icon="external-link"
                            label={translate('Open full screen')}
                            onPress={openInTab}
                        />
                    )}
                    <HeaderButton
                        testID="artifact-viewer-close"
                        icon="x"
                        label={translate('Close')}
                        onPress={onClose}
                    />
                </View>
                <View style={localStyles.stage}>
                    <FileStage
                        file={file}
                        failed={!file.url || failedUrl === file.url}
                        onFailed={() => setFailedUrl(file.url)}
                        onOpenInTab={openInTab}
                        onOpenSource={openSource}
                    />
                    {count > 1 && <ArrowButton direction="previous" onPress={() => step(-1)} />}
                    {count > 1 && <ArrowButton direction="next" onPress={() => step(1)} />}
                </View>
            </View>
        </WorkspaceModal>
    )
}

const webStyles = {
    image: {
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain',
        display: 'block',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
        backgroundColor: '#FFFFFF',
    },
    video: {
        maxWidth: '100%',
        maxHeight: '100%',
        display: 'block',
        borderRadius: 4,
        backgroundColor: '#000000',
    },
    audio: {
        width: '100%',
        marginTop: 16,
    },
}

const localStyles = StyleSheet.create({
    // WorkspaceModal's dialog is the fixed, viewport-sized box; this fills it.
    overlay: {
        flex: 1,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(4, 20, 47, 0.88)',
        cursor: 'default',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 48,
        marginBottom: 12,
    },
    headerTexts: {
        flex: 1,
        minWidth: 0,
        marginRight: 8,
    },
    title: {
        ...styles.subtitle1,
        color: '#FFFFFF',
    },
    subtitle: {
        ...styles.caption2,
        color: colors.Grey400,
        marginTop: 2,
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
    },
    // Empty stage space belongs to the backdrop behind it, so a click beside the file closes.
    stage: {
        flex: 1,
        minHeight: 0,
        pointerEvents: 'box-none',
    },
    // Absolutely placed so the image's percentage caps resolve against a definite box.
    mediaFrame: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'box-none',
    },
    arrow: {
        position: 'absolute',
        top: '50%',
        marginTop: -24,
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.16)',
    },
    arrowLeft: {
        left: 0,
    },
    arrowRight: {
        right: 0,
    },
    card: {
        width: '100%',
        maxWidth: 420,
        alignItems: 'center',
        padding: 24,
        borderRadius: 8,
        backgroundColor: colors.Secondary400,
    },
    cardIcon: {
        width: 64,
        height: 64,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardTitle: {
        ...styles.subtitle1,
        color: '#FFFFFF',
        marginTop: 16,
        textAlign: 'center',
    },
    cardText: {
        ...styles.body2,
        color: colors.Grey400,
        marginTop: 8,
        textAlign: 'center',
    },
    cardActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 16,
    },
    cardButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 4,
        margin: 4,
        backgroundColor: colors.Grey200,
    },
    cardButtonPrimary: {
        backgroundColor: colors.Primary100,
    },
    cardButtonText: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginLeft: 6,
    },
    cardButtonTextPrimary: {
        color: '#FFFFFF',
    },
})
