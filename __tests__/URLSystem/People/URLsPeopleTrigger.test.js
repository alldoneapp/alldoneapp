import URLsPeopleTrigger from '../../../URLSystem/People/URLsPeopleTrigger'
import ContactsHelper from '../../../components/ContactsView/Utils/ContactsHelper'
import { ALL_TAB, FOLLOWED_TAB } from '../../../components/Feeds/Utils/FeedsConstants'
import { URL_PROJECT_PEOPLE_ALL, URL_PROJECT_PEOPLE_FOLLOWED } from '../../../URLSystem/People/URLsPeople'

jest.mock('../../../URLSystem/URLSystemTrigger', () => ({ URL_NOT_MATCH: 'not-match' }))
jest.mock('../../../URLSystem/URLSystem', () => ({}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({}))
jest.mock('../../../utils/HelperFunctions', () => ({}))
jest.mock('../../../redux/store', () => ({}))
jest.mock('../../../utils/SharedHelper', () => ({}))
jest.mock('../../../components/ContactsView/Utils/ContactsHelper', () => ({ processURLProjectPeople: jest.fn() }))

describe('Contact status route restoration', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        history.replaceState(null, '', '/projects/project-1/user/user-1/contacts/all?contactStatus=old-status')
    })

    it.each([
        ['all', URL_PROJECT_PEOPLE_ALL, ALL_TAB],
        ['followed', URL_PROJECT_PEOPLE_FOLLOWED, FOLLOWED_TAB],
    ])('matches and restores an explicit %s link including its query', (tab, constant, activeTab) => {
        const path = `/projects/project-2/user/user-1/contacts/${tab}?contactStatus=status-2`
        expect(URLsPeopleTrigger.match(path).key).toBe(constant)
        const navigation = {}
        URLsPeopleTrigger.trigger(navigation, path)
        expect(ContactsHelper.processURLProjectPeople).toHaveBeenCalledWith(
            navigation,
            'project-2',
            'user-1',
            activeTab,
            'status-2'
        )
    })

    it('reads the current query when startup or browser back passes only the current pathname', () => {
        URLsPeopleTrigger.trigger({}, window.location.pathname)
        expect(ContactsHelper.processURLProjectPeople).toHaveBeenCalledWith(
            {},
            'project-1',
            'user-1',
            ALL_TAB,
            'old-status'
        )
    })

    it('does not copy the current filter into a link for another project', () => {
        URLsPeopleTrigger.trigger({}, '/projects/project-2/user/user-1/contacts/all')
        expect(ContactsHelper.processURLProjectPeople).toHaveBeenCalledWith({}, 'project-2', 'user-1', ALL_TAB, null)
    })
})
