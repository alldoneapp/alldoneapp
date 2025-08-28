import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import CloseButton from '../../FollowUp/CloseButton'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import HelperFunctions from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import Avatar from '../../Avatar'

export default function ModalHeaderWithAvatar({ closeModal, userId, title, description, projectId }) {
    const user = TasksHelper.getUserInProject(projectId, userId) || TasksHelper.getContactInProject(projectId, userId)
    const { photoURL, displayName } = user
    const fullTitle = translate(title, { user: HelperFunctions.getFirstName(displayName) })
    return (
        <View>
            <View style={{ flexDirection: 'row' }}>
                <Avatar avatarId={userId} reviewerPhotoURL={photoURL} size={24} borderSize={0} />
                <Text style={localStyles.title}>{fullTitle}</Text>
            </View>
            <Text style={localStyles.description}>{description}</Text>
            <CloseButton style={localStyles.closeButton} close={closeModal} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    title: {
        ...styles.title7,
        color: '#ffffff',
        marginLeft: 8,
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 20,
    },
    closeButton: {
        top: -8,
        right: -8,
    },
})
