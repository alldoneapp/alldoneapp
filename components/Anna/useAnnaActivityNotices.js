import { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

const EMPTY = {}
const timestamp = value => {
    const number = value?.toMillis ? value.toMillis() : Number(value)
    return Number.isFinite(number) ? number : 0
}

// Read the same followed (red) activity that drives the app badges. A notice is
// only a local navigation hint: it neither reads the item nor messages Anna.
export function collectAnnaActivity({ user, projects, feeds, chats, activeChat, threads }) {
    const events = []
    const excludedProjects = new Set([...(user.archivedProjectIds || []), ...(user.templateProjectIds || [])])
    const conversationChats = new Set(threads.map(thread => `${thread.projectId}/${thread.chatId || thread.id}`))
    projects.forEach(project => {
        const projectId = project.id
        if (excludedProjects.has(projectId)) return
        const base = `/projects/${projectId}/user/${user.uid}`
        const projectName = project.name || ''
        const projectFeeds = feeds[projectId] || []
        projectFeeds.forEach(feed => {
            if (!feed.id || feed.creatorId === user.uid) return
            events.push({
                id: `feed/${projectId}/${feed.objectTypes}/${feed.objectId}/${feed.id}`,
                kind: 'feed',
                occurredAt: timestamp(feed.lastChangeDate),
                path: `${base}/updates/followed`,
                projectName,
                entryText: feed.entryText || '',
            })
        })
        Object.entries(chats[projectId] || {}).forEach(([chatId, chat]) => {
            if (
                conversationChats.has(`${projectId}/${chatId}`) ||
                (activeChat?.projectId === projectId && activeChat?.chatId === chatId)
            )
                return
            const notifications = chat.followedNotifications || []
            notifications.forEach(notification => {
                if (!notification.commentId) return
                events.push({
                    id: `chat/${projectId}/${chatId}/${notification.commentId}`,
                    kind: 'chat',
                    occurredAt: timestamp(notification.date),
                    path: `${base}/chats/followed`,
                    projectName,
                })
            })
        })
    })
    return events.sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id))
}

export default function useAnnaActivityNotices(userId, conversation, threads, enabled) {
    const user = useSelector(state => state.loggedUser)
    const projects = useSelector(state => state.loggedUserProjects)
    const feeds = useSelector(state => state.followedFeedsData || EMPTY)
    const chats = useSelector(state => state.projectChatNotifications || EMPTY)
    const activeChat = useSelector(state => state.activeChatData)
    const [state, setState] = useState({ userId, notices: [] })
    const tracker = useRef(null)
    const threadKey = JSON.stringify(
        [...threads, conversation].map(thread => ({ projectId: thread.projectId, id: thread.chatId || thread.id }))
    )

    useEffect(() => {
        if (!enabled || !userId || user?.uid !== userId) {
            tracker.current = null
            return
        }
        const events = collectAnnaActivity({
            user,
            projects: projects || [],
            feeds,
            chats,
            activeChat,
            threads: JSON.parse(threadKey),
        })
        if (!tracker.current || tracker.current.userId !== userId) {
            // Baseline existing unread activity. Also ignore old items arriving
            // in a delayed first snapshot, instead of replaying the inbox.
            tracker.current = { userId, since: Date.now(), seen: new Set(events.map(event => event.id)) }
            setState(previous => (previous.userId === userId ? previous : { userId, notices: [] }))
            return
        }
        const current = tracker.current
        const incoming = events.filter(event => !current.seen.has(event.id) && event.occurredAt >= current.since)
        events.forEach(event => current.seen.add(event.id))
        if (current.seen.size > 5000) {
            current.since = Date.now()
            current.seen = new Set(events.map(event => event.id))
        }
        if (!incoming.length) return
        const created = Date.now()
        setState(previous => ({
            userId,
            notices: [
                ...(previous.userId === userId ? previous.notices : []),
                ...incoming.map(event => ({
                    ...event,
                    created,
                    projectId: conversation.projectId,
                    chatId: conversation.id,
                })),
            ].slice(-100),
        }))
    }, [userId, user, projects, feeds, chats, activeChat, threadKey, enabled, conversation.projectId, conversation.id])

    return state.userId === userId ? state.notices : []
}
