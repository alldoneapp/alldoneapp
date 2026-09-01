import React, { useEffect } from 'react'
import { StyleSheet, View, Text, TouchableOpacity, Modal } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Icon from '../../../Icon'
import { colors, hexColorToRGBa } from '../../../styles/global'
import { setIframeModalData } from '../../../../redux/actions'
import useEscapeKey from '../../../../hooks/useEscapeKey'
import useSafeAreaOverlayPadding from '../../../../hooks/useSafeAreaOverlayPadding'
import { runHttpsCallableFunction } from '../../../../utils/backends/firestore'

// The only messages this modal speaks. The window `message` event is a shared
// bus, not a private channel: react-native-web's scheduler runs on the
// `setimmediate` polyfill, which implements setImmediate as
// `window.postMessage('setImmediate$<rand>$<handle>', '*')` on OUR OWN window —
// so every scheduled tick delivers a same-origin string here. Treating those as
// "a message from the iframe that failed the origin check" logged a warning per
// tick (hundreds while a modal is open) and buried a real cross-origin attempt
// in the noise. Anything not shaped like our protocol is dropped silently; the
// origin check below still guards every message that IS.
const IFRAME_MESSAGE_TYPES = new Set(['GET_USER_DATA', 'DEDUCT_GOLD', 'REFUND_GOLD'])

export default function IframeModal() {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    const dispatch = useDispatch()
    const iframeModalData = useSelector(state => state.iframeModalData)
    const { visible, url, name } = iframeModalData

    const loggedUser = useSelector(state => state.loggedUser)

    const finalUrl = url

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

            if (!trustedOrigin || event.origin !== trustedOrigin) {
                console.warn('IframeModal: ignoring message from untrusted origin', {
                    origin: event.origin,
                    trustedOrigin,
                    type: messageType,
                })
                return
            }

            const { type, amount } = event.data

            console.log('IframeModal: message received from iframe', {
                origin: event.origin,
                type,
                amount,
                userEmail: loggedUser?.email || '',
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
                        userEmail: loggedUser?.email || '',
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
                        email: loggedUser?.email,
                        name: loggedUser?.userName || loggedUser?.name,
                        gold: loggedUser?.gold || 0,
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
        }

        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [visible, loggedUser, dispatch])

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
