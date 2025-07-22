import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { updateShowAllProjectsByTime } from '../../utils/backends/Users/usersFirestore'
import { storeLoggedUser } from '../../redux/actions'
import store from '../../redux/store'

export default function ToggleByTime({ containerStyle, onToggle }) {
    const dispatch = useDispatch()
    const showAllProjectsByTime = useSelector(state => state.loggedUser.showAllProjectsByTime)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const toggleAllProjectsType = () => {
        const { loggedUser } = store.getState()
        dispatch(storeLoggedUser({ ...loggedUser, showAllProjectsByTime: !showAllProjectsByTime }))
        updateShowAllProjectsByTime(loggedUserId, !showAllProjectsByTime)
        if (onToggle) {
            onToggle(!showAllProjectsByTime)
        }
    }

    return (
        <View style={[localStyles.container, containerStyle]}>
            <TouchableOpacity style={localStyles.button} onPress={toggleAllProjectsType}>
                <Text style={localStyles.text}>{translate(showAllProjectsByTime ? 'by time' : 'by project')}</Text>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 4,
    },
    button: {
        justifyContent: 'center',
    },
    text: {
        ...styles.buttonLabel,
        fontFamily: 'Roboto-Regular',
        color: colors.Text03,
    },
})
