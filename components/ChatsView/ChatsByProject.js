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
import useGetUnreadChats from '../../hooks/Chats/useGetUnreadChats'
import { unwatchChatsAmount, watchChatsAmount } from '../../utils/backends/Chats/chatNumbers'
import ChatsMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Chats/ChatsMoreButton'

function ChatsByProject({ project, isInAllProjects, setChatXProject, unreadOnly }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const dispatch = useDispatch()
    const [expanded, setExpanded] = useState(false)
    const [totalChats, setTotalChats] = useState(undefined)
    // The smallest page this list ever shows. `toRender` must never fall below it: Firestore
    // rejects `limit(n)` for n <= 0 with "limit() requires a positive number", which used to break
    // the whole chat list when the collapse button was pressed with nothing to collapse (AT-2162).
    const initialToRender = isInAllProjects && loggedUser.numberChatsAllTeams ? loggedUser.numberChatsAllTeams : 10
    const [toRender, setToRender] = useState(initialToRender)
    const [atEnd, setAtEnd] = useState(false)
    const projectNotifications = useSelector(state => state.projectChatNotifications[project.id])
    const loadedChats = useGetChats(project.id, toRender, chatsActiveTab)
    const loadedStickyChats = useGetStickyChats(project.id, toRender, chatsActiveTab)
    const unreadChats = useGetUnreadChats(project.id, projectNotifications, chatsActiveTab, unreadOnly, toRender)
    const chats = unreadOnly ? unreadChats.chats : loadedChats
    const stickyChats = unreadOnly ? unreadChats.stickyChats : loadedStickyChats

    const today = moment().format('YYYYMMDD')
    const { [today]: todayChats, ...rest } = chats
    const isThereChats = Object.keys(chats).length > 0 || Object.keys(stickyChats).length > 0
    const totalVisibleChats = unreadOnly ? unreadChats.total : totalChats
    const inSelectedProject = !isInAllProjects

    useEffect(() => {
        const watcherKey = v4()
        // `toRender` is forwarded so the amount query can be capped at `toRender + 1` documents
        // instead of downloading the project's whole chats collection just to count it (AT-2162).
        watchChatsAmount(project.id, watcherKey, setTotalChats, chatsActiveTab, toRender)
        return () => {
            unwatchChatsAmount(watcherKey)
        }
    }, [project.id, chatsActiveTab, toRender])

    useEffect(() => {
        setChatXProject(current => ({ ...current, [project.id]: isThereChats }))
    }, [isThereChats])

    const contractChat = () => {
        setToRender(current => Math.max(initialToRender, current - 10))
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
    }, [toRender, totalChats])

    return (isInAllProjects ? isThereChats : true) ? (
        <View style={checkIfSelectedAllProjects(selectedProjectIndex) && { marginBottom: 25 }}>
            <ProjectHeader
                projectIndex={project.index}
                projectId={project.id}
                customRight={
                    isInAllProjects ? (
                        <MarkAsRead projectId={project.id} userId={loggedUser.uid} />
                    ) : (
                        <View style={localStyles.headerActions}>
                            <MarkAsRead
                                projectId={project.id}
                                userId={loggedUser.uid}
                                containerStyle={localStyles.markAsReadInline}
                            />
                            <ChatsMoreButton
                                projectId={project.id}
                                userId={loggedUser.uid}
                                wrapperStyle={localStyles.moreButtonWrapper}
                                buttonStyle={localStyles.moreButton}
                                iconSize={16}
                            />
                        </View>
                    )
                }
                showRootSectionNavigation={!isInAllProjects}
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
                {totalVisibleChats > toRender && isThereChats && (
                    <ShowMoreButton
                        expanded={false}
                        expand={expandChat}
                        style={[localStyles.showMore, { marginRight: 16 }]}
                    />
                )}

                {(unreadOnly || toRender <= totalVisibleChats) &&
                    expanded &&
                    toRender > initialToRender &&
                    isThereChats && (
                        <ShowMoreButton
                            expanded={true}
                            contract={contractChat}
                            style={localStyles.showMore}
                            check={'toRender'}
                        />
                    )}

                {/* Only offer to collapse when the list actually grew past its first page. */}
                {!unreadOnly && atEnd && isThereChats && toRender > initialToRender && (
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
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    markAsReadInline: {
        marginRight: 8,
    },
    moreButtonWrapper: {
        marginTop: 3,
        marginLeft: 2,
    },
    moreButton: {
        width: 18,
        height: 18,
        minWidth: 18,
        minHeight: 18,
    },
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

// The "All Projects" chats screen mounts one ChatsByProject per project (14 for the largest account
// measured in production; see the note in ChatsView.js).
// Without memoization every re-render of ChatsView re-rendered all of those subtrees, even though
// each one already subscribes to the state it needs. All props are referentially stable: `project`
// objects keep their identity through the parent's filter/sortBy, and `setChatXProject` is a
// useState setter.
export default React.memo(ChatsByProject)
