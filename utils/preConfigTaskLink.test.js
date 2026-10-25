import { resolvePreConfigTaskLink } from './preConfigTaskLink'
import { getPreConfigTask, getPreConfigTasksForProject } from './backends/Assistants/assistantsFirestore'
import { isGlobalAssistant } from '../components/AdminPanel/Assistants/assistantsHelper'

jest.mock('./LinkingHelper', () => ({ addProtocol: url => url }))
jest.mock('./backends/Assistants/assistantsFirestore', () => ({
    getPreConfigTask: jest.fn(),
    getPreConfigTasksForProject: jest.fn(),
}))
jest.mock('../components/AdminPanel/Assistants/assistantsHelper', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    isGlobalAssistant: jest.fn(),
}))

const link =
    'https://my.alldone.app/projects/-Ona1ph4uu0mdSl9zizI/preConfigTasks/-Oq7EYyF6kdWstuBB9IL/run?assistantId=-Oq7EO-vvIZsv8RHM2fJ&assistantProjectId=-Ona1ph4uu0mdSl9zizI&name=High%20Level%20Roadmap'

describe('embedded pre-configured task links', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        isGlobalAssistant.mockReturnValue(false)
    })

    it('uses the exact IDs in a link while the original task exists', async () => {
        const task = { id: '-Oq7EYyF6kdWstuBB9IL', name: 'High Level Roadmap', type: 'iframe' }
        getPreConfigTask.mockResolvedValue(task)

        await expect(resolvePreConfigTaskLink(link, 'note-project')).resolves.toEqual({
            task,
            assistantId: '-Oq7EO-vvIZsv8RHM2fJ',
            assistantProjectId: '-Ona1ph4uu0mdSl9zizI',
            targetProjectId: 'note-project',
        })
        expect(getPreConfigTask).toHaveBeenCalledWith(
            '-Ona1ph4uu0mdSl9zizI',
            '-Oq7EO-vvIZsv8RHM2fJ',
            '-Oq7EYyF6kdWstuBB9IL'
        )
        expect(getPreConfigTasksForProject).not.toHaveBeenCalled()
    })

    it('resolves the reported stale link to its unique replacement in the linked project', async () => {
        const replacement = {
            id: '-P26nuSFvzECbV23JvbR',
            assistantId: '-Opl-0IPPlv26577k_M2',
            name: 'High Level Roadmap',
            type: 'iframe',
        }
        getPreConfigTask.mockResolvedValueOnce(null).mockResolvedValueOnce(replacement)
        getPreConfigTasksForProject.mockResolvedValue([replacement])

        await expect(resolvePreConfigTaskLink(link)).resolves.toEqual({
            task: replacement,
            assistantId: replacement.assistantId,
            assistantProjectId: '-Ona1ph4uu0mdSl9zizI',
            targetProjectId: '-Ona1ph4uu0mdSl9zizI',
        })
        expect(getPreConfigTasksForProject).toHaveBeenCalledWith('-Ona1ph4uu0mdSl9zizI')
        expect(getPreConfigTask).toHaveBeenLastCalledWith(
            '-Ona1ph4uu0mdSl9zizI',
            replacement.assistantId,
            replacement.id
        )
    })

    it('does not guess when the name is absent or ambiguous', async () => {
        getPreConfigTask.mockResolvedValue(null)
        await expect(resolvePreConfigTaskLink(link.replace(/&name=.*/, ''))).resolves.toBeNull()
        expect(getPreConfigTasksForProject).not.toHaveBeenCalled()

        getPreConfigTasksForProject.mockResolvedValue([
            { id: 'one', name: 'High Level Roadmap' },
            { id: 'two', name: 'High Level Roadmap' },
        ])
        await expect(resolvePreConfigTaskLink(link)).resolves.toBeNull()
        expect(getPreConfigTask).toHaveBeenCalledTimes(2)
    })

    it('rechecks a cached replacement before opening it', async () => {
        getPreConfigTask.mockResolvedValue(null)
        getPreConfigTasksForProject.mockResolvedValue([
            { id: 'deleted', assistantId: 'replacement-assistant', name: 'High Level Roadmap' },
        ])

        await expect(resolvePreConfigTaskLink(link)).resolves.toBeNull()
        expect(getPreConfigTask).toHaveBeenCalledTimes(2)
    })

    it('uses the global assistant collection for a global replacement', async () => {
        const replacement = { id: 'global-task', assistantId: 'global-assistant', name: 'High Level Roadmap' }
        isGlobalAssistant.mockReturnValue(true)
        getPreConfigTask.mockResolvedValueOnce(null).mockResolvedValueOnce(replacement)
        getPreConfigTasksForProject.mockResolvedValue([replacement])

        await expect(resolvePreConfigTaskLink(link)).resolves.toMatchObject({
            assistantId: 'global-assistant',
            assistantProjectId: 'globalProject',
        })
        expect(getPreConfigTask).toHaveBeenLastCalledWith('globalProject', 'global-assistant', 'global-task')
    })
})
