import { getDefaultProfilePhotoURL } from './defaultProfilePhotos'
import { isCapacitorShell } from './CapacitorShell'

jest.mock('./CapacitorShell', () => ({ isCapacitorShell: jest.fn(() => false) }))

afterEach(() => isCapacitorShell.mockReturnValue(false))

it('uses bundled assets on the current web origin, including localhost', () => {
    expect(getDefaultProfilePhotoURL()).toBe(`${window.location.origin}/images/generic-user.svg`)
    expect(getDefaultProfilePhotoURL(true)).toBe(`${window.location.origin}/images/illustrations/AnnaAlldone.png`)
})

it('does not save native shell URLs into profiles shared with other clients', () => {
    isCapacitorShell.mockReturnValue(true)
    expect(getDefaultProfilePhotoURL()).toBe('https://my.alldone.app/images/generic-user.svg')
})
