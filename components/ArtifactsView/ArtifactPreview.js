import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import useWindowSize from '../../utils/useWindowSize'
import WikiMarkdown from '../WikiView/WikiMarkdown'
import { ARTIFACT_KINDS } from '../../functions/Artifacts/artifactModel'
import { getArtifactUrl } from '../../utils/backends/Artifacts/artifactsFirestore'
import { canPreviewArtifact, getArtifactKindIcon, isInlineTextArtifact } from './artifactPresentation'
import { ARTIFACT_BRIDGE_SANDBOX } from '../../functions/Artifacts/artifactDataBridge'
import useArtifactDataBridge from './useArtifactDataBridge'
import useArtifactFrameHeight from './useArtifactFrameHeight'

// The second line of defence for an HTML artifact. The first is the CSP sandbox serveArtifact sends
// with it; both deliberately leave out allow-same-origin and allow-top-navigation, so the page can
// run its own script but can neither read storage nor navigate the app away.
export const ARTIFACT_IFRAME_SANDBOX =
    'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'

const MIN_FRAME_HEIGHT = 420
const FRAME_HEIGHT_OFFSET = 260

function useArtifactText(url, enabled) {
    const [state, setState] = useState({ text: null, failed: false })

    useEffect(() => {
        setState({ text: null, failed: false })
        if (!enabled || !url || typeof fetch !== 'function') return undefined
        let cancelled = false
        fetch(url, { referrerPolicy: 'no-referrer' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                return response.text()
            })
            .then(text => !cancelled && setState({ text, failed: false }))
            .catch(() => !cancelled && setState({ text: null, failed: true }))
        return () => {
            cancelled = true
        }
    }, [url, enabled])

    return state
}

function PreviewMessage({ icon = 'info', text, children, testID }) {
    return (
        <View testID={testID} style={localStyles.message}>
            <Icon name={icon} size={28} color={colors.Text03} />
            <Text style={localStyles.messageText}>{text}</Text>
            {children}
        </View>
    )
}

function DownloadLink({ url, fileName }) {
    if (Platform.OS !== 'web' || !url) return null
    return (
        <a href={url} download={fileName} target="_blank" rel="noopener noreferrer" style={webStyles.link}>
            {translate('Download')}
        </a>
    )
}

// An HTML artifact in a frame. A data-bound one (artifact.dataAccess) is framed at the bridge
// address with nothing but scripts allowed and answered by the app (useArtifactDataBridge). With
// `autoHeight` the frame takes the height the page reports (useArtifactFrameHeight, AT-2881), so it
// has no scrollbar of its own and the page around it scrolls; until the page reports, and if it never
// does, it keeps `height`. Keyed by its address by the caller.
function ArtifactWebFrame({ projectId, artifact, versionId, height, autoHeight }) {
    const frameRef = useRef(null)
    const bridge = !!artifact.dataAccess
    const url = getArtifactUrl(projectId, artifact, { versionId, bridge })
    const runQuery = useCallback(
        request => require('../../utils/backends/Artifacts/artifactBridgeData').runBridgeQuery(projectId, request),
        [projectId]
    )
    const onLoad = useArtifactDataBridge({ frameRef, enabled: bridge, runQuery })
    const contentHeight = useArtifactFrameHeight({ frameRef, enabled: !!autoHeight })
    return (
        <iframe
            ref={frameRef}
            data-testid="artifact-preview-frame"
            data-bridge={bridge ? 'true' : undefined}
            data-natural-height={contentHeight === null ? undefined : 'true'}
            title={artifact.title}
            src={url}
            sandbox={bridge ? ARTIFACT_BRIDGE_SANDBOX : ARTIFACT_IFRAME_SANDBOX}
            referrerPolicy="no-referrer"
            onLoad={bridge ? onLoad : undefined}
            style={{ ...webStyles.frame, height: contentHeight === null ? height : contentHeight }}
        />
    )
}

