import fs from 'fs'
import path from 'path'

import {
    DEFAULT_SIDEBAR_NAVIGATION_MODE,
    SIDEBAR_NAVIGATION_ADVANCED,
    SIDEBAR_NAVIGATION_SECTIONS_TOP,
    SIDEBAR_NAVIGATION_SIMPLE,
    getSidebarNavigationMode,
    isSectionsTopSidebarNavigation,
    isSimpleSidebarNavigation,
} from './SidebarNavigationModes'

const ROOT = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')

// AT-3122: "Anna on top" is the navigation of every user who never picked one, existing and new.
// A stored mode is a deliberate pick in Settings and is kept.
describe('sidebar navigation default (AT-3122)', () => {
    it('is "Anna on top"', () => {
        expect(DEFAULT_SIDEBAR_NAVIGATION_MODE).toBe(SIDEBAR_NAVIGATION_SECTIONS_TOP)
    })

    it.each([undefined, null, '', 'unknown'])('gives "Anna on top" to a user without a picked mode (%p)', mode => {
        expect(getSidebarNavigationMode(mode)).toBe(SIDEBAR_NAVIGATION_SECTIONS_TOP)
        expect(isSectionsTopSidebarNavigation(mode)).toBe(true)
        expect(isSimpleSidebarNavigation(mode)).toBe(false)
    })

    it.each([
        [SIDEBAR_NAVIGATION_SIMPLE, true, false],
        [SIDEBAR_NAVIGATION_ADVANCED, false, false],
        [SIDEBAR_NAVIGATION_SECTIONS_TOP, false, true],
    ])('keeps the picked %s mode', (mode, simple, sectionsTop) => {
        expect(getSidebarNavigationMode(mode)).toBe(mode)
        expect(isSimpleSidebarNavigation(mode)).toBe(simple)
        expect(isSectionsTopSidebarNavigation(mode)).toBe(sectionsTop)
    })
})

// The default only reaches existing users because "never picked" stays unset everywhere: in the user
// document and in the logged user built from it. These guards keep a default from being stamped in.
describe('an unpicked sidebar navigation stays unset (AT-3122)', () => {
    it('mapUserData keeps a missing mode unset instead of filling in a default', () => {
        const source = read('utils/backends/firestore.js')
        const body = source.slice(source.indexOf('export function mapUserData'))
        const line = body.split('\n').find(text => text.includes('sidebarNavigationMode:'))

        expect(line.trim()).toBe('sidebarNavigationMode: user.sidebarNavigationMode || null,')
    })

    it('a new user document is created without a mode', () => {
        const source = read('components/ContactsView/Utils/ContactsHelper.js')
        const body = source.slice(source.indexOf('export const getNewDefaultUser'))
        const end = body.indexOf('\nexport ', 1)

        expect(body.slice(0, end > 0 ? end : undefined)).not.toContain('sidebarNavigationMode')
    })

    it('only the Settings pick writes the mode to Firestore', () => {
        const writers = []
        const walk = dir => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) walk(full)
                else if (/\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) {
                    const text = fs.readFileSync(full, 'utf8')
                    if (/\.(update|set)\([^)]*sidebarNavigationMode/s.test(text)) {
                        writers.push(path.relative(ROOT, full))
                    }
                }
            }
        }
        ;['components', 'utils', 'redux', 'functions'].forEach(dir => walk(path.join(ROOT, dir)))

        expect(writers).toEqual(['utils/backends/Users/usersFirestore.js'])
    })

    it('anonymous viewers of shared links keep the simple sidebar (decided 2026-11-23)', () => {
        const source = read('utils/SharedHelper.js')
        const body = source.slice(source.indexOf('export const ANONYMOUS_USER_DATA'))

        expect(body).toContain('sidebarNavigationMode: SIDEBAR_NAVIGATION_SIMPLE,')
    })
})
