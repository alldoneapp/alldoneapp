import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { getFollowedFeedAmount, getRedChatNotifications } from '../../utils/notificationBadges'
import { annaActivityHistory } from './annaActivityHistory'

const EMPTY = {}
const timestamp = value => {
    const number = value?.toMillis ? value.toMillis() : Number(value)
    return Number.isFinite(number) ? number : 0
}

// Read the same followed (red) activity that drives the app badges. A notice is
// only a local navigation hint: it neither reads the item nor messages Anna.
export function collectAnnaActivity({ user, projects, feeds, feedAmount, chats, activeChat }) {
    const events = []
    const names = new Map(projects.map(project => [project.id, project.name || '']))
    // The global feed watcher already applies membership/privacy and followed filtering.
    // Use its committed badge count too, rather than interpreting leftover payloads as new red activity.
    if (feedAmount > 0)
        Object.entries(feeds).forEach(([projectId, projectFeeds]) => {
            projectFeeds.forEach(feed => {
                if (!feed.id) return
                events.push({
                    id: `feed/${projectId}/${feed.objectTypes}/${feed.objectId}/${feed.id}`,
                    kind: 'feed',
                    occurredAt: timestamp(feed.lastChangeDate),
                    sourceProjectId: projectId,
                    path: `/projects/${projectId}/user/${user.uid}/updates/followed`,
                    projectName: names.get(projectId) || '',
                    entryText: feed.entryText || '',
                    source: feed,
                })
            })
        })
    const redChats = getRedChatNotifications(chats, activeChat, user)
    Object.entries(redChats).forEach(([projectId, projectChats]) => {
        Object.entries(projectChats).forEach(([chatId, chat]) => {
            if (!(chat?.totalFollowed > 0)) return
            const notifications = chat.followedNotifications || []
            notifications.forEach(notification => {
                if (!notification.commentId) return
                events.push({
                    id: `chat/${projectId}/${chatId}/${notification.commentId}`,
                    kind: 'chat',
                    occurredAt: timestamp(notification.date),
                    sourceProjectId: projectId,
                    path: `/projects/${projectId}/user/${user.uid}/chats/followed`,
                    projectName: names.get(projectId) || '',
                    source: notification,
                })
            })
        })
    })
    return events.sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id))
}

export default function useAnnaActivityNotices(userId, conversation, enabled) {
    const user = useSelector(state => state.loggedUser)
    const projects = useSelector(state => state.loggedUserProjects)
    const feeds = useSelector(state => state.followedFeedsData || EMPTY)
    const feedAmount = useSelector(getFollowedFeedAmount)
    const chats = useSelector(state => state.projectChatNotifications || EMPTY)
    const activeChat = useSelector(state => state.activeChatData)
    const saved = useMemo(() => annaActivityHistory.read(userId), [userId])
    const [state, setState] = useState({ userId, notices: saved })
    const tracker = useRef(null)

    useEffect(() => {
        if (!enabled || !userId || user?.uid !== userId) {
            tracker.current = null
            return
        }
        const events = collectAnnaActivity({
            user,
            projects: projects || [],
            feeds,
            feedAmount,
            chats,
            activeChat,
        })
        if (!tracker.current || tracker.current.userId !== userId) {
            // Baseline existing unread activity. Also ignore old items arriving
            // in a delayed first snapshot, instead of replaying the inbox.
            tracker.current = { userId, since: Date.now(), seen: new Set([...saved, ...events].map(event => event.id)) }
            setState(previous => (previous.userId === userId ? previous : { userId, notices: saved }))
            return
        }
        const current = tracker.current
        const incoming = events.filter(event => !current.seen.has(event.id) && event.occurredAt >= current.since)
        events.forEach(event => current.seen.add(event.id))
        if (current.seen.size > 5000) {
            current.since = Date.now()
            current.seen = new Set(events.map(event => event.id))
        }
        if (!incoming.length || !conversation.projectId || !conversation.id) return
        const created = Date.now()
        const arrivals = incoming.map(({ source, ...event }) => ({
            ...annaActivityHistory.append(userId, {
                ...event,
                created,
                projectId: conversation.projectId,
                chatId: conversation.id,
            }),
            source,
        }))
        setState(previous => ({
            userId,
            notices: [
                ...new Map(
                    [...(previous.userId === userId ? previous.notices : saved), ...arrivals].map(notice => [
                        notice.id,
                        notice,
                    ])
                ).values(),
            ],
        }))
    }, [
        userId,
        user,
        projects,
        feeds,
        feedAmount,
        chats,
        activeChat,
        saved,
        enabled,
        conversation.projectId,
        conversation.id,
    ])

    if (user?.uid !== userId) return []
    return state.userId === userId ? state.notices : saved
}
