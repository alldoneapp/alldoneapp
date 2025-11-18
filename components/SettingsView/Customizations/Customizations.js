import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import URLsSettings, { URL_CUSTOMIZATIONS } from '../../../URLSystem/Settings/URLsSettings'
import { useSelector } from 'react-redux'
import MaxNumberTasksToday from './Properties/MaxNumberTasksToday'
import MaxUsersInSidebar from './Properties/MaxUsersInSidebar'
import MaxNumberGoals from './Properties/MaxNumberGoals'
import MaxNumberChats from './Properties/MaxNumberChats'
import BotAdvaiceTriggerPercent from './Properties/BotAdvaiceTriggerPercent'
import SomedayTaskTriggerPercent from './Properties/SomedayTaskTriggerPercent'
import GlobalKarmaPoints from './Properties/GlobalKarmaPoints'
import DateFormat from './Properties/DateFormat'
import NotificationEmail from './Properties/NotificationEmail'
import Notifications from './Properties/Notifications'
import ServerTime from './Properties/ServerTime'
import UserTimezone from './Properties/UserTimezone'
import Theme from './Properties/Theme'
import Language from './Properties/Language'
import { useTranslator } from '../../../i18n/TranslationService'
import Header from './Header'
import DefaultProject from './Properties/DefaultProject/DefaultProject'

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
                <View style={{ flex: 1, marginRight: mobile ? 0 : 72 }}>
                    <MaxNumberTasksToday userId={loggedUser.uid} numberTodayTasks={loggedUser.numberTodayTasks} />
                    <MaxUsersInSidebar userId={loggedUser.uid} numberUsersSidebar={loggedUser.numberUsersSidebar} />
                    <MaxNumberGoals userId={loggedUser.uid} numberGoalsAllTeams={loggedUser.numberGoalsAllTeams} />
                    <MaxNumberChats userId={loggedUser.uid} numberChatsAllTeams={loggedUser.numberChatsAllTeams} />
                    <BotAdvaiceTriggerPercent
                        userId={loggedUser.uid}
                        botAdvaiceTriggerPercent={loggedUser.botAdvaiceTriggerPercent}
                    />
                    <SomedayTaskTriggerPercent
                        userId={loggedUser.uid}
                        somedayTaskTriggerPercent={loggedUser.somedayTaskTriggerPercent || 10}
                    />
                    <GlobalKarmaPoints />
                    <DateFormat userId={loggedUser.uid} dateFormat={loggedUser.dateFormat} />
                </View>

                <View style={{ flex: 1 }}>
                    <Theme userId={loggedUser.uid} themeName={loggedUser.themeName} />
                    <DefaultProject user={loggedUser} />
                    <Language userId={loggedUser.uid} language={loggedUser.language} />
                    <NotificationEmail
                        userId={loggedUser.uid}
                        email={loggedUser.email}
                        notificationEmail={loggedUser.notificationEmail}
                    />
                    <Notifications />
                    <ServerTime />
                    <UserTimezone />
                </View>
            </View>
        </View>
    )
}

export default Customizations

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    userSettings: {
        flexDirection: 'row',
    },
    userSettingsMobile: {
        flexDirection: 'column',
    },
})
