import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import Icon from '../Icon'
import { colors } from '../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { setShowWebSideBar } from '../../redux/actions'

export default function DVHamburgButton() {
    const dispatch = useDispatch()

    const showSideBar = () => {
        dispatch(setShowWebSideBar())
    }

    return (
        <TouchableOpacity style={localStyles.touchableContainer} onPress={showSideBar}>
            <View style={localStyles.upperContainer} />
            <View style={localStyles.bottomContainer}>
                <Icon name={'menu'} size={24} color={colors.Text03} />
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    upperContainer: {
        width: 57,
        height: 32,
        backgroundColor: 'white',
    },
    bottomContainer: {
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        width: 57,
        height: 32,
        backgroundColor: 'white',
        borderRightWidth: 1,
        borderRightColor: colors.Gray300,
    },
    touchableContainer: {
        width: 57,
        height: 64,
    },
})
