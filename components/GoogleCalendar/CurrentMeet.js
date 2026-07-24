import React, { useEffect, useState } from 'react'
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View, Linking } from 'react-native'
import { sortBy } from 'lodash'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import global, { colors } from '../styles/global'
import Backend from '../../utils/BackendBridge'

export default function CurrentMeet({ meeting, projectId }) {
    const usersInProject = useSelector(state => state.projectUsers[projectId])

    const [guests, setGuests] = useState([])

    const selectedProjectUsers = sortBy(usersInProject)
    const owner = selectedProjectUsers.filter(el => el.uid === meeting.ownerId)[0]

    const humanTime = (t2, t1) => {
        const diff = Math.max(t1, t2) - Math.min(t1, t2)
        const SEC = 1000,
            MIN = 60 * SEC,
            HRS = 60 * MIN
        const min = Math.floor((diff % HRS) / MIN).toLocaleString('en-US', { minimumIntegerDigits: 2 })
        const sec = Math.floor((diff % MIN) / SEC).toLocaleString('en-US', { minimumIntegerDigits: 2 })
        return `${min}:${sec}`
    }
    const [time, setTime] = useState(humanTime(new Date(), new Date(meeting.startTime)))

    const timer = setInterval(() => {
        const now = new Date()
        setTime(humanTime(now, new Date(meeting.startTime)))
    }, 1000)

    setTimeout(function () {
        clearInterval(timer)
    }, 1100)

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
        if (meeting && selectedProjectUsers.length > 0) {
            const newArray = meeting.guests.sort(compare).filter(el => {
                return selectedProjectUsers.some(f => {
                    el.photoURL = f.photoURL
                    el.uid = f.uid
                    return f.email === el.email
                })
            })
            setGuests(newArray)
        }
    }, [meeting])

    const openLink = () => {
        if (Platform.OS === 'web') {
            window.open(meeting.link, '_blank')
        } else {
            Linking.openURL(meeting.link)
        }
    }

    const removeEvent = () => {
        Backend.deleteEvent(projectId, meeting.link.split('/')[3])
    }

    setTimeout(() => {
        removeEvent()
    }, 10 * 60 * 1000)

    const shortTopic = topic => {
        return `${topic.slice(0, 12)} ${topic.length > 12 ? '...' : ''}`
    }

    const attendees = email => {
        const foundIndex = meeting.guests.findIndex(x => x.email === email)
        try {
            return meeting.guests[foundIndex].attend
        } catch (e) {
            return null
        }
    }

    return (
        <View style={localStyles.container}>
            <TouchableOpacity>
                <a
                    href={meeting.link}
                    target="_blank"
                    style={{ textDecoration: 'none' }}
                    onClick={e => {
                        e.stopPropagation()
                        e.preventDefault()
                        openLink()
                    }}
                >
                    <View style={localStyles.wrap}>
                        <Icon name={'video-in-progress'} size={22} color={'#09D693'} />
                        <Text style={[global.body2, localStyles.topic]}>
                            {time} • {shortTopic(meeting.topic)}
                        </Text>
                    </View>
                    <View style={[localStyles.wrap, { marginTop: 8 }]}>
                        <View>
                            {owner && (
                                <Image key={owner.uid} source={{ uri: owner.photoURL }} style={localStyles.userImage} />
                            )}
                            <Text style={[localStyles.backIcon, { backgroundColor: '#EAFFF8' }]} />
                            <Icon name={'check-thiker'} size={8} color={'#057651'} style={[localStyles.icons]} />
                        </View>
                        {guests &&
                            guests.map(item => (
                                <View key={item.uid}>
                                    <Image
                                        key={item.uid}
                                        source={{ uri: item.photoURL }}
                                        style={localStyles.userImage}
                                    />
                                    {attendees(item.email) === 0 ? null : attendees(item.email) === 1 ? (
                                        <>
                                            <Text style={[localStyles.backIcon, { backgroundColor: '#EAFFF8' }]} />
                                            <Icon
                                                name={'check-thiker'}
                                                size={8}
                                                color={'#057651'}
                                                style={localStyles.icons}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <Text style={[localStyles.backIcon, { backgroundColor: '#FFEBEB' }]} />
                                            <Icon
                                                name={'x-thicker'}
                                                size={8}
                                                color={'#BD0303'}
                                                style={localStyles.icons}
                                            />
                                        </>
                                    )}
                                </View>
                            ))}
                    </View>
                </a>
            </TouchableOpacity>
            <View style={[localStyles.closeContainer]}>
                <TouchableOpacity style={localStyles.closeButton} onPress={() => removeEvent()}>
                    <Icon name="x" size={16} color={colors.Secondary100} />
                </TouchableOpacity>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 'auto',
        paddingHorizontal: 26,
        paddingVertical: 8,
    },
    wrap: {
        flexDirection: 'row',
        flex: 1,
        flexWrap: 'wrap',
    },
    userImage: {
        height: 18,
        width: 18,
        borderRadius: 10,
        marginRight: 8,
        marginBottom: 8,
    },
    topic: {
        color: colors.Grey400,
        marginLeft: 8,
    },
    backIcon: {
        borderRadius: 10,
        width: 12,
        height: 12,
        marginLeft: 12,
        bottom: 8,
        position: 'absolute',
    },
    icons: {
        marginLeft: 14,
        bottom: 9,
        position: 'absolute',
    },
    closeContainer: {
        position: 'absolute',
        top: 10,
        right: 27,
        marginLeft: 10,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
