import { scopeAnnaThreads } from './annaThreadScope'

// AT-3036: the chat shows the threads of the project it continues in; other projects are jumps.
const conversation = { projectId: 'steercom', id: 'AnnaChat20261113u1' }
const thread = (projectId, chatId, created) => ({ projectId, chatId, created })
const keys = threads => threads.map(item => `${item.projectId}/${item.chatId || item.id}`)

it('keeps only the current project and puts the composer’s thread last', () => {
    const { threads, otherProjectIds } = scopeAnnaThreads({
        conversation,
        threads: [
            thread('steercom', 'AnnaChat20261113u1', 5),
            thread('home', 'AnnaChat20261113u1', 1),
            thread('steercom', 'AnnaChat20261112u1', 9),
        ],
    })
    expect(keys(threads)).toEqual(['steercom/AnnaChat20261112u1', 'steercom/AnnaChat20261113u1'])
    expect(otherProjectIds).toEqual([])
})

it('lists other projects once each, the most recently active first, and only openable ones', () => {
    const { otherProjectIds } = scopeAnnaThreads({
        conversation,
        threads: [thread('steercom', 'AnnaChat20261113u1', 5)],
        otherThreads: [
            thread('home', 'AnnaChat20261112u1', 1),
            thread('product', 'AnnaChat20261113u1', 4),
            thread('home', 'AnnaChat20261113u1', 7),
            thread('archived', 'AnnaChat20261113u1', 9),
        ],
        canOpen: id => id !== 'archived',
    })
    expect(otherProjectIds).toEqual(['home', 'product'])
})

it('shows a pending send of this project, and lists one of another project as a jump', () => {
    const { threads, otherProjectIds } = scopeAnnaThreads({
        conversation,
        threads: [thread('steercom', 'AnnaChat20261113u1', 5)],
        localThreads: [
            { projectId: 'steercom', id: 'AnnaChat20261112u1' },
            { projectId: 'home', id: 'AnnaChat20261113u1' },
            null,
        ],
    })
    expect(keys(threads)).toEqual(['steercom/AnnaChat20261112u1', 'steercom/AnnaChat20261113u1'])
    expect(otherProjectIds).toEqual(['home'])
})

it('falls back to the conversation itself when no thread list is known yet', () => {
    expect(keys(scopeAnnaThreads({ conversation }).threads)).toEqual(['steercom/AnnaChat20261113u1'])
})
