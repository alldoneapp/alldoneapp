import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View, Image } from 'react-native'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import Backend from '../../../utils/BackendBridge'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import Button from '../../UIControls/Button'
import { getUserData } from '../../../utils/backends/Users/usersFirestore'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'

export default function SkillOwner({ userId, projectId }) {
    const isAnonymous = useSelector(state => !!state.loggedUser.isAnonymous)
    const [ownerData, setOwnerData] = useState({})

    useEffect(() => {
        const owner = TasksHelper.getUserInProject(projectId, userId)
        if (owner || isAnonymous) {
            const visibleOwner = owner || SharedHelper.createAnonymousResourceUser(userId)
            setOwnerData({ displayName: visibleOwner.displayName, photoURL: visibleOwner.photoURL })
        } else {
            getUserData(userId, false).then(owner => {
                setOwnerData(owner ? { displayName: owner.displayName, photoURL: owner.photoURL } : {})
            })
        }
    }, [userId, projectId, isAnonymous])

    const { displayName, photoURL } = ownerData

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="user" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Owner')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <Button
                    type={'ghost'}
                    icon={<Image style={localStyles.userImage} source={{ uri: photoURL }} />}
                    title={displayName ? displayName.trim().split(' ')[0] : `${translate('Loading')}...`}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
})
