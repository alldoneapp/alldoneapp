import { useEffect, useState } from 'react'

const MAX_NOTICES = 50

// AT-2914 — a project chosen in the composer's project switcher is recorded in the
// chat history at the moment it was chosen. Like the view hints, these entries live
// only in this client: nothing is written to Firestore and the assistant never sees
// them. `projectSwitch` ({ id, projectId, name, created }) is a user's choice; the
// entry is bound to the chat that choice resolves to, so it lands in that project's
// thread and stays there after switching again. A choice that never resolves (the
// project turns out to be unavailable) leaves no entry.
export default function useAnnaProjectSwitchNotices(userId, conversation, projectSwitch) {
    const [state, setState] = useState({ userId, notices: [] })
    const { projectId, id: chatId } = conversation || {}

    useEffect(() => {
        if (!userId || !projectId || !chatId || !projectSwitch?.id || projectSwitch.projectId !== projectId) return
        setState(previous => {
            const notices = previous.userId === userId ? previous.notices : []
            const id = `project-switch-${projectSwitch.id}`
            if (notices.some(notice => notice.id === id)) return previous
            const created = Number(projectSwitch.created) || Date.now()
            return {
                userId,
                notices: [
                    ...notices.slice(-(MAX_NOTICES - 1)),
                    { id, type: 'projectSwitch', projectId, chatId, title: projectSwitch.name || '', created },
                ],
            }
        })
    }, [userId, projectId, chatId, projectSwitch?.id, projectSwitch?.projectId])

    return state.userId === userId ? state.notices : []
}
