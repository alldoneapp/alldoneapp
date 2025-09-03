import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import GlobalXP from './GlobalXP'
import GlobalUserInfo from './GlobalUserInfo'
import GlobalUserPhone from './GlobalUserPhone'
import UserInfo from '../../../UserDetailedView/UserProperties/UserInfo'
import useInProfileSettings from '../useInProfileSettings'
import SharedHelper from '../../../../utils/SharedHelper'
import UserGold from './UserGold'

export default function ProfileProperties({ user, projectId, projectIndex }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const role = useSelector(state => state.loggedUser.role)
    const company = useSelector(state => state.loggedUser.company)
    const description = useSelector(state => state.loggedUser.description)
    const phone = useSelector(state => state.loggedUser.phone)
    const inSettings = useInProfileSettings()

    return (
        <View style={[localStyles.container, smallScreen && localStyles.containerMobile]}>
            <View style={{ flex: 1, width: smallScreen ? '100%' : '50%', marginRight: smallScreen ? 0 : 36 }}>
                {inSettings ? (
                    <GlobalUserInfo userId={loggedUserId} role={role} company={company} description={description} />
                ) : (
                    <UserInfo
                        projectId={projectId}
                        projectIndex={projectIndex}
                        user={user}
                        accessGranted={SharedHelper.accessGranted(null, projectId)}
                    />
                )}
                <UserGold gold={user.gold} />
            </View>
            <View style={{ flex: 1, width: smallScreen ? '100%' : '50%', marginLeft: smallScreen ? 0 : 36 }}>
                <GlobalXP user={user} />
                {inSettings && <GlobalUserPhone userId={loggedUserId} phone={phone} />}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        marginTop: 32,
    },
    containerMobile: {
        flexDirection: 'column',
    },
})
