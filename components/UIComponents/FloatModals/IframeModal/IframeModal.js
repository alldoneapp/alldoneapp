import React, { useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View, Text, TouchableOpacity, Modal } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Icon from '../../../Icon'
import { colors, hexColorToRGBa } from '../../../styles/global'
import { setIframeModalData } from '../../../../redux/actions'
import useEscapeKey from '../../../../hooks/useEscapeKey'
import useSafeAreaOverlayPadding from '../../../../hooks/useSafeAreaOverlayPadding'
import { runHttpsCallableFunction } from '../../../../utils/backends/firestore'
import NavigationService from '../../../../utils/NavigationService'
import URLTrigger from '../../../../URLSystem/URLTrigger'
import {
    ALLDONE_ROADMAP_PROTOCOL_VERSION,
    getActiveRoadmapProjects,
    getRoadmapNavigationPath,
    subscribeToRoadmapProject,
} from '../../../../utils/roadmapSourceBridge'

// The only messages this modal speaks. The window `message` event is a shared
// bus, not a private channel: react-native-web's scheduler runs on the
// `setimmediate` polyfill, which implements setImmediate as
// `window.postMessage('setImmediate$<rand>$<handle>', '*')` on OUR OWN window —
// so every scheduled tick delivers a same-origin string here. Treating those as
// "a message from the iframe that failed the origin check" logged a warning per
// tick (hundreds while a modal is open) and buried a real cross-origin attempt
// in the noise. Anything not shaped like our protocol is dropped silently; the
// origin check below still guards every message that IS.
const ROADMAP_MESSAGE_TYPES = new Set([
    'ROADMAP_PROJECTS_REQUEST',
    'ROADMAP_PROJECT_SUBSCRIBE',
    'ROADMAP_PROJECT_UNSUBSCRIBE',
    'ROADMAP_OPEN_ENTITY',
])
const IFRAME_MESSAGE_TYPES = new Set(['GET_USER_DATA', 'DEDUCT_GOLD', 'REFUND_GOLD', ...ROADMAP_MESSAGE_TYPES])

const isRoadmapUrl = url => {
    try {
        const path = new URL(url).pathname
        return path === '/embed/create-roadmap' || path.includes('/paul-product-manager/create-roadmap')
    } catch (error) {
        return false
    }
}

