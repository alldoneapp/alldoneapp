import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { canRenderSkyline } from '../SettingsView/Profile/Achievements/Skyline/webglSupport'
import { useReducedMotion } from '../UIComponents/Ghosts/ghostAnimation'
import { isRageModeEnabled } from './rageModeFlag'
import { loadRageArena } from './loadRageArena'
import { findLaunchPoint } from './rageLaunchAnchor'
import { loadRageProfile, purchaseRageItem, saveRageProgress, submitRageScore } from './rageModeBackend'
import { buildRageStrings } from './rageStrings'
import getAllProjectsOpenTasksAmount from '../../utils/Tasks/getAllProjectsOpenTasksAmount'
import { PROJECT_COLOR_SYSTEM } from '../../Themes/Modern/ProjectColors'

export const RAGE_ACTIVE_COLOR = '#E00000'

const rageStrings = () => buildRageStrings(translate)

// The bunkers on the ground wear their project's colour. The map is read from the store when the
// game asks, not subscribed to: the button must not re-render on every write to it (AT-2336). The
// store is required lazily, like `rageModeBackend.js`, so suites rendering the assistant line do
// not pull it in.
const readProjectsMap = () => {
    try {
        const store = require('../../redux/store').default
        return store.getState().loggedUserProjectsMap || {}
    } catch (error) {
        return {}
    }
}

/**
 * The entry to rage mode, next to "Anna Alldone: How can I help?" in the assistant line: Anna takes
 * off from the assistant's avatar beside it, the page slides away under her and a vertical-scrolling raid begins over ground built
 * from your day (`raidArena.js`); leaving slides the page back. Purely for fun — none of the app's
 * data is written (only the raid's own profile and progress), and its DOM is never touched.
 *
 * Renders nothing for anonymous viewers, without WebGL, under reduced motion, or on a browser that
 * opted out with `?rageMode=off` (`rageModeFlag.js`) — the arena IS motion, so there is no calmer version to offer.
 * The three.js arena is its own lazy chunk and costs nothing until the first press.
 */
export default function RageModeButton({ color, style, size = 24 }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const uid = useSelector(state => state.loggedUser.uid)
    const gold = useSelector(state => state.loggedUser.gold)
    const openTasksToday = useSelector(state =>
        getAllProjectsOpenTasksAmount(
            state.sidebarNumbers,
            state.loggedUser.uid,
            state.loggedUser.archivedProjectIds,
            state.loggedUser.templateProjectIds
        )
    )
    // The arena reads these live (the shop shows the balance, the boss is built from the count), so
    // they are handed over as getters over refs rather than as values frozen at start.
    const goldRef = useRef(gold)
    goldRef.current = gold
    const openTasksRef = useRef(openTasksToday)
    openTasksRef.current = openTasksToday
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
        // She comes out of (and goes back into) her avatar next to the input, not the crosshair.
        const from = findLaunchPoint(buttonRef.current)
        setActive(true)
        loadRageArena()
            .then(({ startRageArena }) => {
                arenaRef.current = startRageArena({
                    strings: rageStrings(),
                    from,
                    // Missions completed are remembered per user, on every device (raidProgress.js).
                    progressScope: uid,
                    services: {
                        loadProfile: loadRageProfile,
                        purchase: purchaseRageItem,
                        submitScore: submitRageScore,
                        saveProgress: saveRageProgress,
                        getGold: () => goldRef.current,
                        getOpenTasksToday: () => openTasksRef.current,
                        getProjectColor: projectId => {
                            const projects = readProjectsMap()
                            const project = projects && projects[projectId]
                            const color = project && PROJECT_COLOR_SYSTEM[project.color]
                            return color ? color.MARKER : null
                        },
                    },
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
