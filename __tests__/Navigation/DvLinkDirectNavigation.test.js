/**
 * @jest-environment jsdom
 */

// AT-2417: clicking a link to a detailed view must navigate STRAIGHT to that view.
//
// It used to bounce through the matching root LIST first: `checkDVLink` (utils/LinkingHelper.js)
// dispatched `setSelectedSidebarTab(<root tab>)` and `NavigationService.navigate('Root')` right
// before the URL system navigated to the target, so opening a note rendered the notes list and
// only then the note. That was a June-2021 workaround for react-navigation, whose `navigate` did
// not remount a route you were already on; #7524 (June 2022) turned `navigate` into a
// `StackActions.reset` with a changing key, and NavigationService keeps that contract today
// (`id` increments on every navigate, AppNavigator renders under `key={id}`), so the bounce has
// been redundant for years.
//
// Two things made it visible from a TASK, which is how it was reported. `selectedNavItem` is
// never reset to a `ROOT_*` value when you leave a detailed view for a root list, so after
// opening any note once it stays `NOTE_EDITOR` for the rest of the session — and the notes list
// pushes its own URL on mount (`URLsNotes.push` in NotesView), so the detour also left a junk
// browser-history entry and moved the sidebar tab, i.e. closing the note dropped you on the
// notes list instead of back on your tasks.

import fs from 'fs'
import path from 'path'
import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('../../i18n/TranslationService', () => ({
    ...jest.requireActual('../../i18n/TranslationService'),
    translate: text => text,
}))

import { Provider } from 'react-redux'
import { nodeMockOptions } from '../../testUtils/domNodeStub'
import LinkTag from '../../components/Tags/LinkTag'
import { seedLoggedUser, seedProjects } from '../../testUtils/seedStore'
import store from '../../redux/store'
import { setSelectedNavItem, setSelectedSidebarTab, storeCurrentUser } from '../../redux/actions'
import Backend from '../../utils/BackendBridge'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import * as LinkingHelper from '../../utils/LinkingHelper'
import URLsNotes from '../../URLSystem/Notes/URLsNotes'
import URLsTasks from '../../URLSystem/Tasks/URLsTasks'
import {
    DV_TAB_NOTE_EDITOR,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_TASK_PROPERTIES,
} from '../../utils/TabNavigationConstants'

const PROJECT_ID = 'seeded-project-0'
const NOTE_ID = 'soRpZQOp7LmPqWHFOdcW'
const TASK_ID = '-Oy32IXsBqnUTWUGv3jd'
const LOGGED_USER_ID = 'lejVqrT6FBcMRRCxnBbBhQwPgSg1'

