import { isTransparentColor, resolveBackgroundColor, withLayerTransparent } from './rageTargets'

describe('rage mode targets', () => {
    it('recognises transparent colours', () => {
        expect(isTransparentColor('transparent')).toBe(true)
        expect(isTransparentColor('rgba(0, 0, 0, 0)')).toBe(true)
        expect(isTransparentColor('')).toBe(true)
        expect(isTransparentColor('rgba(0, 0, 0, 0.4)')).toBe(false)
        expect(isTransparentColor('rgb(241, 243, 244)')).toBe(false)
    })

    it('paints a hole with the first opaque background on the way up', () => {
        const outer = document.createElement('div')
        const inner = document.createElement('span')
        outer.appendChild(inner)
        const styles = new Map([
            [inner, { backgroundColor: 'rgba(0, 0, 0, 0)' }],
            [outer, { backgroundColor: 'rgb(241, 243, 244)' }],
        ])
        const getStyle = node => styles.get(node) || { backgroundColor: 'transparent' }
        expect(resolveBackgroundColor(inner, getStyle)).toBe('rgb(241, 243, 244)')
        expect(resolveBackgroundColor(inner.appendChild(document.createTextNode('a')), getStyle)).toBe(
            'rgb(241, 243, 244)'
        )
    })

    it('falls back to white when nothing on the way up is opaque', () => {
        const lonely = document.createElement('div')
        expect(resolveBackgroundColor(lonely, () => ({ backgroundColor: 'transparent' }))).toBe('#ffffff')
    })

    it('switches the input layer off only for the duration of a hit test, even when it throws', () => {
        const layer = document.createElement('div')
        layer.style.pointerEvents = 'auto'
        let during = null
        withLayerTransparent(layer, () => {
            during = layer.style.pointerEvents
        })
        expect(during).toBe('none')
        expect(layer.style.pointerEvents).toBe('auto')

        expect(() =>
            withLayerTransparent(layer, () => {
                throw new Error('boom')
            })
        ).toThrow('boom')
        expect(layer.style.pointerEvents).toBe('auto')
    })
})
