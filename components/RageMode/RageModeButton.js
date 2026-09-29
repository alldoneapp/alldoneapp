import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { canRenderSkyline } from '../SettingsView/Profile/Achievements/Skyline/webglSupport'
import { useReducedMotion } from '../UIComponents/Ghosts/ghostAnimation'
import { isRageModeEnabled } from './rageModeFlag'
import { loadRageArena } from './loadRageArena'

export const RAGE_ACTIVE_COLOR = '#E00000'

const rageStrings = () => ({
    title: translate('Rage mode'),
    exitHint: translate('Esc to exit'),
    destroyed: translate('destroyed'),
    desktopHelp: translate('Rage mode desktop help'),
    touchHelp: translate('Rage mode touch help'),
    mute: translate('Mute'),
    unmute: translate('Unmute'),
    exit: translate('Exit rage mode'),
    greet: translate('Say hi'),
    greetings: [1, 2, 3, 4].map(n => translate(`Rage mode greeting ${n}`)),
})

/**
 * The entry to rage mode, next to "Anna Alldone: How can I help?" in the assistant line: Anna flies
 * out of it and turns the page you are on into a level you can shoot apart, then rewinds it when you
 * leave. Purely for fun — nothing is written, and the app's DOM is never touched
 * (see `rageArena.js`).
 *
 * Renders nothing for anonymous viewers, without WebGL, under reduced motion, or on a browser that
 * opted out with `?rageMode=off` (`rageModeFlag.js`) — the arena IS motion, so there is no calmer version to offer.
 * The three.js arena is its own lazy chunk and costs nothing until the first press.
 */
export default function RageModeButton({ color, style, size = 24 }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const reducedMotion = useReducedMotion()
    const [enabled] = useState(isRageModeEnabled)
    const [active, setActive] = useState(false)
    const buttonRef = useRef(null)
    const arenaRef = useRef(null)
    const mountedRef = useRef(true)

    useEffect(
        () => () => {
            mountedRef.current = false
            // Leaving the view that owns the button (e.g. navigating away from My Day) must not strand
            // an arena whose button no longer exists.
            if (arenaRef.current) arenaRef.current.stop({ immediate: true })
        },
        []
    )

    if (!enabled || isAnonymous || reducedMotion || !canRenderSkyline()) return null

    const onPress = () => {
        if (active) return
        const node = buttonRef.current
        const rect = node && node.getBoundingClientRect ? node.getBoundingClientRect() : null
        const from = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
        setActive(true)
        loadRageArena()
            .then(({ startRageArena }) => {
                arenaRef.current = startRageArena({
                    strings: rageStrings(),
                    from,
                    onExit: () => {
                        arenaRef.current = null
                        if (mountedRef.current) setActive(false)
                    },
                })
            })
            .catch(error => {
                console.warn('[rage mode] Could not start the arena', error)
                if (mountedRef.current) setActive(false)
            })
    }

    return (
        <TouchableOpacity
            ref={buttonRef}
            style={[localStyles.button, style]}
            onPress={onPress}
            accessibilityLabel={translate('Rage mode')}
            accessible={false}
        >
            <Icon size={size} name={'crosshair'} color={active ? RAGE_ACTIVE_COLOR : color} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 24,
        minWidth: 24,
    },
})
