import React, { useEffect, useState } from 'react'
import v4 from 'uuid/v4'
import moment from 'moment'
import { sortBy } from 'lodash'
import { useDispatch, useSelector } from 'react-redux'
import { StyleSheet, View } from 'react-native'

import ChatsByDate from './ChatsByDate'
import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import useGetChats from '../../hooks/Chats/useGetChats'
import ShowMoreButton from '../UIControls/ShowMoreButton'
import ProjectHelper, { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import {
    hideFloatPopup,
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    switchProject,
} from '../../redux/actions'
import { DV_TAB_ROOT_CHATS } from '../../utils/TabNavigationConstants'
import MarkAsRead from './MarkAsRead'
import StickyChats from './StickyChats'
import useGetStickyChats from '../../hooks/Chats/useGetStickyChats'
import { unwatchChatsAmount, watchChatsAmount } from '../../utils/backends/Chats/chatNumbers'

function ChatsByProject({ project, isInAllProjects, chatXProject, setChatXProject }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const dispatch = useDispatch()
    const [expanded, setExpanded] = useState(false)
    const [totalChats, setTotalChats] = useState(undefined)
    const [toRender, setToRender] = useState(
        isInAllProjects && loggedUser.numberChatsAllTeams ? loggedUser.numberChatsAllTeams : 10
    )
    const [atEnd, setAtEnd] = useState(false)
    const chats = useGetChats(project.id, toRender, chatsActiveTab)
    const stickyChats = useGetStickyChats(project.id, toRender, chatsActiveTab)

    console.log(
        '📊 ChatsByProject: Loading state for project:',
        project.id,
        'regularChats:',
        Object.keys(chats).length,
        'stickyChats:',
        Object.keys(stickyChats).length
    )

    const today = moment().format('YYYYMMDD')
    const { [today]: todayChats, ...rest } = chats
    const isThereChats = Object.keys(chats).length > 0 || Object.keys(stickyChats).length > 0

    useEffect(() => {
        const watcherKey = v4()
        watchChatsAmount(project.id, watcherKey, setTotalChats, chatsActiveTab)
        return () => {
            unwatchChatsAmount(watcherKey)
        }
    }, [project.id, chatsActiveTab])

    useEffect(() => {
        setChatXProject({ ...chatXProject, [project.id]: isThereChats })
    }, [isThereChats])

    const contractChat = () => {
        setToRender(toRender - 10)
    }

    const expandChat = () => {
        if (isInAllProjects) {
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, project.id)
            dismissAllPopups(true, true, true)
            const actionsToDispatch = [
                hideFloatPopup(),
                setSelectedSidebarTab(DV_TAB_ROOT_CHATS),
                switchProject(project.index),
                setSelectedTypeOfProject(projectType),
            ]
            if (mobile) {
                actionsToDispatch.push(hideWebSideBar())
            }
            dispatch(actionsToDispatch)
        } else {
            setToRender(toRender + 10)
            setExpanded(true)
        }
    }

    useEffect(() => {
        if (totalChats / toRender < 1) {
            setAtEnd(true)
        } else setAtEnd(false)
    }, [toRender])

    return (isInAllProjects ? isThereChats : true) ? (
        <View style={checkIfSelectedAllProjects(selectedProjectIndex) && { marginBottom: 25 }}>
            <ProjectHeader
                projectIndex={project.index}
                projectId={project.id}
                customRight={<MarkAsRead projectId={project.id} userId={loggedUser.uid} />}
            />

            <StickyChats stickyChats={sortBy(stickyChats, [item => item.stickyData.days])} project={project} />

            <ChatsByDate
                project={project}
                dateString={'TODAY'}
                date={moment()}
                data={sortBy(todayChats, [item => -item.lastEditionDate])}
            />

            {Object.keys(rest)
                .sort((a, b) => b - a)
                .map(date => {
                    const timestamp = moment(`${date}`)
                    const dateString = timestamp.format(getDateFormat())
                    return (
                        <ChatsByDate
                            key={date}
                            project={project}
                            dateString={dateString}
                            date={timestamp}
                            data={sortBy(rest[date], [item => -item.lastEditionDate])}
                        />
                    )
                })}
            <View style={localStyles.container}>
                {totalChats > toRender && isThereChats && (
                    <ShowMoreButton
                        expanded={false}
                        expand={expandChat}
                        style={[localStyles.showMore, { marginRight: 16 }]}
                    />
                )}

                {toRender <= totalChats && expanded && toRender !== 10 && isThereChats && (
                    <ShowMoreButton
                        expanded={true}
                        contract={contractChat}
                        style={localStyles.showMore}
                        check={'toRender'}
                    />
                )}

                {atEnd && isThereChats && (
                    <ShowMoreButton
                        expanded={true}
                        contract={contractChat}
                        style={localStyles.showMore}
                        check={'atEnd'}
                    />
                )}
            </View>
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
    showMore: {
        flex: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 8,
        marginBottom: 8,
    },
})

export default ChatsByProject
