jest.mock('../../../Workstreams/WorkstreamHelper', () => ({
    getWorkstreamById: jest.fn(),
    getWorkstreamMembers: jest.fn(() => ['member-a', 'member-b']),
    getWorkstreamUserIds: jest.fn(),
    isWorkstream: jest.fn(id => String(id).startsWith('ws@')),
    WORKSTREAM_ID_PREFIX: 'ws@',
}))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({ getContactInProject: jest.fn(() => null) }))
jest.mock('../../../../redux/store', () => ({ getState: jest.fn(() => ({})), dispatch: jest.fn() }))
jest.mock('../../../../utils/BackendBridge', () => ({}))

import { getAllOwnerIds } from './PrivacyModal'

// security audit 2026-11 (NV-40 side bug): the workstream branch read `secondaryOwnersIds - [...]`,
// a subtraction whose result was thrown away, so a private object owned by a workstream listed no
// member uids at all — nobody but the workstream id, which Firestore's readerIds never honours.
describe('getAllOwnerIds', () => {
    it('adds the members of an owning workstream as explicit readers', () => {
        expect(getAllOwnerIds('project-1', ['ws@team'])).toEqual(['ws@team', 'member-a', 'member-b'])
    })

    it('does not duplicate a member who is already an owner', () => {
        expect(getAllOwnerIds('project-1', ['ws@team', 'member-a'])).toEqual(['ws@team', 'member-a', 'member-b'])
    })
})
