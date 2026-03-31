import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import URLsSettings, { URL_CUSTOMIZATIONS } from '../../../URLSystem/Settings/URLsSettings'
import { useSelector } from 'react-redux'
import MaxNumberTasksToday from './Properties/MaxNumberTasksToday'
import MaxUsersInSidebar from './Properties/MaxUsersInSidebar'
import MaxNumberGoals from './Properties/MaxNumberGoals'
import MaxNumberChats from './Properties/MaxNumberChats'

import SomedayTaskTriggerPercent from './Properties/SomedayTaskTriggerPercent'
import GlobalKarmaPoints from './Properties/GlobalKarmaPoints'
import DateFormat from './Properties/DateFormat'
import NotificationEmail from './Properties/NotificationEmail'
import AssistantEmail from './Properties/AssistantEmail'
import Notifications from './Properties/Notifications'
import ServerTime from './Properties/ServerTime'
import UserTimezone from './Properties/UserTimezone'
import Theme from './Properties/Theme'
import Language from './Properties/Language'
import { useTranslator } from '../../../i18n/TranslationService'
import Header from './Header'
import DefaultProject from './Properties/DefaultProject/DefaultProject'
import SidebarNavigation from './Properties/SidebarNavigation'

const Customizations = () => {
    useTranslator()
    const mobile = useSelector(state => state.smallScreen)
    const loggedUser = useSelector(state => state.loggedUser)

    useEffect(() => {
        writeBrowserURL()
    }, [])

    const writeBrowserURL = () => {
        URLsSettings.push(URL_CUSTOMIZATIONS)
    }

    return (
        <View style={localStyles.container}>
            <Header />
            <View style={[localStyles.userSettings, mobile ? localStyles.userSettingsMobile : undefined]}>
                <View style={localStyles.settingsColumn}>
                    <MaxNumberTasksToday userId={loggedUser.uid} numberTodayTasks={loggedUser.numberTodayTasks} />
                    <MaxUsersInSidebar userId={loggedUser.uid} numberUsersSidebar={loggedUser.numberUsersSidebar} />
                    <MaxNumberGoals userId={loggedUser.uid} numberGoalsAllTeams={loggedUser.numberGoalsAllTeams} />
                    <MaxNumberChats userId={loggedUser.uid} numberChatsAllTeams={loggedUser.numberChatsAllTeams} />

                    <SomedayTaskTriggerPercent
                        userId={loggedUser.uid}
                        somedayTaskTriggerPercent={loggedUser.somedayTaskTriggerPercent || 10}
                    />
                    <GlobalKarmaPoints />
                    <DateFormat userId={loggedUser.uid} dateFormat={loggedUser.dateFormat} />
                    <Notifications />
                </View>

                {!mobile && <View style={localStyles.columnsSpacer} />}

                <View style={localStyles.settingsColumn}>
                    <Theme userId={loggedUser.uid} themeName={loggedUser.themeName} />
                    <SidebarNavigation
                        userId={loggedUser.uid}
                        sidebarNavigationMode={loggedUser.sidebarNavigationMode}
                    />
                    <DefaultProject user={loggedUser} />
                    <Language userId={loggedUser.uid} language={loggedUser.language} />
                    <NotificationEmail
                        userId={loggedUser.uid}
                        email={loggedUser.email}
                        notificationEmail={loggedUser.notificationEmail}
                    />
                    <ServerTime />
                    <UserTimezone />
                </View>
            </View>

            <AssistantEmail userId={loggedUser.uid} assistantEmailEnabled={loggedUser.assistantEmailEnabled === true} />
        </View>
    )
}

export default Customizations

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
    },
    userSettings: {
        flexDirection: 'row',
        width: '100%',
        alignSelf: 'stretch',
    },
    userSettingsMobile: {
        flexDirection: 'column',
    },
    settingsColumn: {
        flex: 1,
        minWidth: 0,
    },
    columnsSpacer: {
        width: 72,
    },
})
