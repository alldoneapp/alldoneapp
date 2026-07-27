import { normalizeAssistantObjectType, setAssistantForObject } from './objectAssistantHelper'
import { setTaskAssistant } from '../../../../../utils/backends/Tasks/tasksFirestore'
import { updateChatAssistant } from '../../../../../utils/backends/Chats/chatsFirestore'
import { setNoteAssistant } from '../../../../../utils/backends/Notes/notesFirestore'
import { setContactAssistant } from '../../../../../utils/backends/Contacts/contactsFirestore'
import { setUserAssistant } from '../../../../../utils/backends/Users/usersFirestore'
import { setSkillAssistant } from '../../../../../utils/backends/Skills/skillsFirestore'
import { setGoalAssistant } from '../../../../../utils/backends/Goals/goalsFirestore'

jest.mock('../../../../../utils/backends/Tasks/tasksFirestore', () => ({ setTaskAssistant: jest.fn() }))
jest.mock('../../../../../utils/backends/Chats/chatsFirestore', () => ({ updateChatAssistant: jest.fn() }))
jest.mock('../../../../../utils/backends/Notes/notesFirestore', () => ({ setNoteAssistant: jest.fn() }))
jest.mock('../../../../../utils/backends/Contacts/contactsFirestore', () => ({ setContactAssistant: jest.fn() }))
jest.mock('../../../../../utils/backends/Users/usersFirestore', () => ({ setUserAssistant: jest.fn() }))
jest.mock('../../../../../utils/backends/Skills/skillsFirestore', () => ({ setSkillAssistant: jest.fn() }))
jest.mock('../../../../../utils/backends/Goals/goalsFirestore', () => ({ setGoalAssistant: jest.fn() }))

describe('objectAssistantHelper', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test.each([
        ['task', 'tasks'],
        ['chat', 'chats'],
        ['topic', 'topics'],
        ['note', 'notes'],
        ['contact', 'contacts'],
        ['user', 'users'],
        ['skill', 'skills'],
        ['goal', 'goals'],
        ['tasks', 'tasks'],
    ])('normalizes %s to %s', (objectType, expected) => {
        expect(normalizeAssistantObjectType(objectType)).toBe(expected)
    })

    test.each([
        ['tasks', setTaskAssistant],
        ['chats', updateChatAssistant],
        ['topics', updateChatAssistant],
        ['notes', setNoteAssistant],
        ['contacts', setContactAssistant],
        ['users', setUserAssistant],
        ['skills', setSkillAssistant],
        ['goals', setGoalAssistant],
    ])('assigns the resolved assistant to %s objects', async (objectType, setter) => {
        await expect(
            setAssistantForObject('project-1', 'object-1', objectType, 'project-assistant', false)
        ).resolves.toBe(true)

        const expectedArgs =
            objectType === 'chats' || objectType === 'topics'
                ? ['project-1', 'object-1', 'project-assistant']
                : ['project-1', 'object-1', 'project-assistant', false]
        expect(setter).toHaveBeenCalledWith(...expectedArgs)
    })

    it('leaves unsupported object types unchanged', async () => {
        await expect(
            setAssistantForObject('project-1', 'object-1', 'assistants', 'project-assistant', false)
        ).resolves.toBe(false)

        expect(setTaskAssistant).not.toHaveBeenCalled()
        expect(updateChatAssistant).not.toHaveBeenCalled()
    })
})
