import { isAlldoneTeamSpecialist, splitGlobalTemplates } from './specialistTemplates'
import { getNewDefaultAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import { TOOL_OPTIONS } from '../../../AssistantDetailedView/Customizations/ToolsAccess/toolOptions'
import {
    SPECIALIST_ALLOWED_TOOLS,
    buildNewSpecialistTemplate,
} from '../../../../functions/Assistants/alldoneTeamSpecialists'

jest.mock('../../../../redux/store', () => ({
    getState: jest.fn(() => ({ loggedUser: { uid: 'me' } })),
    dispatch: jest.fn(),
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({ getProjectById: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({ setSelectedNavItem: jest.fn() }))
jest.mock('../../../../utils/NavigationService', () => ({ navigate: jest.fn() }))

const specialist = (uid, extra = {}) => ({
    uid,
    displayName: uid,
    externalSource: { provider: 'alldone.team', appId: uid, available: true, ...extra },
})
const anna = { uid: 'anna', displayName: 'Anna Alldone' }
const coach = { uid: 'coach', displayName: 'Coach' }

describe('the Add assistant list', () => {
    const globalAssistants = [
        anna,
        coach,
        specialist('connor'),
        specialist('judy'),
        specialist('ricky', { available: false }),
    ]

    test('offers the alldone.team specialists in their own section, apart from the other templates', () => {
        const { specialists, templates } = splitGlobalTemplates(globalAssistants, { globalAssistantIds: [] })
        expect(specialists.map(item => item.uid)).toEqual(['connor', 'judy'])
        expect(templates.map(item => item.uid)).toEqual(['anna', 'coach'])
    })

    test('leaves out a specialist the project already has and one alldone.team no longer offers', () => {
        const { specialists } = splitGlobalTemplates(globalAssistants, { globalAssistantIds: ['anna'] }, [
            { uid: 'local-connor', copiedFromTemplateAssistantId: 'connor' },
        ])
        expect(specialists.map(item => item.uid)).toEqual(['judy'])
    })

    test('keeps hiding templates the project references directly', () => {
        expect(splitGlobalTemplates(globalAssistants, { globalAssistantIds: ['anna'] }).templates).toEqual([coach])
        expect(isAlldoneTeamSpecialist(anna)).toBe(false)
    })
})

describe('a specialist template written by the server', () => {
    const template = buildNewSpecialistTemplate(
        {
            id: 'story',
            persona: 'Connor Consultant',
            product: 'Story Builder',
            summary: 'Videos.',
            family: 'story',
            avatarUrl: null,
            pageUrl: null,
            intro: 'You are Connor.',
            guide: '',
            mcpUrl: 'https://alldone.team/mcp',
        },
        { creatorId: 'admin', now: 1 }
    )

    test('has every field a template made in the app has', () => {
        const missing = Object.keys(getNewDefaultAssistant('admin')).filter(field => !(field in template))
        expect(missing).toEqual([])
    })

    test('only enables tools the Tools Access settings know', () => {
        const known = new Set(TOOL_OPTIONS.map(option => option.key))
        expect(SPECIALIST_ALLOWED_TOOLS.filter(tool => !known.has(tool))).toEqual([])
    })
})
