import React, { useEffect, useRef, useState } from 'react'
import { Image, Platform, StyleSheet, Text, View } from 'react-native'
import global, { colors, SIDEBAR_MENU_WIDTH } from '../styles/global'
import store from '../../redux/store'
import MyPlatform from '../MyPlatform'
import Button from '../UIControls/Button'
import CustomScrollView from '../UIControls/CustomScrollView'
import Backend from '../../utils/BackendBridge'
import RejectMeetReasonsModal from './RejectMeetReasonsModal'
import * as Linking from 'expo-linking'
import Icon from '../Icon'
import CloseButton from '../FollowUp/CloseButton'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { applyPopoverWidth, getPopoverWidth } from '../../utils/HelperFunctions'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { PROJECT_COLOR_DEFAULT } from '../../Themes/Modern/ProjectColors'
import { useSelector, useDispatch } from 'react-redux'
import { updateGoogleMeetNotificationModalData } from '../../redux/actions'

const GoogleMeetNotificationModal = ({ projectId, userEmail, meeting }) => {
    const dispatch = useDispatch()
    const storeState = store.getState()
    const mobile = storeState.smallScreenNavigation
    const tablet = storeState.isMiddleScreen
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const [reasonsM, setReasonsM] = useState(false)
    const owner = TasksHelper.getUserInProject(projectId, meeting.ownerId)
    const [users, setUsers] = useState([])
    const popoverHeight = useRef(412)
    const position = useRef({ top: '30%', left: '35%' })
    const parentRef = useRef()
    const projectName = ProjectHelper.getProjectNameById(projectId)
    const projectColor = ProjectHelper.getProjectColorById(projectId, PROJECT_COLOR_DEFAULT)

    const compare = (a, b) => {
        if (a.attend > b.attend) {
            return -1
        }
        if (a.attend < b.attend) {
            return 1
        }
        return 0
    }

    useEffect(() => {
        MyPlatform.getElementDimensions(parentRef.current).then(({ height }) => {
            popoverHeight.current = height
        })
        window.addEventListener('resize', setPosition)
        return () => {
            window.removeEventListener('resize', setPosition)
        }
    }, [])

    useEffect(() => {
        if (meeting && usersInProject[projectId]) {
            const newArray = meeting.guests.sort(compare).filter(el => {
                return usersInProject[projectId].some(f => {
                    el.photoURL = f.photoURL
                    return f.email === el.email
                })
            })
            setUsers(newArray)
        }
    }, [meeting])

    useEffect(() => {
        setPosition()
    }, [mobile, tablet])

    const setPosition = () => {
        const width = getPopoverWidth()
        const sidebar = mobile ? 0 : SIDEBAR_MENU_WIDTH / 2
        const left = window.innerWidth / 2 - width / 2 + sidebar
        const top = window.innerHeight / 2 - popoverHeight.current / 2
        position.current = { top, left }
    }

    const attend = email => {
        const foundIndex = meeting.guests.findIndex(x => x.email === email)
        try {
            return meeting.guests[foundIndex].attend
        } catch (e) {
            return null
        }
    }

    const accept = () => {
        Backend.acceptJoinEvent(projectId, meeting.link.split('/')[3], userEmail)
        if (Platform.OS === 'web') {
            window.open(meeting.link, '_blank')
        } else {
            Linking.openURL(meeting.link)
        }
    }

    const createdTime = time => {
        const hrs = new Date(time).toTimeString().split('GMT')[0].split(':')[0]
        const min = new Date(time).toTimeString().split('GMT')[0].split(':')[1]
        return `${hrs}:${min}`
    }
    return !reasonsM ? (
        <View ref={parentRef} style={[localStyles.parent, { top: position.current.top, left: position.current.left }]}>
            <CustomScrollView contentContainerStyle={[localStyles.container, applyPopoverWidth()]}>
                <Text style={[global.title7, { color: 'white' }]}>Meeting room notification</Text>
                <Text style={[global.body2, { color: colors.Text03 }]}>
                    Some college have invited you to a meeting room.
                </Text>
                <View style={localStyles.project}>
                    <View style={[localStyles.projectMarker, { backgroundColor: projectColor }]} />
                    <Text style={[global.subtitle1, { color: 'white' }]}>{projectName}</Text>
                </View>
                <View style={localStyles.owner}>
                    <Image source={{ uri: owner.photoURL }} style={localStyles.ownerImage} />
                    <View style={{ flexDirection: 'column' }}>
                        <Text style={[global.subtitle1, { color: 'white' }]}>{owner.displayName}</Text>
                        <Text style={[global.caption1, { color: colors.Text03 }]}>
                            Created room at {createdTime(meeting.startTime)}
                        </Text>
                    </View>
                </View>
                <View style={localStyles.topic}>
                    <Text style={[global.subtitle1, { color: 'white' }]}>Update: </Text>
                    <Text style={[global.subtitle1, { color: colors.Text03 }]}>{meeting.topic}</Text>
                </View>
                <View style={localStyles.lines}>{null}</View>
                <Text style={[global.subtitle1, { color: 'white' }]} numberOfLines={1}>
                    Participants:{' '}
                </Text>
                <View style={localStyles.section}>
                    <View>
                        {owner && (
                            <Image key={owner.uid} source={{ uri: owner.photoURL }} style={localStyles.guestsImage} />
                        )}
                        <Text style={[localStyles.backIcon, { backgroundColor: '#EAFFF8' }]} />
                        <Icon name={'check-thiker'} size={10} color={'#057651'} style={localStyles.icons} />
                    </View>
                    {users &&
                        users.map((item, index) => (
                            <View key={`${item.uid}-${index}`}>
                                <Image source={{ uri: item.photoURL }} style={localStyles.guestsImage} />
                                {attend(item.email) === 0 ? null : attend(item.email) === 1 ? (
                                    <>
                                        <Text style={[localStyles.backIcon, { backgroundColor: '#EAFFF8' }]} />
                                        <Icon
                                            name={'check-thiker'}
                                            size={10}
                                            color={'#057651'}
                                            style={localStyles.icons}
                                        />
                                    </>
                                ) : (
                                    <>
                                        <Text style={[localStyles.backIcon, { backgroundColor: '#FFEBEB' }]} />
                                        <Icon
                                            name={'x-thicker'}
                                            size={10}
                                            color={'#BD0303'}
                                            style={localStyles.icons}
                                        />
                                    </>
                                )}
                            </View>
                        ))}
                </View>
                <View style={localStyles.lines}>{null}</View>
                <View style={localStyles.buttons}>
                    <Button
                        title={'Reject'}
                        type={'secondary'}
                        buttonStyle={{ marginRight: 8 }}
                        onPress={() => setReasonsM(true)}
                    />
                    <Button
                        title={'Accept'}
                        onPress={() => {
                            accept()
                            dispatch(updateGoogleMeetNotificationModalData(false, '', '', null))
                        }}
                    />
                </View>
            </CustomScrollView>
            <CloseButton
                close={e => {
                    if (e) {
                        e.preventDefault()
                        setReasonsM(true)
                    }
                }}
            />
        </View>
    ) : (
        <View ref={parentRef} style={{ position: 'absolute', top: position.current.top, left: position.current.left }}>
            <RejectMeetReasonsModal userEmail={userEmail} projectId={projectId} roomId={meeting.link.split('/')[3]} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        flex: 1,
        position: 'absolute',
        zIndex: 1,
        height: 'auto',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    container: {
        paddingVertical: 16,
        paddingHorizontal: 16,
        width: 317,
    },
    owner: {
        flexDirection: 'row',
    },
    topic: {
        flexDirection: 'row',
        marginTop: 16,
        marginBottom: 8,
    },
    lines: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Text03,
        marginVertical: 8,
        opacity: 0.6,
        marginHorizontal: -16,
    },
    ownerImage: {
        height: 40,
        width: 40,
        borderRadius: 100,
        marginRight: 8,
    },
    section: {
        flexDirection: 'row',
        flex: 1,
        flexWrap: 'wrap',
    },
    project: {
        marginTop: 24,
        marginBottom: 32,
        flexDirection: 'row',
        alignItems: 'center',
    },
    projectMarker: {
        width: 16,
        height: 16,
        borderRadius: 100,
        marginLeft: 4,
        marginRight: 12,
    },
    guestsImage: {
        height: 28,
        width: 28,
        borderRadius: 100,
        marginRight: 12,
        marginTop: 8,
    },
    buttons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 8,
    },
    backIcon: {
        position: 'absolute',
        marginLeft: 21,
        borderRadius: 10,
        width: 14,
        height: 14,
        bottom: 0,
    },
    icons: {
        marginLeft: 23,
        bottom: 1,
        position: 'absolute',
    },
})

export default GoogleMeetNotificationModal
