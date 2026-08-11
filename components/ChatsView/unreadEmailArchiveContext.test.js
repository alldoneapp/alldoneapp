/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import {
    collectUnreadLinkedEmails,
    UnreadEmailArchiveProvider,
    useRegisterUnreadLinkedEmails,
    useUnreadLinkedEmailsScope,
} from './unreadEmailArchiveContext'
import { performEmailLineAction } from '../../utils/backends/EmailLine/emailLineBackend'

jest.mock('../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))

jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

const email = (connectionProjectId, messageId) => ({
    key: `${connectionProjectId}:${messageId}`,
    connectionProjectId,
    messageId,
})

describe('collectUnreadLinkedEmails', () => {
    const sources = {
        'project-1:chat-1': { projectId: 'project-1', linkedEmails: [email('conn-a', 'm1'), email('conn-a', 'm2')] },
        'project-1:chat-2': { projectId: 'project-1', linkedEmails: [email('conn-a', 'm2')] },
        'project-2:chat-1': { projectId: 'project-2', linkedEmails: [email('conn-b', 'm1'), email('conn-a', 'm1')] },
    }

    it('narrows to one project for a project line', () => {
        expect(collectUnreadLinkedEmails(sources, 'project-1').map(item => item.key)).toEqual([
            'conn-a:m1',
            'conn-a:m2',
        ])
    })

    it('spans every project for the All Projects line', () => {
        expect(collectUnreadLinkedEmails(sources).map(item => item.key)).toEqual([
            'conn-a:m1',
            'conn-a:m2',
            'conn-b:m1',
        ])
    })

    it('keeps one entry per email, however many previews show it', () => {
        // The same Gmail message can be linked into two topics, and in All Projects into two
        // project sections; archiving it twice is the failure this deduplication prevents.
        const keys = collectUnreadLinkedEmails(sources).map(item => item.key)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('tolerates an empty, missing or half-written registry', () => {
        expect(collectUnreadLinkedEmails(undefined, 'project-1')).toEqual([])
        expect(collectUnreadLinkedEmails({}, 'project-1')).toEqual([])
        expect(collectUnreadLinkedEmails({ a: null, b: { projectId: 'project-1' } }, 'project-1')).toEqual([])
    })

    it('ignores an entry with no key, which is what a non-Gmail message yields', () => {
        expect(collectUnreadLinkedEmails({ a: { projectId: 'p', linkedEmails: [null, {}] } })).toEqual([])
    })
})

const PreviewRegistration = ({ sourceKey, projectId, linkedEmails }) => {
    useRegisterUnreadLinkedEmails(sourceKey, projectId, linkedEmails)
    return null
}

let observedScopes = []
const ScopeProbe = ({ projectId }) => {
    observedScopes.push(useUnreadLinkedEmailsScope(projectId))
    return null
}

const lastScope = () => observedScopes[observedScopes.length - 1]

describe('UnreadEmailArchiveProvider', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        observedScopes = []
    })

    it('publishes what a preview shows and withdraws it when the preview unmounts', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <UnreadEmailArchiveProvider>
                    <PreviewRegistration
                        sourceKey="project-1:chat-1"
                        projectId="project-1"
                        linkedEmails={[email('conn-a', 'm1')]}
                    />
                    <ScopeProbe projectId="project-1" />
                </UnreadEmailArchiveProvider>
            )
        })

        expect(lastScope().linkedEmails.map(item => item.key)).toEqual(['conn-a:m1'])

        act(() => {
            tree.update(
                <UnreadEmailArchiveProvider>
                    <ScopeProbe projectId="project-1" />
                </UnreadEmailArchiveProvider>
            )
        })

        expect(lastScope().linkedEmails).toEqual([])
    })

    it('re-publishes when the previewed emails change', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <UnreadEmailArchiveProvider>
                    <PreviewRegistration
                        sourceKey="project-1:chat-1"
                        projectId="project-1"
                        linkedEmails={[email('conn-a', 'm1')]}
                    />
                    <ScopeProbe projectId="project-1" />
                </UnreadEmailArchiveProvider>
            )
        })

        act(() => {
            tree.update(
                <UnreadEmailArchiveProvider>
                    <PreviewRegistration
                        sourceKey="project-1:chat-1"
                        projectId="project-1"
                        linkedEmails={[email('conn-a', 'm1'), email('conn-a', 'm2')]}
                    />
                    <ScopeProbe projectId="project-1" />
                </UnreadEmailArchiveProvider>
            )
        })

        expect(lastScope().linkedEmails.map(item => item.key)).toEqual(['conn-a:m1', 'conn-a:m2'])
    })

    it('does not re-publish an unchanged set, so a re-rendering row cannot loop through the registry', () => {
        let tree
        const render = () => (
            <UnreadEmailArchiveProvider>
                {/* A fresh array on every render, exactly as the rows derive theirs from messages. */}
                <PreviewRegistration
                    sourceKey="project-1:chat-1"
                    projectId="project-1"
                    linkedEmails={[email('conn-a', 'm1')]}
                />
                <ScopeProbe projectId="project-1" />
            </UnreadEmailArchiveProvider>
        )
        act(() => {
            tree = renderer.create(render())
        })
        const rendersAfterMount = observedScopes.length

        act(() => {
            tree.update(render())
        })

        // One render from the parent update itself, and no extra one from a registry write.
        expect(observedScopes.length).toBe(rendersAfterMount + 1)
        expect(lastScope().linkedEmails.map(item => item.key)).toEqual(['conn-a:m1'])
    })

    it('shares one archive state, so an email archived once is never archived again', async () => {
        performEmailLineAction.mockResolvedValue(undefined)
        act(() => {
            renderer.create(
                <UnreadEmailArchiveProvider>
                    <PreviewRegistration
                        sourceKey="project-1:chat-1"
                        projectId="project-1"
                        linkedEmails={[email('conn-a', 'm1')]}
                    />
                    <ScopeProbe projectId="project-1" />
                    <ScopeProbe projectId={undefined} />
                </UnreadEmailArchiveProvider>
            )
        })

        const projectScope = observedScopes[observedScopes.length - 2]
        const allProjectsScope = observedScopes[observedScopes.length - 1]
        expect(projectScope.archive).toBe(allProjectsScope.archive)

        await act(async () => {
            await projectScope.archive.archiveLinkedEmails([email('conn-a', 'm1')])
        })

        // The All Projects line reads the very same archived keys the project line just wrote.
        await act(async () => {
            await lastScope().archive.archiveLinkedEmails([email('conn-a', 'm1')])
        })

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(lastScope().archive.isArchivedEmail('conn-a:m1')).toBe(true)
    })

    it('gives no scope at all outside the provider, which is how the buttons stay hidden', () => {
        act(() => {
            renderer.create(<ScopeProbe projectId="project-1" />)
        })

        expect(lastScope()).toBeNull()
    })
})
