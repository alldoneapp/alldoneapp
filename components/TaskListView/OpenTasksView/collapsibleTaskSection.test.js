import {
    COLLAPSED_SECTION_TASK_LIMIT,
    allocateSectionTaskBudget,
    clearSectionExpansionRequestsForTests,
    consumeSectionExpansionRequest,
    countSectionTasks,
    getSectionExpansionKey,
    requestSectionExpansion,
    shouldOfferSectionToggle,
} from './collapsibleTaskSection'

const tasks = amount => Array.from({ length: amount }, (_, index) => ({ id: `t${index}` }))

// AT-3027 - Messages and Calendar are collapsed to their first three tasks.
describe('collapsibleTaskSection', () => {
    afterEach(() => clearSectionExpansionRequestsForTests())

    it('collapses to three tasks', () => {
        expect(COLLAPSED_SECTION_TASK_LIMIT).toBe(3)
    })

    it('counts tasks across groups, not groups', () => {
        expect(countSectionTasks([tasks(2), tasks(0), tasks(3)])).toBe(5)
        expect(countSectionTasks([])).toBe(0)
        expect(countSectionTasks([undefined])).toBe(0)
    })

    it.each([
        [0, false],
        [1, false],
        [3, false],
        [4, true],
        [12, true],
    ])('offers the chevron for %i tasks: %s', (total, offered) => {
        expect(shouldOfferSectionToggle(total, false)).toBe(offered)
    })

    it('never offers the chevron in organize mode', () => {
        expect(shouldOfferSectionToggle(10, true)).toBe(false)
    })

    it('shares the first three tasks out front to back while collapsed', () => {
        expect(allocateSectionTaskBudget([tasks(1), tasks(1), tasks(2), tasks(4)], true)).toEqual([1, 1, 1, 0])
        expect(allocateSectionTaskBudget([tasks(5), tasks(1)], true)).toEqual([3, 0])
        expect(allocateSectionTaskBudget([tasks(2)], true)).toEqual([2])
    })

    it('leaves every group uncut while expanded', () => {
        expect(allocateSectionTaskBudget([tasks(5), tasks(1)], false)).toEqual([null, null])
    })

    describe('All projects -> project hand-off', () => {
        const key = getSectionExpansionKey('project-1', 'TODAY', 'messages')

        it('is consumed exactly once', () => {
            requestSectionExpansion(key, 1000)

            expect(consumeSectionExpansionRequest(key, 2000)).toBe(true)
            expect(consumeSectionExpansionRequest(key, 2000)).toBe(false)
        })

        it('only expands the section, day and project that was pressed', () => {
            requestSectionExpansion(key, 1000)

            expect(consumeSectionExpansionRequest(getSectionExpansionKey('project-1', 'TODAY', 'calendar'), 1000)).toBe(
                false
            )
            expect(consumeSectionExpansionRequest(getSectionExpansionKey('project-2', 'TODAY', 'messages'), 1000)).toBe(
                false
            )
            expect(consumeSectionExpansionRequest(key, 1000)).toBe(true)
        })

        it('expires a request nobody picked up', () => {
            requestSectionExpansion(key, 1000)

            expect(consumeSectionExpansionRequest(key, 1000 + 60000)).toBe(false)
        })
    })
})
