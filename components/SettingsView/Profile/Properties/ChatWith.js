import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useDispatch } from 'react-redux'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import ProjectHelper from '../../ProjectsSettings/ProjectHelper'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_USER_CHAT } from '../../../../utils/TabNavigationConstants'
import NavigationService from '../../../../utils/NavigationService'

export default function ChatWith({ user, projectId }) {
    const dispatch = useDispatch()
    const navigateToChat = () => {
        const project = ProjectHelper.getProjectById(projectId)
        const navData = { contact: user, project }
        NavigationService.navigate('UserDetailedView', navData)
        dispatch(setSelectedNavItem(DV_TAB_USER_CHAT))
    }

    return (
        <View style={localStyles.footer}>
            <View>
                <Button
                    icon={'message-circle'}
                    title={translate('Chat with', { name: user.displayName })}
                    type={'ghost'}
                    onPress={navigateToChat}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    footer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 32,
    },
})
