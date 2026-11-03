/**
 * @jest-environment jsdom
 *
 * AT-2950 - a note mentioned in a note must show the note's title, never the bare link.
 *
 * Two independent reasons made the chip fall back to the link text, and both live here:
 *
 *  1. Links stored by the iOS app. The Capacitor shell serves the bundle from
 *     `capacitor://localhost`, so every mention written there was stored as
 *     `capacitor://localhost/projects/<p>/notes/<n>/editor`. `getPathname` prefixed `http://`
 *     (`http://capacitor://localhost/...`), the URL parser read the host as `capacitor`, the
 *     link looked external, and the chip showed a link icon plus the path. On the web AND in the
 *     app itself.
 *  2. A listener that fails. A rules-evaluation ERROR reaches the client as `permission-denied`
 *     (AT-2484) and the SDK ends the listener for good, so one transient burst left the chip on
 *     its fallback text until the note was reopened.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'

jest.mock('../../i18n/TranslationService', () => ({
    ...jest.requireActual('../../i18n/TranslationService'),
    translate: text => text,
}))

import { nodeMockOptions } from '../../testUtils/domNodeStub'
import LinkTag, { getPathname } from './LinkTag'
import { seedLoggedUser, seedProjects } from '../../testUtils/seedStore'
import store from '../../redux/store'
import { storeCurrentUser } from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import { OBJECT_LINK_RETRY_DELAYS_MS } from '../../utils/backends/objectLinkSnapshot'

const PROJECT_ID = 'seeded-project-0'
const NOTE_ID = 'soRpZQOp7LmPqWHFOdcW'
const LOGGED_USER_ID = 'lejVqrT6FBcMRRCxnBbBhQwPgSg1'
const NOTE_PATHNAME = `/projects/${PROJECT_ID}/notes/${NOTE_ID}/editor`
const IOS_SHELL_LINK = `capacitor://localhost${NOTE_PATHNAME}`
const NOTE = { id: NOTE_ID, title: 'Q4 Roadmap', isPublicFor: [0], userId: LOGGED_USER_ID }

const visibleText = tree =>
    tree.root
        .findAll(node => typeof node.type === 'string' && node.props.children != null)
        .map(node => node.props.children)
        .filter(child => typeof child === 'string')
        .join(' ')

const mountedTrees = []

const renderTag = async link => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <Provider store={store}>
                <LinkTag link={link} projectId={PROJECT_ID} />
            </Provider>,
            nodeMockOptions
        )
    })
    mountedTrees.push(tree)
    return tree
}

afterEach(async () => {
    // A tree left mounted keeps its redux subscription and reacts to the next test's seeding.
    while (mountedTrees.length > 0) {
        const tree = mountedTrees.pop()
        await act(async () => {
            try {
                tree.unmount()
            } catch (error) {
                // Already unmounted by the test itself.
            }
        })
    }
})

describe('AT-2950 - note mention chips resolve to the note title', () => {
    let watchSpy
    let unwatchSpy

    beforeEach(() => {
        jest.restoreAllMocks()
        jest.useRealTimers()
        store.dispatch([
            ...seedProjects([{ id: PROJECT_ID }]),
            seedLoggedUser({ uid: LOGGED_USER_ID, projectIds: [PROJECT_ID] }),
            storeCurrentUser({ uid: LOGGED_USER_ID }),
        ])
        jest.spyOn(Backend, 'getId').mockReturnValue('watch-id')
        unwatchSpy = jest.spyOn(Backend, 'unwatchObjectLTag').mockImplementation(() => {})
    })

    describe('a link stored by the iOS app (capacitor://localhost)', () => {
        it('is read as an app route, not as an external host called "capacitor"', () => {
            expect(getPathname(IOS_SHELL_LINK)).toBe(NOTE_PATHNAME)
        })

        it('watches the note and shows its title', async () => {
            watchSpy = jest
                .spyOn(Backend, 'watchObjectLTag')
                .mockImplementation((objectType, path, watchId, callback) => callback(NOTE))

            const tree = await renderTag(IOS_SHELL_LINK)

            expect(watchSpy).toHaveBeenCalledWith(
                'note',
                `noteItems/${PROJECT_ID}/notes/${NOTE_ID}`,
                'watch-id',
                expect.any(Function)
            )
            expect(visibleText(tree)).toContain('Q4 Roadmap')
            expect(visibleText(tree)).not.toContain('capacitor')
            expect(visibleText(tree)).not.toContain('localhost')
        })

        it('opens the note inside the app', async () => {
            jest.spyOn(Backend, 'watchObjectLTag').mockImplementation((objectType, path, watchId, callback) =>
                callback(NOTE)
            )
            const processUrlSpy = jest.spyOn(URLTrigger, 'processUrl').mockResolvedValue(undefined)

            const tree = await renderTag(IOS_SHELL_LINK)
            const anchor = tree.root.findAll(node => node.type === 'a', { deep: false })[0]
            expect(anchor.props.href).toBe(NOTE_PATHNAME)
            await act(async () => {
                await anchor.props.onClick({ stopPropagation: () => {}, preventDefault: () => {} })
            })

            expect(processUrlSpy).toHaveBeenCalledWith(NavigationService, NOTE_PATHNAME)
        })
    })

    describe('a listener that fails', () => {
        afterEach(() => {
            jest.useRealTimers()
        })

        it('is opened again and still shows the title once the read succeeds', async () => {
            jest.useFakeTimers()
            const permissionDenied = Object.assign(new Error('Missing or insufficient permissions.'), {
                code: 'permission-denied',
            })
            let attempt = 0
            watchSpy = jest
                .spyOn(Backend, 'watchObjectLTag')
                .mockImplementation((objectType, path, watchId, callback) => {
                    attempt++
                    if (attempt === 1) callback(null, path, watchId, permissionDenied)
                    else callback(NOTE)
                })

            const tree = await renderTag(`${window.location.origin}${NOTE_PATHNAME}`)

            expect(watchSpy).toHaveBeenCalledTimes(1)
            expect(unwatchSpy).toHaveBeenCalledTimes(1)
            expect(visibleText(tree)).not.toContain('Q4 Roadmap')

            await act(async () => {
                jest.advanceTimersByTime(OBJECT_LINK_RETRY_DELAYS_MS[0])
            })

            expect(watchSpy).toHaveBeenCalledTimes(2)
            expect(visibleText(tree)).toContain('Q4 Roadmap')
        })

        it('gives up after the bounded retries, so a real denial costs a fixed number of reads', async () => {
            jest.useFakeTimers()
            const denied = Object.assign(new Error('denied'), { code: 'permission-denied' })
            watchSpy = jest
                .spyOn(Backend, 'watchObjectLTag')
                .mockImplementation((objectType, path, watchId, callback) => callback(null, path, watchId, denied))

            await renderTag(`${window.location.origin}${NOTE_PATHNAME}`)
            for (const delay of OBJECT_LINK_RETRY_DELAYS_MS) {
                await act(async () => {
                    jest.advanceTimersByTime(delay)
                })
            }
            await act(async () => {
                jest.advanceTimersByTime(60 * 60 * 1000)
            })

            expect(watchSpy).toHaveBeenCalledTimes(1 + OBJECT_LINK_RETRY_DELAYS_MS.length)
        })

        it('does not reopen a listener for a chip that has been unmounted', async () => {
            jest.useFakeTimers()
            const denied = Object.assign(new Error('denied'), { code: 'permission-denied' })
            watchSpy = jest
                .spyOn(Backend, 'watchObjectLTag')
                .mockImplementation((objectType, path, watchId, callback) => callback(null, path, watchId, denied))

            const tree = await renderTag(`${window.location.origin}${NOTE_PATHNAME}`)
            await act(async () => {
                tree.unmount()
            })
            await act(async () => {
                jest.advanceTimersByTime(60 * 60 * 1000)
            })

            expect(watchSpy).toHaveBeenCalledTimes(1)
        })

        it('still settles on the link for an object that does not exist, without retrying', async () => {
            jest.useFakeTimers()
            watchSpy = jest
                .spyOn(Backend, 'watchObjectLTag')
                .mockImplementation((objectType, path, watchId, callback) => callback(null, path, watchId))

            await renderTag(`${window.location.origin}${NOTE_PATHNAME}`)
            await act(async () => {
                jest.advanceTimersByTime(60 * 60 * 1000)
            })

            expect(watchSpy).toHaveBeenCalledTimes(1)
        })
    })
})
