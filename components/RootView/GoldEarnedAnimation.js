import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import Lottie from 'lottie-react'

import coin1 from '../../assets/animations/goldCoins/count-1.json'
import coin2 from '../../assets/animations/goldCoins/count-2.json'
import coin3 from '../../assets/animations/goldCoins/count-3.json'
import coin4 from '../../assets/animations/goldCoins/count-4.json'
import coin5 from '../../assets/animations/goldCoins/count-5.json'
import { hideGoldCoin } from '../../redux/actions'

export default function GoldEarnedAnimation() {
    const dispatch = useDispatch()
    const checkBoxId = useSelector(state => state.goldEarnedData.checkBoxId)
    const goldEarned = useSelector(state => state.goldEarnedData.goldEarned)
    const [position, setPosition] = useState({ left: 0, top: 0 })
    const animationRef = useRef(null)

    const animationsList = [null, coin1, coin2, coin3, coin4, coin5]

    const updatePosition = (x, y) => {
        const xOffsetDirection = Math.floor(Math.random() * 2)
        const yOffsetDirection = Math.floor(Math.random() * 2)
        const xOffset = (Math.floor(Math.random() * 25) + 1) * (xOffsetDirection === 0 ? 1 : -1)
        const yOffset = (Math.floor(Math.random() * 25) + 1) * (yOffsetDirection === 0 ? 1 : -1)
        setPosition({ left: x + xOffset - 28, top: y + yOffset - 28 })
        animationRef.current.goToAndPlay(0)
    }

    useEffect(() => {
        const checkBox = document.querySelector(`[check-box-id="${checkBoxId}"]`)
        if (checkBox) {
            const rect = checkBox.getBoundingClientRect()
            const { x, y, width, height } = rect
            updatePosition(x + width * 0.5, y + height * 0.5)
        }
    }, [goldEarned])

    const onCompleteAnimation = () => {
        dispatch(hideGoldCoin())
    }

    const { left, top } = position

    return (
        <View style={{ position: 'absolute', left, top }}>
            {animationsList.map((animation, index) => {
                if (index > 0 && index === goldEarned) {
                    return (
                        <Lottie
                            key={goldEarned}
                            lottieRef={animationRef}
                            animationData={animation}
                            autoplay={false}
                            initialSegment={[0, 65]}
                            style={{
                                width: 56,
                                height: 56,
                            }}
                            onComplete={onCompleteAnimation}
                        />
                    )
                }
            })}
        </View>
    )
}
