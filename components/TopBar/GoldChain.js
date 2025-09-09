import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Lottie from 'lottie-react'

import goldAnimation from '../../assets/animations/new-top-coin-animation.json'
import { hideGoldChain } from '../../redux/actions'

const ANIMATION_WIDTH = 375 / 3.2
const ANIMATION_HEIGHT = 840 / 3.2
const HALF_OF_WIDTH_OF_ANIMATION = ANIMATION_WIDTH * 0.5
const HALF_OF_COIN_SIZE = 12
const ANIMATION_TOP_PADDING = 3
const COIN_LEFT_POSITION_INSIDE_ANIMATION = HALF_OF_WIDTH_OF_ANIMATION - HALF_OF_COIN_SIZE

export default function GoldChain() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const animationRef = useRef(null)
    const [position, setPosition] = useState({ left: 0, top: 0 })

    const updatePosition = event => {
        const goldArea = document.getElementById('goldArea')
        if (goldArea) {
            const size = goldArea.getBoundingClientRect()
            setPosition({
                left: size.left - COIN_LEFT_POSITION_INSIDE_ANIMATION,
                top: size.top - ANIMATION_TOP_PADDING,
            })
        } else {
            const xpArea = document.getElementById('xpArea')
            if (xpArea) {
                const size = xpArea.getBoundingClientRect()
                setPosition({
                    left: size.left + size.width * 0.5 - HALF_OF_WIDTH_OF_ANIMATION,
                    top: size.top + size.height * 0.5 - HALF_OF_COIN_SIZE - ANIMATION_TOP_PADDING,
                })
            } else {
                setPosition({
                    left: (smallScreenNavigation ? 50 : sidebarExpanded ? 352 : 150) - HALF_OF_WIDTH_OF_ANIMATION,
                    top: 43 - HALF_OF_COIN_SIZE - ANIMATION_TOP_PADDING,
                })
            }
        }
    }

    useEffect(() => {
        updatePosition()
        animationRef.current.goToAndPlay(0)
    }, [])

    const onCompleteAnimation = () => {
        dispatch(hideGoldChain())
    }

    const { left, top } = position

    return (
        <View pointerEvents="none" style={{ position: 'absolute', left, top }}>
            <Lottie
                lottieRef={animationRef}
                animationData={goldAnimation}
                autoplay={false}
                initialSegment={[0, 138]}
                style={{ width: ANIMATION_WIDTH, height: ANIMATION_HEIGHT }}
                onComplete={onCompleteAnimation}
            />
        </View>
    )
}
