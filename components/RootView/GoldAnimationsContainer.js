import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'

import GoldChain from '../TopBar/GoldChain'
import GoldEarnedAnimation from './GoldEarnedAnimation'
import GoldCoinFlight, { goldCoinsUnavailable } from './GoldCoins/GoldCoinFlight'
import { canRenderSkyline } from '../SettingsView/Profile/Achievements/Skyline/webglSupport'
import { currentReducedMotionPreference } from '../UIComponents/Ghosts/ghostAnimation'

/**
 * The reward animation for gold earned by completing a task. Where the browser can draw WebGL and
 * motion is welcome, real 3D coins fly from the checkbox into the Gold counter (`GoldCoinFlight`).
 * Everywhere else — no WebGL, reduced motion, or the 3D coins failing to start — it is the original
 * pair of Lottie animations: coins at the checkbox and a coin chain at the top bar.
 */
export default function GoldAnimationsContainer() {
    const showGoldChain = useSelector(state => state.showGoldChain)
    const showGoldCoin = useSelector(state => state.showGoldCoin)
    const coins3d = useMemo(() => canRenderSkyline() && !currentReducedMotionPreference(), [])

    if (coins3d && !goldCoinsUnavailable()) return <GoldCoinFlight />

    return (
        <>
            {showGoldChain && <GoldChain />}
            {showGoldCoin && <GoldEarnedAnimation />}
        </>
    )
}
