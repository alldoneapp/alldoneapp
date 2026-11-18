jest.mock('../shared/ProjectService', () => ({
    ProjectService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getUserProjects: jest.fn().mockResolvedValue([]),
    })),
}))
jest.mock('../GAnalytics/GAnalytics', () => ({
    logEvent: jest.fn(),
}))

const mockDocGet = jest.fn()
const mockDocSet = jest.fn(async () => {})
const mockCollectionGet = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: jest.fn(() => ({
            get: mockDocGet,
            set: mockDocSet,
        })),
        collection: jest.fn(() => ({
            orderBy: jest.fn(() => ({
                limit: jest.fn(() => ({
                    get: mockCollectionGet,
                })),
            })),
        })),
    })),
}))

jest.mock('openai', () => jest.fn())
jest.mock(
    '@dqbd/tiktoken/lite',
    () => ({
        Tiktoken: jest.fn().mockImplementation(() => ({
            encode: jest.fn(() => []),
            free: jest.fn(),
        })),
    }),
    { virtual: true }
)

const { buildGmailContactTargetFromRuntimeContext } = require('./assistantHelper')
jest.mock(
    '@dqbd/tiktoken/encoders/cl100k_base.json',
    () => ({
        bpe_ranks: {},
        special_tokens: {},
        pat_str: '',
    }),
    { virtual: true }
)
jest.mock(
    'firebase-functions/params',
    () => ({
        defineString: jest.fn(() => ({ value: jest.fn(() => '') })),
    }),
    { virtual: true }
)

describe('assistant Gmail runtime context helpers', () => {
    test('extracts Gmail contact target data from runtime context', () => {
        expect(
            buildGmailContactTargetFromRuntimeContext({
                gmailContext: {
                    origin: 'gmail_label_follow_up',
                    targetContactName: 'Eva-Maria Würz',
                    targetContactEmail: 'Eva-Maria.Wuerz@jtl-software.com',
                },
            })
        ).toEqual({
            contactName: 'Eva-Maria Würz',
            contactEmail: 'eva-maria.wuerz@jtl-software.com',
        })
    })

    test('ignores unrelated runtime contexts for Gmail contact target extraction', () => {
        expect(
            buildGmailContactTargetFromRuntimeContext({
                gmailContext: {
                    origin: 'other_origin',
                    targetContactName: 'Eva-Maria Würz',
                    targetContactEmail: 'Eva-Maria.Wuerz@jtl-software.com',
                },
            })
        ).toBeNull()
    })
})
