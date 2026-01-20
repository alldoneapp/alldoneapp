import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import styles, { colors, windowTagStyle } from '../styles/global'
import { setContactStatusFilter } from '../../redux/actions'

const ContactStatusTag = ({ projectId, contactStatusId, style }) => {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const projectsMap = useSelector(state => state.loggedUserProjectsMap)
    const project = projectsMap[projectId]

    const status = contactStatusId && project?.contactStatuses ? project.contactStatuses[contactStatusId] : null

    if (!status) {
        return null
    }

    const onPress = e => {
        e.stopPropagation()
        dispatch(setContactStatusFilter(contactStatusId))
    }

    return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
            <View style={[localStyles.container, style]}>
                <View style={[localStyles.colorDot, { backgroundColor: status.color }]} />
                {!mobile && <Text style={[localStyles.text, windowTagStyle()]}>{status.name}</Text>}
            </View>
        </TouchableOpacity>
    )
}

export default ContactStatusTag

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Grey300,
        borderRadius: 50,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        paddingHorizontal: 4,
    },
    colorDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 8,
        marginLeft: 6,
    },
})
