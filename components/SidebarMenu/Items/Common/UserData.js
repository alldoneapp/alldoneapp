import React from 'react'
import { Image, StyleSheet, View } from 'react-native'

import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import UserName from './UserName'
import UserRole from './UserRole'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import HelperFunctions from '../../../../utils/HelperFunctions'

export default function UserData({ user, projectIndex, projectId }) {
    const { expanded } = useCollapsibleSidebar()
    const { photoURL, uid, displayName, role } = user

    const projectRole = ProjectHelper.getUserRoleInProject(projectId, uid, role)
    const roleToShow = projectRole ? projectRole : role

    return (
        <View style={localStyles.container}>
            <Image source={{ uri: photoURL }} style={localStyles.image} />
            {expanded && (
                <>
                    <UserName userId={uid} name={HelperFunctions.getFirstName(displayName)} />
                    {!!roleToShow && <UserRole user={user} projectIndex={projectIndex} role={roleToShow} />}
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    image: {
        height: 20,
        width: 20,
        borderRadius: 100,
        marginRight: 10,
    },
})
