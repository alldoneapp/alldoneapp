import { useEffect, useReducer } from 'react'
import { getSavedMessages, subscribeMessages } from './services'

export default (a, b, projectId, chatId) => {
    const [, refresh] = useReducer(value => value + 1, 0)
    useEffect(() => subscribeMessages(refresh), [])
    return Object.assign(
        [
            ...(new URLSearchParams(window.location.search).has('assistantFocus')
                ? Array.from({ length: 36 }, (_, index) => ({
                      id: `focus-history-${index}`,
                      creatorId: 'demo',
                      commentText: `Earlier message ${index + 1}: keep the launch conversation available while opening the assistant.`,
                      created: Date.now() - 3600000 + index * 1000,
                  }))
                : []),
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
