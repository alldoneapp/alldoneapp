import { getMergeStatusLabel, getTaskMergeRequest } from './MergeStatus'

describe('merge status task data', () => {
    test('preserves the exact backend-provided VM merge request object', () => {
        const vmMergeRequest = {
            provider: 'gitlab',
            url: 'https://gitlab.com/alldonegmbh/alldone/-/merge_requests/89',
            number: 89,
            status: 'checks_running',
            statusUpdatedAt: 1784194852866,
        }

        expect(getTaskMergeRequest({ vmMergeRequest })).toBe(vmMergeRequest)
    })

    test('returns null for tasks without VM merge metadata', () => {
        expect(getTaskMergeRequest({})).toBeNull()
        expect(getTaskMergeRequest(null)).toBeNull()
    })

    test('keeps normalized status labels unchanged', () => {
        expect(getMergeStatusLabel('ready_to_merge')).toBe('Ready to merge')
        expect(getMergeStatusLabel('unknown')).toBeNull()
    })
})
