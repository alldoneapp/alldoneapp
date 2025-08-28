import { useEffect, useRef } from 'react'
import { Animated, Easing } from 'react-native'
import { useDispatch } from 'react-redux'

import { colors } from '../styles/global'
import { setLastTaskAddedId } from '../../redux/actions'

export default function useLastAddedTaskColor(taskId, lastTaskAddedId, hasStar) {
    const dispatch = useDispatch()
    const addedTaskColorAnimation = useRef(new Animated.Value(0)).current

    useEffect(() => {
        if (lastTaskAddedId === taskId) {
            animateColor()
        }
    }, [lastTaskAddedId, taskId])

    const animateColor = () => {
        Animated.timing(addedTaskColorAnimation, {
            toValue: 1,
            duration: 600,
            easing: Easing.ease,
            useNativeDriver: false,
        }).start(() => {
            dispatch(setLastTaskAddedId(''))
        })
    }

    const backgroundColor = addedTaskColorAnimation.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.UtilityBlue125, hasStar],
    })

    return backgroundColor
}
