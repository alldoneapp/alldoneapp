import { useEffect, useReducer } from 'react'
import { getSavedMessages, subscribeMessages } from './services'

export default (a, b, projectId, chatId) => {
    const [, refresh] = useReducer(value => value + 1, 0)
    useEffect(() => subscribeMessages(refresh), [])
    return Object.assign(
        [
            {
                id: 'm1',
                creatorId: 'demo',
                commentText: 'Please organize the launch and keep me updated.',
                created: Date.now() - 60000,
            },
            {
                id: 'm2',
                creatorId: 'a1',
                fromAssistant: true,
                commentText:
                    'I have created a task for the launch. I will keep the detailed progress there, and bring the decisions that need you back here.',
                created: Date.now() - 50000,
            },
            ...getSavedMessages().filter(message => message.projectId === projectId && message.chatId === chatId),
        ],
        { loaded: true }
    )
}
