import React from 'react'
import { StyleSheet, Image, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { useSelector } from 'react-redux'

import styles, { colors, windowTagStyle } from '../../styles/global'
import Icon from '../../Icon'
import NavigationService from '../../../utils/NavigationService'
import URLTrigger from '../../../URLSystem/URLTrigger'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import { getDvMainTabLink } from '../../../utils/LinkingHelper'

export default function ObjectLinkTag({ containerStyle, text, inTaskDetailView, projectId, objectTypes, objectId }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const loggedUser = useSelector(state => state.loggedUser)

    const getParseParentName = () => {
        const shortLength = smallScreenNavigation ? 10 : 15
        const dots = text.length > shortLength ? '...' : ''
        const shortName = text.substring(0, shortLength)
        return `${shortName}${dots}`
    }

    const generateDetailedViewLink = () => {
        const objectTypePath = objectTypes === 'users' ? 'contacts' : objectTypes
        const tab = objectTypes === 'assistants' ? 'customizations' : 'properties'
        return objectTypes === 'projects'
            ? `/project/${projectId}/properties`
            : `/projects/${projectId}/${objectTypePath}/${objectId}/${tab}`
    }

    const onLinkBackPress = () => {
        if (inTaskDetailView) {
            URLTrigger.processUrl(NavigationService, `/projects/${projectId}/user/${loggedUser.uid}/tasks/open`)
            URLTrigger.processUrl(NavigationService, getDvMainTabLink(projectId, objectId, 'tasks'))
        }

        URLTrigger.processUrl(NavigationService, generateDetailedViewLink())
    }

    const getIco = () => {
        if (objectTypes === 'tasks') {
            return 'check-square'
        }
        if (objectTypes === 'projects') {
            return 'circle'
        }
        if (objectTypes === 'notes') {
            return 'file-text'
        }
        if (objectTypes === 'goals') {
            return 'target'
        }
        if (objectTypes === 'skills') {
            return 'star'
        }
        if (objectTypes === 'assistants') {
            return 'cpu'
        }
    }

    const getUrl = () => {
        const people =
            objectTypes === 'contacts'
                ? TasksHelper.getContactInProject(projectId, objectId)
                : TasksHelper.getUserInProject(projectId, objectId)
        const photoURL = people ? people.photoURL : ''
        return photoURL
    }

    const imgUrl = getUrl()

    return (
        <TouchableOpacity style={[containerStyle]} onPress={onLinkBackPress} accessible={false}>
            <View style={localStyles.linkTagContainer}>
                {objectTypes === 'contacts' || objectTypes === 'users' ? (
                    imgUrl ? (
                        <Image source={{ uri: imgUrl }} style={localStyles.avatar} />
                    ) : (
                        <View style={localStyles.avatar}>
                            <SVGGenericUser width={20} height={20} svgid={objectId} />
                        </View>
                    )
                ) : (
                    <Icon size={16} name={getIco()} color={colors.Text03} />
                )}

                <Text style={[localStyles.text, windowTagStyle()]}>{getParseParentName()}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    linkTagContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        borderRadius: 50,
        paddingRight: 10,
        paddingLeft: 4.65,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        paddingLeft: 6.66,
        height: 24,
    },
    avatar: {
        width: 20,
        height: 20,
        borderRadius: 100,
    },
})
