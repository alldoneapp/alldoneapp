import {
    decodeFirstBoardMilestone,
    encodeFirstBoardMilestone,
    isSameBoardResult,
    selectFirstBoardMilestoneByProject,
} from './goalsBoardSelectors'

describe('goalsBoardSelectors', () => {
    describe('encode/decode first board milestone', () => {
        it('round-trips id and date', () => {
            const encoded = encodeFirstBoardMilestone({ id: '-Mabc123', date: 1786981817765 })
            expect(typeof encoded).toBe('string')
            expect(decodeFirstBoardMilestone(encoded)).toEqual({ id: '-Mabc123', date: 1786981817765 })
        })

        it('round-trips backlog-like ids that contain the project id', () => {
            const encoded = encodeFirstBoardMilestone({
                id: 'backlogMilestone-M6X9vdIokG7HAammHGg',
                date: Number.MAX_SAFE_INTEGER,
            })
            expect(decodeFirstBoardMilestone(encoded)).toEqual({
                id: 'backlogMilestone-M6X9vdIokG7HAammHGg',
                date: Number.MAX_SAFE_INTEGER,
            })
        })

        it('encodes to a primitive so shallowEqual can compare it across selector runs', () => {
            const milestone = { id: 'm1', date: 10 }
            // A fresh but equivalent milestone object must still produce an identical primitive,
            // otherwise the parent board re-renders on every unrelated store write.
            expect(encodeFirstBoardMilestone(milestone)).toBe(encodeFirstBoardMilestone({ id: 'm1', date: 10 }))
        })

        it('returns null for missing values', () => {
            expect(encodeFirstBoardMilestone(null)).toBe('')
            expect(decodeFirstBoardMilestone('')).toBeNull()
            expect(decodeFirstBoardMilestone(undefined)).toBeNull()
        })
    })

    describe('selectFirstBoardMilestoneByProject', () => {
        it('keeps only projects that currently render a row', () => {
            const state = {
                boardMilestonesByProject: {
                    withMilestones: [
                        { id: 'm1', date: 5 },
                        { id: 'm2', date: 9 },
                    ],
                    empty: [],
                    nulled: null,
                },
            }
            const result = selectFirstBoardMilestoneByProject(state)
            expect(Object.keys(result)).toEqual(['withMilestones'])
            expect(decodeFirstBoardMilestone(result.withMilestones)).toEqual({ id: 'm1', date: 5 })
        })

        it('produces a shallow-equal result when an unrelated project slice is replaced', () => {
            const first = [{ id: 'm1', date: 5 }]
            const before = selectFirstBoardMilestoneByProject({
                boardMilestonesByProject: { a: first, b: [{ id: 'm2', date: 7 }] },
            })
            // Project b's watcher fires again with equivalent data -> brand new objects.
            const after = selectFirstBoardMilestoneByProject({
                boardMilestonesByProject: { a: first, b: [{ id: 'm2', date: 7 }] },
            })
            expect(after).toEqual(before)
            expect(after.a).toBe(before.a)
            expect(after.b).toBe(before.b)
        })

        it('tolerates a missing map', () => {
            expect(selectFirstBoardMilestoneByProject({})).toEqual({})
        })
    })

    describe('isSameBoardResult', () => {
        const milestone = { id: 'm1', date: 5 }
        const goal = { id: 'g1' }
        const base = {
            boardMilestones: [milestone],
            boardGoalsByMilestones: { m1: [goal] },
            boardNeedShowMore: false,
            openGoalsAmount: 1,
            doneGoalsAmount: 0,
        }

        it('treats a recomputation over the same objects as unchanged', () => {
            expect(
                isSameBoardResult(base, {
                    boardMilestones: [milestone],
                    boardGoalsByMilestones: { m1: [goal] },
                    boardNeedShowMore: false,
                    openGoalsAmount: 1,
                    doneGoalsAmount: 0,
                })
            ).toBe(true)
        })

        it('never swallows a real snapshot, which rebuilds every goal object', () => {
            // mapGoalData/mapMilestoneData allocate new objects per snapshot, so identical-looking
            // data from Firestore must still compare unequal and be written to redux.
            expect(
                isSameBoardResult(base, {
                    ...base,
                    boardGoalsByMilestones: { m1: [{ id: 'g1' }] },
                })
            ).toBe(false)
        })

        it('detects changed amounts, show-more flag, milestone list and milestone keys', () => {
            expect(isSameBoardResult(base, { ...base, openGoalsAmount: 2 })).toBe(false)
            expect(isSameBoardResult(base, { ...base, doneGoalsAmount: 3 })).toBe(false)
            expect(isSameBoardResult(base, { ...base, boardNeedShowMore: true })).toBe(false)
            expect(isSameBoardResult(base, { ...base, boardMilestones: [] })).toBe(false)
            expect(isSameBoardResult(base, { ...base, boardGoalsByMilestones: { m2: [goal] } })).toBe(false)
            expect(isSameBoardResult(base, { ...base, boardGoalsByMilestones: { m1: [goal], m2: [] } })).toBe(false)
        })

        it('is false when there is no previous board', () => {
            expect(isSameBoardResult(undefined, base)).toBe(false)
        })

        it('treats an absent redux key as the falsy value the reducer deleted it for', () => {
            // 'Set open goals amount' / 'Set done goals amount' / 'Set board need show more in
            // project' delete the project key when the value is falsy, so a project that
            // contributes nothing reads back as undefined rather than 0/false.
            const empty = {
                boardMilestones: [],
                boardGoalsByMilestones: {},
                boardNeedShowMore: undefined,
                openGoalsAmount: undefined,
                doneGoalsAmount: undefined,
            }
            expect(
                isSameBoardResult(empty, {
                    boardMilestones: [],
                    boardGoalsByMilestones: {},
                    boardNeedShowMore: false,
                    openGoalsAmount: 0,
                    doneGoalsAmount: 0,
                })
            ).toBe(true)
        })
    })
})
