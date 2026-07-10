import { EMAIL_LINE_ENABLED } from './emailLineFeature'

describe('emailLineFeature', () => {
    it('keeps the standalone Email line disabled', () => {
        expect(EMAIL_LINE_ENABLED).toBe(false)
    })
})