describe('AT-2417 - a detailed-view link never routes through the root list', () => {
    let navigateSpy

    beforeEach(() => {
        jest.restoreAllMocks()
        navigateSpy = jest.spyOn(NavigationService, 'navigate').mockImplementation(() => {})
        jest.spyOn(URLsNotes, 'replace').mockImplementation(() => {})
        jest.spyOn(URLsNotes, 'push').mockImplementation(() => {})
        jest.spyOn(URLsTasks, 'replace').mockImplementation(() => {})
        jest.spyOn(URLsTasks, 'push').mockImplementation(() => {})
        store.dispatch([
            ...seedProjects([{ id: PROJECT_ID }]),
            seedLoggedUser({ uid: LOGGED_USER_ID, projectIds: [PROJECT_ID] }),
            storeCurrentUser({ uid: LOGGED_USER_ID }),
        ])
    })

    const routesNavigatedTo = () => navigateSpy.mock.calls.map(call => call[0])

    describe('note links', () => {
        beforeEach(() => {
            jest.spyOn(Backend, 'getNoteMeta').mockResolvedValue({
                id: NOTE_ID,
                title: 'Product Launch Checklist',
                userId: LOGGED_USER_ID,
                parentObject: null,
            })
            jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue(null)
        })

        const clickNoteLink = () =>
            URLTrigger.directProcessUrl(NavigationService, `/projects/${PROJECT_ID}/notes/${NOTE_ID}/editor`)

        it('opens the note in one navigation from the task list', async () => {
            store.dispatch([setSelectedNavItem(DV_TAB_ROOT_TASKS), setSelectedSidebarTab(DV_TAB_ROOT_TASKS)])

            await clickNoteLink()

            expect(routesNavigatedTo()).toEqual(['NotesDetailedView'])
        })

        // The reported case. `selectedNavItem` is stale — the user opened a note earlier in the
        // session and is now looking at their tasks — which is exactly what used to take the
        // note-to-note branch and render the notes list on the way.
        it('opens the note in one navigation when selectedNavItem is a stale note tab', async () => {
            store.dispatch([setSelectedNavItem(DV_TAB_NOTE_EDITOR), setSelectedSidebarTab(DV_TAB_ROOT_TASKS)])

            await clickNoteLink()

            expect(routesNavigatedTo()).toEqual(['NotesDetailedView'])
            expect(navigateSpy).not.toHaveBeenCalledWith('Root')
        })

        // Closing the note has to land back on the list the user came from. The bounce forced the
        // sidebar onto Notes on its way through Root, so a note opened from a task sent you to the
        // notes list afterwards.
        it('leaves the sidebar tab of the view the user came from untouched', async () => {
            store.dispatch([setSelectedNavItem(DV_TAB_NOTE_EDITOR), setSelectedSidebarTab(DV_TAB_ROOT_TASKS)])

            await clickNoteLink()

            expect(store.getState().selectedSidebarTab).toEqual(DV_TAB_ROOT_TASKS)
        })

        // Note-to-note still has to work: NavigationService remounts on every navigate, so the
        // second note replaces the first with no help from an intermediate route.
        it('opens another note directly while a note detailed view is open', async () => {
            store.dispatch([setSelectedNavItem(DV_TAB_NOTE_EDITOR), setSelectedSidebarTab(DV_TAB_ROOT_NOTES)])

            await clickNoteLink()

            expect(routesNavigatedTo()).toEqual(['NotesDetailedView'])
            expect(store.getState().selectedNote.id).toEqual(NOTE_ID)
        })

        // The unreadable-note fallback is the one case that SHOULD land on the notes list, and it
        // is deliberately untouched.
        it('still falls back to the notes list when the note cannot be read', async () => {
            Backend.getNoteMeta.mockResolvedValue(null)
            store.dispatch(setSelectedNavItem(DV_TAB_ROOT_TASKS))

            await clickNoteLink()

            expect(routesNavigatedTo()).toEqual(['Root'])
        })
    })

    // The click handler itself. Everything above pins what the URL system does once it is
    // reached; this pins that nothing navigates BEFORE it is reached, which is where the
    // detour lived. `URLTrigger.processUrl` is stubbed so the assertion is about the handler
    // and not about the membership/auth gate behind it.
    describe('clicking a note tag rendered inside a task title', () => {
        // The app's own origin, which is what a rendered note tag carries.
        const NOTE_LINK = `${window.location.origin}/projects/${PROJECT_ID}/notes/${NOTE_ID}/editor`

        let processUrlSpy

        const clickTheTag = async () => {
            jest.spyOn(Backend, 'getId').mockReturnValue('watch-id')
            jest.spyOn(Backend, 'unwatchObjectLTag').mockImplementation(() => {})
            // Enabling the tag is what the real watcher does when the linked note exists.
            jest.spyOn(Backend, 'watchObjectLTag').mockImplementation((objectType, path, watchId, callback) => {
                callback({ id: NOTE_ID, title: 'Product Launch Checklist', isPublicFor: [0] })
            })

            let tree
            await act(async () => {
                tree = renderer.create(
                    <Provider store={store}>
                        <LinkTag link={NOTE_LINK} projectId={PROJECT_ID} />
                    </Provider>,
                    nodeMockOptions
                )
            })

            const anchor = tree.root.findAll(node => node.type === 'a', { deep: false })[0]
            await act(async () => {
                await anchor.props.onClick({ stopPropagation: () => {}, preventDefault: () => {} })
            })

            return tree
        }

        beforeEach(() => {
            processUrlSpy = jest.spyOn(URLTrigger, 'processUrl').mockResolvedValue(undefined)
        })

        it('hands the note URL straight to the URL system, navigating nowhere on the way', async () => {
            // Stale note tab, task list on screen: the reported situation.
            store.dispatch([setSelectedNavItem(DV_TAB_NOTE_EDITOR), setSelectedSidebarTab(DV_TAB_ROOT_TASKS)])

            await clickTheTag()

            expect(processUrlSpy).toHaveBeenCalledWith(
                NavigationService,
                `/projects/${PROJECT_ID}/notes/${NOTE_ID}/editor`
            )
            expect(navigateSpy).not.toHaveBeenCalled()
            expect(store.getState().selectedSidebarTab).toEqual(DV_TAB_ROOT_TASKS)
        })

        it('does not detour while a note detailed view is already open either', async () => {
            store.dispatch([setSelectedNavItem(DV_TAB_NOTE_EDITOR), setSelectedSidebarTab(DV_TAB_ROOT_NOTES)])

            await clickTheTag()

            expect(processUrlSpy).toHaveBeenCalled()
            expect(navigateSpy).not.toHaveBeenCalled()
        })
    })

    describe('links to other detailed views', () => {
        it('opens a task directly while a task detailed view is open', async () => {
            const task = { id: TASK_ID, name: 'Ship the release', userId: LOGGED_USER_ID }
            jest.spyOn(Backend, 'getTaskData').mockResolvedValue(task)
            jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue({ uid: LOGGED_USER_ID })
            store.dispatch([setSelectedNavItem(DV_TAB_TASK_PROPERTIES), setSelectedSidebarTab(DV_TAB_ROOT_TASKS)])

            await URLTrigger.directProcessUrl(NavigationService, `/projects/${PROJECT_ID}/tasks/${TASK_ID}/properties`)

            expect(routesNavigatedTo()).toEqual(['TaskDetailedView'])
            expect(navigateSpy).not.toHaveBeenCalledWith('Root')
        })
    })

    // The bounce had ELEVEN call sites (every LinkTag, the tag-edit popups for chats, contacts,
    // users, goals, projects, skills and assistants, the quill url tag, and both global-search
    // openers). Driving each of those object types end to end would need a backend double per
    // type; a source ratchet is what actually keeps the helper from coming back on any of them.
    describe('no detailed-view opener bounces through a root list again', () => {
        const ROOTS = ['components', 'utils', 'URLSystem', 'hooks', 'redux']

        const sourceFiles = dir => {
            const entries = fs.readdirSync(dir, { withFileTypes: true })
            return entries.flatMap(entry => {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) return sourceFiles(full)
                return entry.isFile() && full.endsWith('.js') && !full.endsWith('.test.js') ? [full] : []
            })
        }

        it('has no checkDVLink call left anywhere in the app source', () => {
            const repoRoot = path.join(__dirname, '..', '..')
            const offenders = ROOTS.flatMap(root => sourceFiles(path.join(repoRoot, root)))
                .filter(file => /checkDVLink\s*\(/.test(fs.readFileSync(file, 'utf8')))
                .map(file => path.relative(repoRoot, file))

            expect(offenders).toEqual([])
        })

        it('does not export checkDVLink from LinkingHelper', () => {
            expect(Object.keys(LinkingHelper)).not.toContain('checkDVLink')
        })
    })
})
