import { generateInitialAssistant, getWelcomeMessage } from './newUserDefaults'
import { MODEL_GPT6_SOL } from '../../components/AdminPanel/Assistants/assistantsHelper'

describe('new account assistant defaults', () => {
    it('creates a complete, user-owned Anna without a global template', () => {
        const assistant = generateInitialAssistant(null, 'new-user', 'new-assistant')

        expect(assistant).toMatchObject({
            uid: 'new-assistant',
            displayName: 'Anna',
            creatorId: 'new-user',
            lastEditorId: 'new-user',
            isDefault: true,
            model: MODEL_GPT6_SOL,
            noteIdsByProject: {},
            lastVisitBoard: {},
        })
        expect(assistant.instructions).toContain('AI chief of staff')
        expect(assistant.allowedTools.length).toBeGreaterThan(0)
        expect(assistant.photoURL).toMatch(/\/images\/illustrations\/AnnaAlldone\.png$/)
        expect(assistant.photoURL50).toBe(assistant.photoURL)
        expect(assistant.photoURL300).toBe(assistant.photoURL)
        expect(assistant.copiedFromTemplateAssistantId).toBeUndefined()
        expect(assistant.templateSyncStatus).toBeUndefined()
    })

    it('preserves the configured template while resetting account-specific state', () => {
        const template = {
            uid: 'template',
            displayName: 'Mira',
            model: 'custom-model',
            instructions: 'Custom instructions',
            photoURL: 'https://example.com/avatar.png',
            photoURL50: 'https://example.com/small.png',
            creatorId: 'administrator',
            noteIdsByProject: { old: 'note' },
            allowedTools: [],
        }
        const assistant = generateInitialAssistant(template, 'new-user', 'new-assistant')

        expect(assistant).toMatchObject({
            uid: 'new-assistant',
            displayName: 'Mira',
            model: 'custom-model',
            instructions: 'Custom instructions',
            photoURL: template.photoURL,
            photoURL50: template.photoURL50,
            photoURL300: template.photoURL,
            creatorId: 'new-user',
            noteIdsByProject: {},
            allowedTools: [],
            copiedFromTemplateAssistantId: 'template',
            templateSyncStatus: 'synced',
        })
        expect(getWelcomeMessage(assistant)).toContain('My name is Mira.')
        expect(template.noteIdsByProject).toEqual({ old: 'note' })
    })

    it('fills missing presentation fields in an incomplete template', () => {
        const assistant = generateInitialAssistant(
            { uid: 'template', displayName: '', photoURL: '' },
            'user',
            'assistant'
        )
        expect(assistant.displayName).toBe('Anna')
        expect(assistant.photoURL50).toBeTruthy()
        expect(assistant.instructions).toBeTruthy()
        expect(assistant.copiedFromTemplateAssistantId).toBe('template')
    })
})