export default function IframeModal() {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const dispatch = useDispatch()
    const iframeModalData = useSelector(state => state.iframeModalData)
    const { visible, url, name } = iframeModalData

    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const iframeRef = useRef(null)

    const finalUrl = url
    const roadmapProjects = useMemo(
        () => getActiveRoadmapProjects(loggedUserProjects, loggedUser),
        [loggedUserProjects, loggedUser]
    )
    const loggedUserRef = useRef(loggedUser)
    const roadmapProjectsRef = useRef(roadmapProjects)
    loggedUserRef.current = loggedUser
    roadmapProjectsRef.current = roadmapProjects

    const closeModal = () => {
        dispatch(setIframeModalData(false, '', ''))
    }

    // Escape only — no backdrop-press dismiss on purpose: the iframe hosts
    // live third-party surfaces (screen share, mic) where a stray outside tap
    // must not tear the session down.
    useEscapeKey(closeModal, { enabled: !!visible })

    useEffect(() => {
        if (!visible) return

        let trustedOrigin = null
        let unsubscribeRoadmapProject = null

        try {
            trustedOrigin = finalUrl ? new URL(finalUrl).origin : null
        } catch (error) {
            console.error('IframeModal: invalid iframe URL', {
                url: finalUrl,
                error: error.message,
            })
        }

        const handleMessage = async event => {
            // Not addressed to us (our own scheduler, an SDK, a browser
            // extension): ignore without a word.
            if (event.source === window) return

            const messageType = event?.data?.type
            if (typeof messageType !== 'string' || !IFRAME_MESSAGE_TYPES.has(messageType)) return

            // A trusted origin can host many tools. Require both the exact iframe
            // window and the roadmap capability URL before exposing project data.
            if (event.source !== iframeRef.current?.contentWindow) return

            if (!trustedOrigin || event.origin !== trustedOrigin) {
                console.warn('IframeModal: ignoring message from untrusted origin', {
                    origin: event.origin,
                    trustedOrigin,
                    type: messageType,
                })
                return
            }

            const { type, amount } = event.data

            if (ROADMAP_MESSAGE_TYPES.has(type)) {
                if (!isRoadmapUrl(finalUrl) || event.data.protocolVersion !== ALLDONE_ROADMAP_PROTOCOL_VERSION) return
            }

            console.log('IframeModal: message received from iframe', {
                origin: event.origin,
                type,
                amount,
                userEmail: loggedUserRef.current?.email || '',
            })

            const postResult = message => {
                console.log('IframeModal: posting message to iframe', {
                    origin: event.origin,
                    messageType: message?.type,
                    newBalance: message?.newBalance,
                    error: message?.error,
                })
                event.source.postMessage(message, event.origin)
            }

            const handleGoldRequest = async ({ callableName, successType, errorType, errorLogLabel, source }) => {
                if (!Number.isFinite(amount) || amount <= 0) {
                    postResult({
                        type: errorType,
                        error: 'Invalid gold amount',
                    })
                    return
                }

                try {
                    console.log('IframeModal: calling gold function', {
                        callableName,
                        amount,
                        userEmail: loggedUserRef.current?.email || '',
                    })

                    // Routed through the offline-aware funnel (AT-2340): a gold
                    // change is server-authoritative, so offline this now fails
                    // immediately and the embedded surface gets a clean error
                    // instead of a ~70s hang. The funnel unwraps the envelope.
                    const result = await runHttpsCallableFunction(callableName, {
                        gold: amount,
                        source,
                        channel: 'iframe',
                    })

                    console.log('IframeModal: gold function responded', {
                        callableName,
                        amount,
                        result,
                    })

                    if (result.success) {
                        postResult({
                            type: successType,
                            newBalance: result.newBalance,
                        })
                    } else {
                        postResult({
                            type: errorType,
                            error: result.message,
                        })
                    }
                } catch (error) {
                    console.error(errorLogLabel, error)
                    postResult({
                        type: errorType,
                        error: error.message,
                    })
                }
            }

            if (type === 'GET_USER_DATA') {
                postResult({
                    type: 'USER_DATA',
                    user: {
                        email: loggedUserRef.current?.email,
                        name: loggedUserRef.current?.userName || loggedUserRef.current?.name,
                        gold: loggedUserRef.current?.gold || 0,
                    },
                })
            }

            if (type === 'DEDUCT_GOLD') {
                console.log('IframeModal: processing DEDUCT_GOLD request', { amount })
                await handleGoldRequest({
                    callableName: 'deductGoldSecondGen',
                    successType: 'DEDUCT_GOLD_SUCCESS',
                    errorType: 'DEDUCT_GOLD_ERROR',
                    errorLogLabel: 'Error deducting gold:',
                    source: 'iframe_deduction',
                })
            }

            if (type === 'REFUND_GOLD') {
                console.log('IframeModal: processing REFUND_GOLD request', { amount })
                await handleGoldRequest({
                    callableName: 'refundGoldSecondGen',
                    successType: 'REFUND_GOLD_SUCCESS',
                    errorType: 'REFUND_GOLD_ERROR',
                    errorLogLabel: 'Error refunding gold:',
                    source: 'iframe_refund',
                })
            }

            if (type === 'ROADMAP_PROJECTS_REQUEST') {
                postResult({
                    type: 'ROADMAP_PROJECTS',
                    protocolVersion: ALLDONE_ROADMAP_PROTOCOL_VERSION,
                    projects: roadmapProjectsRef.current,
                })
            }

            if (type === 'ROADMAP_PROJECT_SUBSCRIBE') {
                const project = roadmapProjectsRef.current.find(candidate => candidate.id === event.data.projectId)
                if (!project || !loggedUserRef.current?.uid) {
                    postResult({
                        type: 'ROADMAP_PROJECT_ERROR',
                        protocolVersion: ALLDONE_ROADMAP_PROTOCOL_VERSION,
                        projectId: event.data.projectId,
                        error: 'This project is not available.',
                    })
                    return
                }

                unsubscribeRoadmapProject?.()
                unsubscribeRoadmapProject = subscribeToRoadmapProject({
                    projectId: project.id,
                    userId: loggedUserRef.current.uid,
                    onSnapshot: snapshot =>
                        postResult({
                            type: 'ROADMAP_PROJECT_SNAPSHOT',
                            protocolVersion: ALLDONE_ROADMAP_PROTOCOL_VERSION,
                            snapshot,
                        }),
                    onError: error =>
                        postResult({
                            type: 'ROADMAP_PROJECT_ERROR',
                            protocolVersion: ALLDONE_ROADMAP_PROTOCOL_VERSION,
                            projectId: project.id,
                            error: error?.message || 'Could not read this project.',
                        }),
                })
            }

            if (type === 'ROADMAP_PROJECT_UNSUBSCRIBE') {
                unsubscribeRoadmapProject?.()
                unsubscribeRoadmapProject = null
            }

            if (type === 'ROADMAP_OPEN_ENTITY') {
                const hasProjectAccess = roadmapProjectsRef.current.some(project => project.id === event.data.projectId)
                if (!hasProjectAccess) return
                const path = getRoadmapNavigationPath({
                    projectId: event.data.projectId,
                    userId: loggedUserRef.current?.uid,
                    entityType: event.data.entityType,
                    entityId: event.data.entityId,
                })
                if (!path) return
                closeModal()
                URLTrigger.processUrl(NavigationService, path)
            }
        }

        window.addEventListener('message', handleMessage)
        return () => {
            window.removeEventListener('message', handleMessage)
            unsubscribeRoadmapProject?.()
        }
    }, [visible, dispatch, finalUrl])

    // Push active-project list changes as well as answering explicit requests.
    // This covers the iframe opening before the app's project watcher has delivered.
    useEffect(() => {
        if (!visible || !isRoadmapUrl(finalUrl) || !iframeRef.current?.contentWindow) return
        let targetOrigin
        try {
            targetOrigin = new URL(finalUrl).origin
        } catch (error) {
            return
        }
        iframeRef.current.contentWindow.postMessage(
            {
                type: 'ROADMAP_PROJECTS',
                protocolVersion: ALLDONE_ROADMAP_PROTOCOL_VERSION,
                projects: roadmapProjects,
            },
            targetOrigin
        )
    }, [visible, finalUrl, roadmapProjects])

    if (!visible) return null

    return (
        <View style={[localStyles.overlay, safeAreaOverlayPadding]}>
            <View style={localStyles.container}>
                <View style={localStyles.header}>
                    <View style={localStyles.headerLeft}>
                        <Icon name="monitor" size={18} color={colors.Text03} />
                        <Text style={localStyles.headerTitle} numberOfLines={1}>
                            {name || 'Iframe'}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={closeModal} style={localStyles.closeButton}>
                        <Icon name="x" size={20} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
                <View style={localStyles.content}>
                    <iframe
                        ref={iframeRef}
                        src={finalUrl}
                        style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                        }}
                        allow="display-capture; microphone; camera; autoplay; clipboard-read; clipboard-write"
                        allowFullScreen
                        title="Task Iframe"
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        zIndex: 9999,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
    },
    container: {
        width: '96%',
        height: '96%',
        maxWidth: 1600,
        maxHeight: 1200,
        backgroundColor: '#1a1a2e',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0px 8px 24px rgba(0,0,0,0.40)',
    },
    header: {
        height: 44,
        backgroundColor: '#1a1a2e',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 16,
    },
    headerTitle: {
        color: colors.Text03,
        fontSize: 14,
        marginLeft: 10,
        flex: 1,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
        backgroundColor: '#fff',
    },
})
