import { launchImageLibraryAsync, MediaTypeOptions } from '../../utils/WebShims/ImagePicker'

describe('ImagePicker web shim', () => {
    let originalFileReader
    let originalImage

    beforeEach(() => {
        originalFileReader = global.FileReader
        originalImage = global.Image
        document.body.innerHTML = ''
    })

    afterEach(() => {
        global.FileReader = originalFileReader
        global.Image = originalImage
        jest.useRealTimers()
        document.body.innerHTML = ''
    })

    it('does not let the hidden input click reach popover outside-click handlers', async () => {
        const outsideClick = jest.fn()
        window.addEventListener('click', outsideClick)

        const resultPromise = launchImageLibraryAsync({ mediaTypes: MediaTypeOptions.Images })
        const input = document.querySelector('input[type="file"]')

        expect(input).not.toBeNull()
        expect(outsideClick).not.toHaveBeenCalled()

        input.dispatchEvent(new Event('change'))
        await expect(resultPromise).resolves.toEqual({ cancelled: true })

        window.removeEventListener('click', outsideClick)
    })

    it('does not report a selected file as cancelled while it is still being read', async () => {
        jest.useFakeTimers()

        let reader
        global.FileReader = class FileReader {
            constructor() {
                reader = this
            }

            readAsDataURL() {}
        }
        global.Image = class Image {
            set src(uri) {
                this.naturalWidth = 640
                this.naturalHeight = 480
                this.onload()
            }
        }

        const resultPromise = launchImageLibraryAsync({ mediaTypes: MediaTypeOptions.All })
        const input = document.querySelector('input[type="file"]')
        const file = new File(['image'], 'avatar.png', { type: 'image/png' })
        Object.defineProperty(input, 'files', { value: [file] })

        input.dispatchEvent(new Event('change'))
        window.dispatchEvent(new Event('focus'))
        jest.advanceTimersByTime(400)

        let settled = false
        resultPromise.then(() => {
            settled = true
        })
        await Promise.resolve()
        expect(settled).toBe(false)

        reader.result = 'data:image/png;base64,aW1hZ2U='
        reader.onload()

        await expect(resultPromise).resolves.toEqual({
            cancelled: false,
            uri: 'data:image/png;base64,aW1hZ2U=',
            width: 640,
            height: 480,
            type: 'image',
        })
    })
})
