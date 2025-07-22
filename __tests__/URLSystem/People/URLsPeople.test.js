/**
 * @jest-environment jsdom
 */

import URLsPeople, {
    URL_ALL_PROJECTS_PEOPLE,
    URL_PEOPLE_DETAILS,
    URL_PEOPLE_DETAILS_FEED,
    URL_PEOPLE_DETAILS_PROPERTIES,
    URL_PEOPLE_DETAILS_STATISTICS,
    URL_PEOPLE_DETAILS_WORKFLOW,
    URL_PROJECT_PEOPLE,
    URL_PROJECT_PEOPLE_ADD,
} from '../../../URLSystem/People/URLsPeople'

jest.mock('../../../components/MyPlatform', () => {
    return { isMobile: false }
})

describe('The replace function', () => {
    it('should change the data', () => {
        history.pushState('Initial data', 'Initial title')
        URLsPeople.replace(URL_ALL_PROJECTS_PEOPLE, 'New data')
        expect(history.state).toEqual('New data')
    })
})

describe('The getPath function', () => {
    it('should return the correct values', () => {
        const pairs = [
            [URL_ALL_PROJECTS_PEOPLE, 'projects/contacts'],
            [URL_PROJECT_PEOPLE, 'projects/{0}/contacts'],
            [URL_PEOPLE_DETAILS, 'projects/{0}/contacts/{1}'],
            [URL_PEOPLE_DETAILS_FEED, 'projects/{0}/contacts/{1}/updates'],
            [URL_PEOPLE_DETAILS_WORKFLOW, 'projects/{0}/contacts/{1}/workflow'],
            [URL_PEOPLE_DETAILS_PROPERTIES, 'projects/{0}/contacts/{1}/properties'],
            [URL_PEOPLE_DETAILS_STATISTICS, 'projects/{0}/contacts/{1}/statistics'],
            [URL_PROJECT_PEOPLE_ADD, 'projects/{0}/contacts/{1}/add'],
        ]
        const projectId = 'qwerty'
        const personId = 'asdfg'
        const keyIdx = 0
        const valueIdx = 1

        for (const pair of pairs) {
            const params = []
            const value = pair[valueIdx]

            if (value.indexOf('{0}') >= 0) params.push(projectId)
            if (value.indexOf('{1}') >= 0) params.push(personId)

            const res = URLsPeople.getPath(pair[keyIdx], ...params)
            let expected = value.replace('{0}', projectId).replace('{1}', personId)
            expect(res).toEqual(expected)
        }
    })
})

describe('The setTitle function', () => {
    it('should return the correct values', () => {
        const pairs = [
            [URL_ALL_PROJECTS_PEOPLE, 'Alldone.app - All projects - Contacts'],
            [URL_PROJECT_PEOPLE, 'Alldone.app - {0} - Contacts'],
            [URL_PEOPLE_DETAILS, 'Alldone.app - {0} - {1} - Contact details'],
            [URL_PEOPLE_DETAILS_FEED, 'Alldone.app - {0} - {1} - Contact details - Updates'],
            [URL_PEOPLE_DETAILS_WORKFLOW, 'Alldone.app - {0} - {1} - Contact details - Workflow'],
            [URL_PEOPLE_DETAILS_PROPERTIES, 'Alldone.app - {0} - {1} - Contact details - Properties'],
            [URL_PEOPLE_DETAILS_STATISTICS, 'Alldone.app - {0} - {1} - Contact details - Statistics'],
            [URL_PROJECT_PEOPLE_ADD, 'Alldone.app - {0} - {1} - Add contact'],
        ]
        const projectName = 'Project'
        const personName = 'User'
        const keyIdx = 0
        const valueIdx = 1

        for (const pair of pairs) {
            const params = []
            const value = pair[valueIdx]

            if (value.indexOf('{0}') >= 0) params.push(projectName)
            if (value.indexOf('{1}') >= 0) params.push(personName)

            URLsPeople.setTitle(pair[keyIdx], ...params)
            let expected = value.replace('{0}', projectName).replace('{1}', personName)
            expect(document.title).toEqual(expected)
        }
    })
})
