import { isPrivateObject, isPublicForAll } from './privacyMarker'
import { FEED_PUBLIC_FOR_ALL } from '../../Utils/FeedsConstants'

describe('privacyMarker', () => {
    it('treats the numeric sentinel as public (Redux-sourced objects)', () => {
        expect(isPublicForAll([FEED_PUBLIC_FOR_ALL, 'uid1'])).toBe(true)
        expect(isPrivateObject({ isPublicFor: [FEED_PUBLIC_FOR_ALL, 'uid1'] })).toBe(false)
    })

    // The regression: Typesense stringifies isPublicFor at index time, so a public search
    // hit arrives as ['0', 'uid1']. A strict includes(0) drew the lock on every result.
    it('treats the stringified sentinel as public (Typesense search hits)', () => {
        expect(isPublicForAll(['0', 'uid1'])).toBe(true)
        expect(isPrivateObject({ isPublicFor: ['0', 'uid1'] })).toBe(false)
    })

    it('still marks genuinely private objects, in both shapes', () => {
        expect(isPrivateObject({ isPublicFor: ['uid1'] })).toBe(true)
        expect(isPrivateObject({ isPublicFor: ['uid1', 'ws@default'] })).toBe(true)
        expect(isPrivateObject({ isPrivate: true, isPublicFor: ['0', 'uid1'] })).toBe(true)
    })

    it('does not mark objects that carry no privacy scope at all', () => {
        expect(isPrivateObject({})).toBe(false)
        expect(isPrivateObject({ isPublicFor: undefined })).toBe(false)
        expect(isPrivateObject(null)).toBe(false)
    })

    it('does not let a lookalike id pass as the public sentinel', () => {
        expect(isPublicForAll(['00', 'uid1'])).toBe(false)
        expect(isPublicForAll([])).toBe(false)
    })
})
