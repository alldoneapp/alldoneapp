import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'

import URLsAdminPanel, { URL_ADMIN_PANEL_USER } from '../../../URLSystem/AdminPanel/URLsAdminPanel'
import MaxNumberTasksToday from '../../SettingsView/Customizations/Properties/MaxNumberTasksToday'
import MaxUsersInSidebar from '../../SettingsView/Customizations/Properties/MaxUsersInSidebar'
import MaxNumberGoals from '../../SettingsView/Customizations/Properties/MaxNumberGoals'
import MaxNumberChats from '../../SettingsView/Customizations/Properties/MaxNumberChats'

import DateFormat from '../../SettingsView/Customizations/Properties/DateFormat'
import NotificationEmail from '../../SettingsView/Customizations/Properties/NotificationEmail'
import Theme from '../../SettingsView/Customizations/Properties/Theme'
import Language from '../../SettingsView/Customizations/Properties/Language'
import DefaultProject from '../../SettingsView/Customizations/Properties/DefaultProject/DefaultProject'
import UserSelection from './UserSelection'
import { translate } from '../../../i18n/TranslationService'
import styles, { colors } from '../../styles/global'
import UserData from '../../SettingsView/Profile/Properties/UserData'
import GlobalUserInfo from '../../SettingsView/Profile/Properties/GlobalUserInfo'
import UserGold from './UserGold'
import RemoveUser from '../../SettingsView/Profile/Properties/RemoveUser'

export default function UserCustomizations() {
    const mobile = useSelector(state => state.smallScreen)
    const [user, setUser] = useState(null)
    const [text, setText] = useState('')

    useEffect(() => {
        URLsAdminPanel.push(URL_ADMIN_PANEL_USER)
    }, [])

    return (
        <View style={localStyles.container}>
            <UserSelection setUser={setUser} setText={setText} />
            {user ? (
                <>
                    <UserData user={user} />
                    <View
                        style={[
                            localStyles.propertiesContainer,
                            mobile ? localStyles.propertiesContainerMobile : undefined,
                        ]}
                    >
                        <View style={{ flex: 1, marginRight: mobile ? 0 : 72 }}>
                            <GlobalUserInfo
                                userId={user.uid}
                                role={user.role}
                                company={user.company}
                                description={user.description}
                            />
                            <MaxNumberTasksToday userId={user.uid} numberTodayTasks={user.numberTodayTasks} />
                            <MaxUsersInSidebar userId={user.uid} numberUsersSidebar={user.numberUsersSidebar} />
                            <MaxNumberGoals userId={user.uid} numberGoalsAllTeams={user.numberGoalsAllTeams} />
                            <MaxNumberChats userId={user.uid} numberChatsAllTeams={user.numberChatsAllTeams} />
                        </View>

                        <View style={{ flex: 1 }}>
                            <UserGold userId={user.uid} gold={user.gold} />
                            <Theme userId={user.uid} themeName={user.themeName} />
                            <DefaultProject user={user} />
                            <Language userId={user.uid} language={user.language} />
                            <NotificationEmail
                                userId={user.uid}
                                email={user.email}
                                notificationEmail={user.notificationEmail}
                            />
                            <DateFormat userId={user.uid} dateFormat={user.dateFormat} />
                        </View>
                    </View>
                    <View style={localStyles.removeUserContainer}>
                        <RemoveUser user={user} />
                    </View>
                </>
            ) : (
                <View style={{ flex: 1 }}>
                    <Text style={localStyles.text}>{translate(text)}</Text>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    propertiesContainer: {
        flexDirection: 'row',
        marginTop: 32,
    },
    propertiesContainerMobile: {
        flexDirection: 'column',
    },
    text: { ...styles.title6, color: colors.Text04, textAlign: 'center', marginTop: 8 },
    removeUserContainer: {
        marginTop: 54,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginBottom: 32,
    },
})
