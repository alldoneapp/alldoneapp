import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native'

import { canRenderSkyline as canRenderWebGL } from '../../../../SettingsView/Profile/Achievements/Skyline/webglSupport'
import { useReducedMotion } from '../../../../UIComponents/Ghosts/ghostAnimation'
import { acquireThinkingAnimation, releaseThinkingAnimation } from './thinkingAnimationChoice'
import { loadThinkingStage } from './loadThinkingStage'

export const ASSISTANT_THINKING_STAGE_SIZE = 64

/**
 * Whether a loading card should reserve room for the 3D stage. Answered synchronously so the card
 * lays out once: a card that first rendered without the stage and then grew one would shift its
 * text sideways. Reduced motion keeps the plain spinner — the stage carries no information.
 */
export function useAssistantThinking3DEnabled() {
    const reducedMotion = useReducedMotion()
    return Platform.OS === 'web' && !reducedMotion && canRenderWebGL()
}

/**
 * A small 3D scene that plays while the assistant works (see `thinkingAnimations.js` for the ten).
 * Shows `spinnerColor`'s ActivityIndicator until the first frame is drawn, and keeps it if the
 * scene cannot load, so the card never ends up with an empty box where the indicator was.
 */
export default function AssistantThinking3D({
    appearance = 'light',
    spinnerColor,
    size = ASSISTANT_THINKING_STAGE_SIZE,
}) {
    const hostRef = useRef(null)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        const host = hostRef.current
        if (!host || typeof host.appendChild !== 'function') return undefined
        // Acquired in the effect, not during render: the placeholder card's cleanup (which releases
        // its scene) runs before this, so the message card that replaces it keeps the same scene.
        const animation = acquireThinkingAnimation()
        let disposed = false
        let unmount = null
        loadThinkingStage()
            .then(({ mountThinkingView }) => {
                if (disposed) return
                unmount = mountThinkingView(host, {
                    animation,
                    appearance,
                    onReady: () => !disposed && setReady(true),
                    onFailure: error => {
                        console.warn('[assistant thinking] Falling back to the spinner', error)
                        if (!disposed) setReady(false)
                    },
                })
            })
            .catch(error => console.warn('[assistant thinking] Falling back to the spinner', error))
        return () => {
            disposed = true
            releaseThinkingAnimation(animation)
            if (unmount) unmount()
            setReady(false)
        }
    }, [appearance])

    return (
        <View style={[localStyles.stage, { width: size, height: size }]} testID="assistant-thinking-3d">
            <View ref={hostRef} style={[StyleSheet.absoluteFill, !ready && localStyles.hidden]} />
            {!ready && (
                <View style={localStyles.spinner} pointerEvents="none">
                    <ActivityIndicator size="small" color={spinnerColor} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    stage: {
        width: ASSISTANT_THINKING_STAGE_SIZE,
        height: ASSISTANT_THINKING_STAGE_SIZE,
    },
    hidden: {
        opacity: 0,
    },
    spinner: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
