import React, { useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Image,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native'

import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'

const takeoverBackend = () => require('../../../../utils/backends/Assistants/browserTakeover')

function SmallButton({ label, onPress, disabled, danger }) {
    return (
        <TouchableOpacity
            style={[styles.smallButton, danger && styles.dangerButton, disabled && styles.disabled]}
            disabled={disabled}
            onPress={onPress}
        >
            <Text style={[styles.smallButtonText, danger && styles.dangerText]}>{label}</Text>
        </TouchableOpacity>
    )
}

/**
 * A screenshot-driven, human-only browser controller. Nothing typed here is put into component
 * props, Firestore or the assistant message; it lives in local state only until the callable has
 * accepted it and is then cleared immediately.
 */
export default function BrowserTakeoverPanel({ approval, onFinished, onCancelled }) {
    const [frame, setFrame] = useState(null)
    const [layout, setLayout] = useState({ width: 0, height: 0 })
    const [typedText, setTypedText] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [goldSpent, setGoldSpent] = useState(0)
    const mounted = useRef(true)

    const interact = async (action, input = {}) => {
        if (busy) return null
        setBusy(true)
        setError('')
        try {
            const result = await takeoverBackend().interactWithBrowserTakeover({
                approvalId: approval.approvalId,
                action,
                input,
            })
            if (!mounted.current) return result
            setFrame(result)
            setGoldSpent(value => value + (Number(result.goldCost) || 0))
            return result
        } catch (interactionError) {
            if (mounted.current) setError(interactionError?.message || translate('browser_takeover_failed'))
            return null
        } finally {
            if (mounted.current) setBusy(false)
        }
    }

    useEffect(() => {
        mounted.current = true
        interact('snapshot')
        return () => {
            mounted.current = false
        }
        // The approval id identifies one immutable takeover request; re-running on busy changes
        // would create a paid screenshot loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [approval.approvalId])

    const clickFrame = event => {
        if (!frame?.viewport || !layout.width || !layout.height || busy) return
        const eventX = Number(event?.nativeEvent?.locationX ?? event?.nativeEvent?.offsetX)
        const eventY = Number(event?.nativeEvent?.locationY ?? event?.nativeEvent?.offsetY)
        if (!Number.isFinite(eventX) || !Number.isFinite(eventY)) return
        interact('click', {
            x: (eventX / layout.width) * frame.viewport.width,
            y: (eventY / layout.height) * frame.viewport.height,
        })
    }

    const typeIntoPage = async () => {
        if (!typedText || busy) return
        const value = typedText
        const result = await interact('type', { text: value })
        if (result) setTypedText('')
    }

    const end = async cancelled => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
            await takeoverBackend().finishBrowserTakeover({ approvalId: approval.approvalId, cancelled })
            setTypedText('')
            if (cancelled) onCancelled?.()
            else onFinished?.()
        } catch (finishError) {
            setError(finishError?.message || translate('browser_takeover_failed'))
        } finally {
            if (mounted.current) setBusy(false)
        }
    }

    const passwordFocused = frame?.focused?.inputType === 'password'

    return (
        <View style={styles.panel}>
            <Text style={styles.title}>{translate('browser_takeover_title')}</Text>
            <Text style={styles.explanation}>{translate('browser_takeover_explanation')}</Text>
            <Text style={styles.cost}>{translate('browser_takeover_cost', { gold: goldSpent })}</Text>

            <View style={styles.viewportShell}>
                {frame?.screenshotDataUrl ? (
                    <TouchableWithoutFeedback onPress={clickFrame} disabled={busy}>
                        <View
                            style={styles.viewport}
                            onLayout={event => setLayout(event.nativeEvent.layout)}
                            accessibilityLabel={translate('browser_takeover_viewport')}
                        >
                            <Image
                                source={{ uri: frame.screenshotDataUrl }}
                                style={styles.viewportImage}
                                resizeMode="stretch"
                            />
                            {busy && (
                                <View style={styles.loadingOverlay}>
                                    <ActivityIndicator color="#FFFFFF" />
                                </View>
                            )}
                        </View>
                    </TouchableWithoutFeedback>
                ) : (
                    <View style={[styles.viewport, styles.emptyViewport]}>
                        {busy ? (
                            <ActivityIndicator color={colors.Primary100} />
                        ) : (
                            <SmallButton
                                label={translate('browser_takeover_retry')}
                                onPress={() => interact('snapshot')}
                            />
                        )}
                    </View>
                )}
            </View>

            {!!frame?.title && <Text style={styles.pageTitle}>{frame.title}</Text>}
            <Text style={styles.focus}>
                {frame?.focused
                    ? translate('browser_takeover_focused', {
                          field: passwordFocused
                              ? translate('browser_takeover_password_field')
                              : frame.focused.name || frame.focused.tagName,
                      })
                    : translate('browser_takeover_click_field')}
            </Text>

            <View style={styles.inputRow}>
                <TextInput
                    style={styles.input}
                    value={typedText}
                    onChangeText={setTypedText}
                    placeholder={translate('browser_takeover_type_placeholder')}
                    placeholderTextColor={colors.Text03}
                    secureTextEntry={passwordFocused}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    importantForAutofill="no"
                    editable={!busy}
                    onSubmitEditing={typeIntoPage}
                />
                <SmallButton
                    label={translate('browser_takeover_type')}
                    onPress={typeIntoPage}
                    disabled={busy || !typedText}
                />
            </View>

            <View style={styles.controls}>
                <SmallButton label="Tab" onPress={() => interact('key', { key: 'Tab' })} disabled={busy} />
                <SmallButton label="Enter" onPress={() => interact('key', { key: 'Enter' })} disabled={busy} />
                <SmallButton label="⌫" onPress={() => interact('key', { key: 'Backspace' })} disabled={busy} />
                <SmallButton label="↑" onPress={() => interact('scroll', { deltaY: -650 })} disabled={busy} />
                <SmallButton label="↓" onPress={() => interact('scroll', { deltaY: 650 })} disabled={busy} />
                <SmallButton label="↻" onPress={() => interact('snapshot')} disabled={busy} />
            </View>

            {!!error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.finishRow}>
                <SmallButton
                    label={translate('browser_takeover_done')}
                    onPress={() => end(false)}
                    disabled={busy || !frame}
                />
                <SmallButton
                    label={translate('browser_takeover_cancel')}
                    onPress={() => end(true)}
                    disabled={busy}
                    danger={true}
                />
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    panel: {
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: colors.Secondary300,
    },
    title: { color: '#FFFFFF', fontWeight: '600', marginBottom: 4 },
    explanation: { color: colors.Text03, marginBottom: 4 },
    cost: { color: colors.UtilityYellow200, fontSize: 12, marginBottom: 8 },
    viewportShell: { width: '100%', maxWidth: 720 },
    viewport: { width: '100%', aspectRatio: 1280 / 900, backgroundColor: '#111111', position: 'relative' },
    viewportImage: { width: '100%', height: '100%' },
    emptyViewport: { alignItems: 'center', justifyContent: 'center' },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.28)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pageTitle: { color: colors.Text02, marginTop: 6, fontSize: 12 },
    focus: { color: colors.Text03, marginTop: 6, fontSize: 12 },
    inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    input: {
        flex: 1,
        minHeight: 36,
        borderWidth: 1,
        borderColor: colors.Secondary300,
        borderRadius: 4,
        color: '#FFFFFF',
        paddingHorizontal: 10,
        marginRight: 8,
    },
    controls: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
    finishRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
    smallButton: {
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 4,
        backgroundColor: colors.Primary100,
        marginRight: 6,
        marginBottom: 6,
    },
    smallButtonText: { color: '#FFFFFF' },
    dangerButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.UtilityRed200 },
    dangerText: { color: colors.UtilityRed200 },
    disabled: { opacity: 0.5 },
    error: { color: colors.UtilityRed200, marginTop: 6 },
})
