import React from 'react'
import { useSelector } from 'react-redux'

import CustomScrollView from '../../UIControls/CustomScrollView'
import AllProjects from '../AllProjects/AllProjects'
import AddProject from '../../AddNewProject/AddProject'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes/index'
import HelpItem from '../HelpItem'
import ActiveProjectsList from '../ActiveProjectsList'
import GuideProjects from '../GuideProjects'
import SharedProjectsList from '../SharedProjectsList'
import FooterArea from '../FooterArea'
import ArchivedProjects from '../ArchivedProjects'
import TemplateProjects from '../TemplateProjects'
import SettingsItem from '../SettingsItem'
import AdminItem from '../AdminItem'
import AlgoliaItemForIndexGlobalAssistantRecords from '../AlgoliaItemForIndexGlobalAssistantRecords'

export default function LoggedUserSidebarBody({ navigation, expanded, scrollView }) {
    const administratorUserId = useSelector(state => state.administratorUser.uid)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const templateProjectIdsAmount = useSelector(state => state.loggedUser.realTemplateProjectIds.length)
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu')

    const scrollToBottom = () => {
        scrollView.current.scrollTo({ x: 10000, y: 10000, animated: true })
    }

    const loggedUserIsAdminUser = loggedUserId === administratorUserId
    const showTemplatesArea = loggedUserId === administratorUserId || templateProjectIdsAmount > 0

    return (
        <CustomScrollView
            ref={scrollView}
            showsVerticalScrollIndicator={false}
            indicatorStyle={[theme.scroll, !expanded && { opacity: 0 }]}
        >
            <AllProjects navigation={navigation} />
            <ActiveProjectsList navigation={navigation} />
            <AddProject scrollToBottom={scrollToBottom} />
            <GuideProjects navigation={navigation} />
            {loggedUserIsAdminUser && <AdminItem />}
            {(loggedUserId === '64s4RwKszFXPYlmRCpdx91L3tiC3' || loggedUserId === 'W6mJp7iqgVWAyZq8BoOheotf6H72') && (
                <AlgoliaItemForIndexGlobalAssistantRecords />
            )}
            <ArchivedProjects navigation={navigation} />
            {showTemplatesArea && <TemplateProjects navigation={navigation} scrollToBottom={scrollToBottom} />}
            <SharedProjectsList navigation={navigation} />
            <HelpItem />
            <SettingsItem />
            <FooterArea expanded={expanded} />
        </CustomScrollView>
    )
}
