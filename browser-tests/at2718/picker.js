import React, { useEffect } from 'react'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TOPICS_TAB,
} from '../../components/Feeds/CommentsTextInput/textInputHelper'

const options = [
    ['Task', { id: 'task-1' }, MENTION_MODAL_TASKS_TAB],
    ['Goal', { id: 'goal-1' }, MENTION_MODAL_GOALS_TAB],
    ['Note', { id: 'note-1', projectId: 'other-project' }, MENTION_MODAL_NOTES_TAB],
    ['Chat', { id: 'chat-1' }, MENTION_MODAL_TOPICS_TAB],
    ['Contact', { uid: 'contact-1', displayName: 'Karl Contact' }, MENTION_MODAL_CONTACTS_TAB],
    ['Assistant', { uid: 'assistant-1', displayName: 'Carl Code', isAssistant: true }, MENTION_MODAL_CONTACTS_TAB],
]

// Deterministic search results, retaining the production editor's @ detection,
// selection callback, insertion, serialization and Enter-to-send guard.
export default function Picker({ selectItemToMention, mentionText }) {
    useEffect(() => {
        const select = event => {
            if (event.key === 'Enter') selectItemToMention(options[0][1], options[0][2])
        }
        document.addEventListener('keydown', select)
        return () => document.removeEventListener('keydown', select)
    }, [selectItemToMention])
    return (
        <div data-picker style={{ width: 240, padding: 8, background: 'white' }}>
            <span>Search: {mentionText}</span>
            {options.map(([name, item, tab]) => (
                <button key={name} type="button" onClick={() => selectItemToMention(item, tab)}>
                    {name}
                </button>
            ))}
        </div>
    )
}