// `height` fixes the frame height, for a preview embedded in something else (a note). `autoHeight`
// lets an HTML page grow to its natural height instead (the detail view); `height` is then only
// what it shows until the page has said how tall it is.
export default function ArtifactPreview({ projectId, artifact, versionId = null, height = null, autoHeight = false }) {
    const offline = useSelector(state => state.connectionState === 'offline')
    const [, windowHeight] = useWindowSize()
    const url = getArtifactUrl(projectId, artifact, { versionId })
    const inlineText = isInlineTextArtifact(artifact)
    const { text, failed } = useArtifactText(url, inlineText && !offline)
    const frameHeight = height || Math.max(MIN_FRAME_HEIGHT, (Number(windowHeight) || 0) - FRAME_HEIGHT_OFFSET)
    const fileName = artifact?.entryPath?.split('/').pop() || artifact?.title

    if (!artifact) return null
    // Every preview is a network request to serveArtifact; offline it would only ever spin.
    if (offline)
        return <PreviewMessage testID="artifact-preview-offline" text={translate('Artifact preview needs internet')} />
    if (!url) return null

    if (!canPreviewArtifact(artifact) || Platform.OS !== 'web') {
        return (
            <PreviewMessage
                testID="artifact-preview-none"
                icon={getArtifactKindIcon(artifact.kind)}
                text={translate('No preview for this file type')}
            >
                <DownloadLink url={url} fileName={fileName} />
            </PreviewMessage>
        )
    }

    switch (artifact.kind) {
        case ARTIFACT_KINDS.WEB:
            return (
                <ArtifactWebFrame
                    key={url + (artifact.dataAccess ? '#bridge' : '')}
                    projectId={projectId}
                    artifact={artifact}
                    versionId={versionId}
                    height={frameHeight}
                    autoHeight={autoHeight}
                />
            )
        // Chrome refuses to render a PDF inside a sandboxed frame. A PDF is not a document that can
        // run script on the page, and serveArtifact sends it without the sandbox too.
        case ARTIFACT_KINDS.PDF:
            return (
                <iframe
                    key={url}
                    data-testid="artifact-preview-pdf"
                    title={artifact.title}
                    src={url}
                    referrerPolicy="no-referrer"
                    style={{ ...webStyles.frame, height: frameHeight }}
                />
            )
        case ARTIFACT_KINDS.IMAGE:
            return (
                <View style={localStyles.mediaContainer}>
                    <img data-testid="artifact-preview-image" src={url} alt={artifact.title} style={webStyles.image} />
                </View>
            )
        case ARTIFACT_KINDS.VIDEO:
            return <video data-testid="artifact-preview-video" src={url} controls style={webStyles.video} />
        case ARTIFACT_KINDS.AUDIO:
            return <audio data-testid="artifact-preview-audio" src={url} controls style={webStyles.audio} />
        default:
            break
    }

    if (!inlineText) {
        return (
            <PreviewMessage
                testID="artifact-preview-none"
                icon={getArtifactKindIcon(artifact.kind)}
                text={translate('No preview for this file type')}
            >
                <DownloadLink url={url} fileName={fileName} />
            </PreviewMessage>
        )
    }
    if (failed)
        return (
            <PreviewMessage
                testID="artifact-preview-failed"
                icon="alert-circle"
                text={translate('Artifact preview failed')}
            />
        )
    if (text === null) return <Text style={localStyles.loading}>{translate('Loading artifact')}</Text>

    if (artifact.kind === ARTIFACT_KINDS.MARKDOWN) {
        return (
            <View testID="artifact-preview-markdown" style={localStyles.textContainer}>
                <WikiMarkdown body={text} />
            </View>
        )
    }
    return (
        <ScrollView horizontal style={localStyles.textContainer} testID="artifact-preview-text">
            <Text selectable style={localStyles.monospace}>
                {text}
            </Text>
        </ScrollView>
    )
}

const webStyles = {
    frame: {
        width: '100%',
        border: `1px solid ${colors.Grey300}`,
        borderRadius: 8,
        backgroundColor: '#FFFFFF',
        display: 'block',
        // The height is the frame's viewport, which is what a page reports as its own height.
        boxSizing: 'content-box',
    },
    image: {
        maxWidth: '100%',
        borderRadius: 8,
        display: 'block',
    },
    video: {
        width: '100%',
        borderRadius: 8,
        backgroundColor: '#000000',
    },
    audio: {
        width: '100%',
    },
    link: {
        color: colors.Primary100,
        marginTop: 12,
        fontFamily: 'Roboto-Medium, Roboto, sans-serif',
        fontSize: 14,
        textDecoration: 'none',
    },
}

const localStyles = StyleSheet.create({
    message: {
        alignItems: 'center',
        paddingVertical: 40,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: colors.Grey100,
    },
    messageText: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 8,
        textAlign: 'center',
    },
    mediaContainer: {
        alignItems: 'flex-start',
    },
    loading: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 8,
    },
    textContainer: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Grey300,
        padding: 16,
        backgroundColor: '#FFFFFF',
    },
    monospace: {
        fontFamily: 'monospace',
        fontSize: 13,
        lineHeight: 20,
        color: colors.Text01,
    },
})
