import React, { useEffect, useRef, useState } from 'react'
import { Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSelector, useStore, useDispatch } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import { sortBy } from 'lodash'
import Popover from 'react-tiny-popover'
import styles from '../styles/global'
import global, { colors, SIDEBAR_MENU_WIDTH } from '../styles/global'
import CustomScrollView from '../UIControls/CustomScrollView'
import Icon from '../Icon'
import UserItem from './UserItem'
import Button from '../UIControls/Button'
import CloseButton from '../FollowUp/CloseButton'
import MyPlatform from '../MyPlatform'
import ApiCalendar from '../../apis/google/calendar/apiCalendar'
import Backend from '../../utils/BackendBridge'
import { applyPopoverWidth, getPopoverWidth } from '../../utils/HelperFunctions'
import { updateGoogleMeetModalData } from '../../redux/actions'
import { sendPushNotification } from '../../utils/backends/firestore'

const GoogleMeetModal = ({ uid, projectId }) => {
    const dispatch = useDispatch()
    const store = useStore()
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const [all, setAll] = useState(true)
    const [emailUsers, setEmailUsers] = useState([])
    const position = useRef({ top: '30%', left: '35%' })
    const [processing, setProcessing] = useState(false)
    const popoverHeight = useRef(490)
    const [tmpUids, setTmpUids] = useState([])
    const [uids, setUids] = useState([])
    const parentRef = useRef()
    const [event, setEvent] = useState({
        summary: 'Check-In',
        reminders: {
            useDefault: false,
        },
        attendees: [],
        conferenceData: {
            createRequest: { requestId: 'iVBORw0KGgoAcW5l7hLmIdze5mZi' },
        },
        time: 10,
    })
    const selectedProjectUsers = sortBy(usersInProject[projectId]).filter(item => item.uid !== uid)
    const { id, name, color } = store.getState().loggedUserProjectsMap[projectId]

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
        if (emailUsers.length === 0 || all) {
            setAll(true)
            let newArray = []
            let newUidArray = []
            selectedProjectUsers.map(user => {
                newArray.push(Object.assign({ email: user.email }))
                newUidArray.push(user.uid)
            })
            setEvent({ ...event, attendees: newArray })
            setUids(newUidArray)
        } else {
            let array = []
            let uidArray = []
            for (let i in emailUsers) array.push(Object.assign({ email: emailUsers[i] }))
            setEvent({ ...event, attendees: array })

            for (let i in tmpUids) uidArray.push(tmpUids[i])
            setUids(uidArray)
        }
    }, [emailUsers, all])

    useEffect(() => {
        setPosition()
        MyPlatform.getElementDimensions(parentRef.current).then(({ height }) => {
            popoverHeight.current = height
            setPosition()
        })
    }, [mobile, tablet])

    const setPosition = () => {
        const width = getPopoverWidth()
        const sidebar = mobile ? 0 : SIDEBAR_MENU_WIDTH / 2
        const left = window.innerWidth / 2 - width / 2 + sidebar
        const top = window.innerHeight / 2 - popoverHeight.current / 2
        position.current = { top, left }
    }

    const selectUser = async user => {
        all && setAll(false)
        if (!emailUsers.includes(user.email)) {
            setEmailUsers([...emailUsers.filter(item => item !== user.email), user.email])
            setTmpUids([...tmpUids.filter(item => item !== user.uid), user.uid])
        } else {
            setEmailUsers(emailUsers.filter(item => item !== user.email))
            setTmpUids(tmpUids.filter(item => item !== user.uid))
        }
    }

    const insertEventFirebase = (link, objectId) => {
        let result = event.attendees.map(v => ({ ...v, attend: 0 }))
        const now = new Date()
        Backend.getDb().collection(`events/${id}/rooms`).doc(link.split('/')[3]).set({
            topic: event.summary,
            startTime: now.toISOString(),
            guests: result,
            inProgress: true,
            link,
            ownerId: uid,
            objectId,
            projectId: id,
        })
    }

    const deleteEvent = id => {
        ApiCalendar.deleteEvent(id).then(null)
    }

    const openLink = link => {
        if (Platform.OS === 'web') {
            window.open(link, '_blank')
        } else {
            Linking.openURL(link)
        }
    }

    const createEventFromNow = () => {
        setProcessing(true)
        ApiCalendar.createEventFromNow(event)
            .then(({ result }) => {
                sendPushNotification({
                    type: 'Google Meeting',
                    body: `You've been invited to a meeting through Alldone`,
                    userIds: uids,
                    link: result.hangoutLink,
                })
                dispatch(updateGoogleMeetModalData(false, '', ''))
                const objectId = Backend.getId()
                insertEventFirebase(result.hangoutLink, objectId)
                deleteEvent(result.id)
                openLink(result.hangoutLink)
            })
            .catch(error => {
                console.log(error)
                setProcessing(false)
            })
    }

    return (
        <Popover
            content={null}
            onClickOutside={() => {
                dispatch(updateGoogleMeetModalData(false, '', ''))
            }}
            isOpen={true}
            contentLocation={store.getState().smallScreen ? null : undefined}
        >
            <Hotkeys
                key={20}
                keyName={'Esc'}
                onKeyDown={() => {
                    dispatch(updateGoogleMeetModalData(false, '', ''))
                }}
                filter={e => true}
            >
                <View
                    ref={parentRef}
                    style={[localStyles.parent, { top: position.current.top, left: position.current.left }]}
                >
                    <CustomScrollView contentContainerStyle={[localStyles.container, applyPopoverWidth()]}>
                        <View style={{ paddingHorizontal: 16 }}>
                            <Text style={[global.title7, { color: 'white' }]}>Meeting room invitations</Text>
                            <Text style={[global.body2, { color: colors.Text03 }]}>
                                Users selected here will be notified about the meeting.
                            </Text>
                            <View style={localStyles.section}>
                                <View style={[localStyles.projectMarker, { backgroundColor: color }]} />
                                <Text style={[global.subtitle1, { color: 'white' }]}>{name}</Text>
                            </View>
                            <Text style={[global.body2, { color: colors.Text02 }]}>Meeting update</Text>
                            <View style={{ marginTop: 4, paddingRight: 8 }}>
                                <TextInput
                                    style={[styles.body1, localStyles.commentBox, { color: 'white' }]}
                                    placeholder="Type a short description here"
                                    placeholderTextColor={colors.Text03}
                                    onChangeText={text => setEvent({ ...event, summary: text })}
                                    value={event.summary}
                                />
                            </View>
                        </View>
                        <View style={localStyles.line1}>{null}</View>
                        <CustomScrollView contentContainerStyle={{ height: 180 }}>
                            <View>
                                <View style={{ paddingHorizontal: 8 }}>
                                    <TouchableOpacity
                                        accessible={false}
                                        style={[
                                            localStyles.innerContainer,
                                            all && { backgroundColor: 'rgba(139, 149, 167, 0.22)' },
                                        ]}
                                        onPress={() => setAll(!all)}
                                    >
                                        <Icon
                                            name={'users'}
                                            size={24}
                                            color={all ? colors.Primary100 : 'white'}
                                            style={{ marginHorizontal: 12 }}
                                        />
                                        <Text style={[localStyles.allMembers, all && { color: colors.Primary100 }]}>
                                            All members
                                        </Text>
                                        {all && (
                                            <Icon
                                                name={'check'}
                                                size={24}
                                                color="white"
                                                style={{ marginLeft: 'auto', right: 11 }}
                                            />
                                        )}
                                    </TouchableOpacity>
                                </View>
                                {selectedProjectUsers.length > 0 &&
                                    selectedProjectUsers.map(user => (
                                        <UserItem user={user} key={user.uid} selectUser={selectUser} all={all} />
                                    ))}
                            </View>
                        </CustomScrollView>
                        <View style={localStyles.line2}>{null}</View>
                        <View style={localStyles.button}>
                            <Hotkeys
                                keyName={'alt+enter,enter'}
                                onKeyDown={() => createEventFromNow()}
                                filter={e => true}
                            >
                                <Button
                                    title={'Send invitation'}
                                    disabled={!event.summary}
                                    onPress={() => {
                                        !processing && createEventFromNow()
                                    }}
                                    shortcutText={'Enter'}
                                    processingTitle={'Sending...'}
                                    processing={processing}
                                />
                            </Hotkeys>
                        </View>
                    </CustomScrollView>
                    <CloseButton
                        close={e => {
                            if (e) {
                                e.preventDefault()
                            }
                            dispatch(updateGoogleMeetModalData(false, '', ''))
                        }}
                    />
                </View>
            </Hotkeys>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        flex: 1,
        position: 'fixed',
        zIndex: 1,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
    },
    container: {
        width: 305,
    },
    section: {
        marginVertical: 20,
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    commentBox: {
        color: colors.Text03,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Gray400,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    projectMarker: {
        width: 22,
        height: 22,
        borderRadius: 100,
        marginRight: 10,
    },
    innerContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        paddingVertical: 10,
        marginBottom: 4,
    },
    line1: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Text03,
        marginTop: 16,
        marginBottom: 8,
        opacity: 0.6,
    },
    line2: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Text03,
        marginVertical: 16,
        opacity: 0.6,
    },
    allMembers: {
        ...global.subtitle1,
        color: 'white',
    },
    button: {
        alignSelf: 'center',
        paddingHorizontal: 16,
    },
})

export default GoogleMeetModal
