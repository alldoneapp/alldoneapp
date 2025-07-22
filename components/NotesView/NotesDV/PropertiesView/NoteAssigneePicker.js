import React, { useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { sortBy } from 'lodash'
import { useSelector } from 'react-redux'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'

export default function NoteAssigneePicker({
    note,
    onSelectUser,
    closePopover,
    delayClosePopover,
    saveOwnerBeforeSaveNote,
    projectId,
}) {
    const [width, height] = useWindowSize()
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const [selectedUserId, setSelectedUserId] = useState(note.userId)
    const sortedUsers = sortBy(usersInProject, [item => item.displayName.toLowerCase()])

    const renderUserItem = (user, i) => {
        return (
            <TouchableOpacity
                key={i}
                onPress={e => {
                    if (e != null) {
                        e.preventDefault()
                        e.stopPropagation()
                    }

                    if (selectedUserId === user.uid) {
                        closePopover()
                        return false
                    }
                    if (saveOwnerBeforeSaveNote !== undefined) {
                        closePopover()
                        if (selectedUserId !== user.uid) {
                            saveOwnerBeforeSaveNote(user.uid)
                        }
                        return false
                    } else {
                        selectUser(user)
                    }
                }}
            >
                <View style={localStyles.userItem}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                        <Image source={{ uri: user.photoURL }} style={localStyles.userImage} />
                        <Text style={[styles.subtitle1, { color: '#ffffff', marginLeft: 8 }]} numberOfLines={1}>
                            {user.displayName}
                        </Text>
                    </View>
                    {selectedUserId === user.uid ? (
                        <Icon name="check" size={24} color="white" />
                    ) : (
                        <View style={{ width: 24, height: 24 }} />
                    )}
                </View>
            </TouchableOpacity>
        )
    }

    const selectUser = user => {
        setSelectedUserId(user.id)
        onSelectUser(user)
        return false
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={{ marginBottom: 20 }}>
                    <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Choose a user')}</Text>
                    <Text style={[styles.body2, { color: colors.Text03 }]}>
                        {translate('Select the user this note will assign to')}
                    </Text>
                </View>

                {sortedUsers.map((user, i) => {
                    return renderUserItem(user, i)
                })}

                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={delayClosePopover}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    userItem: {
        height: 48,
        paddingVertical: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    userImage: {
        backgroundColor: colors.Text03,
        height: 32,
        width: 32,
        borderRadius: 100,
    },
})
