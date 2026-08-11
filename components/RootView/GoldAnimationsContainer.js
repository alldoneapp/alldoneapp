import React from 'react'
import { useSelector } from 'react-redux'

import GoldChain from '../TopBar/GoldChain'
import GoldEarnedAnimation from './GoldEarnedAnimation'

export default function GoldAnimationsContainer() {
    const showGoldChain = useSelector(state => state.showGoldChain)
    const showGoldCoin = useSelector(state => state.showGoldCoin)

    return (
        <>
            {showGoldChain && <GoldChain />}
            {showGoldCoin && <GoldEarnedAnimation />}
        </>
    )
}
