import {
    SECONDARY_VIEW_CACHE_MAX_AGE_MS,
    SECONDARY_VIEW_CACHE_MAX_ENTRIES_PER_VIEW,
    SECONDARY_VIEW_CACHE_SCHEMA_VERSION,
    SECONDARY_VIEW_CHATS,
    SECONDARY_VIEW_GOALS,
    buildSecondaryViewCacheKey,
    getRestorableSecondaryViewCache,
    getSecondaryViewCacheEntrySync,
    resetSecondaryViewCacheForTests,
    setSecondaryViewCacheEntry,
} from './secondaryViewCache'

describe('secondary view stale-while-revalidate cache', () => {
    afterEach(() => resetSecondaryViewCacheForTests())

    it('restores only fresh entries for the matching user and schema', () => {
        const now = 1_000_000_000
        const record = {
            schemaVersion: SECONDARY_VIEW_CACHE_SCHEMA_VERSION,
            userId: 'user-1',
            savedAt: now,
            views: {
                [SECONDARY_VIEW_GOALS]: {
                    fresh: { savedAt: now, value: { rows: ['goal-1'] } },
                    stale: {
                        savedAt: now - SECONDARY_VIEW_CACHE_MAX_AGE_MS - 1,
                        value: { rows: ['old-goal'] },
                    },
                },
            },
        }

        expect(getRestorableSecondaryViewCache(record, 'user-1', now).views[SECONDARY_VIEW_GOALS]).toEqual({
            fresh: record.views[SECONDARY_VIEW_GOALS].fresh,
        })
        expect(getRestorableSecondaryViewCache(record, 'user-2', now)).toBeNull()
        expect(
            getRestorableSecondaryViewCache(
                { ...record, schemaVersion: SECONDARY_VIEW_CACHE_SCHEMA_VERSION + 1 },
                'user-1',
                now
            )
        ).toBeNull()
    })

    it('keeps per-user entries isolated and builds deterministic composite keys', () => {
        const key = buildSecondaryViewCacheKey('project-1', 0, ['#work'])
        expect(key).toBe(buildSecondaryViewCacheKey('project-1', 0, ['#work']))
        expect(key).not.toBe(buildSecondaryViewCacheKey('project-2', 0, ['#work']))

        setSecondaryViewCacheEntry('user-1', SECONDARY_VIEW_CHATS, key, { chats: ['chat-1'] }, { persist: false })

        expect(getSecondaryViewCacheEntrySync('user-1', SECONDARY_VIEW_CHATS, key)).toEqual({
            chats: ['chat-1'],
        })
        expect(getSecondaryViewCacheEntrySync('user-2', SECONDARY_VIEW_CHATS, key)).toBeNull()
    })

    it('bounds each view by evicting the least recently saved entries', () => {
        for (let index = 0; index <= SECONDARY_VIEW_CACHE_MAX_ENTRIES_PER_VIEW; index++) {
            setSecondaryViewCacheEntry(
                'user-1',
                SECONDARY_VIEW_CHATS,
                `key-${index}`,
                { index },
                { savedAt: index + 1, persist: false }
            )
        }

        expect(getSecondaryViewCacheEntrySync('user-1', SECONDARY_VIEW_CHATS, 'key-0', 129)).toBeNull()
        expect(
            getSecondaryViewCacheEntrySync(
                'user-1',
                SECONDARY_VIEW_CHATS,
                `key-${SECONDARY_VIEW_CACHE_MAX_ENTRIES_PER_VIEW}`,
                129
            )
        ).toEqual({ index: SECONDARY_VIEW_CACHE_MAX_ENTRIES_PER_VIEW })
    })
})
