import { getAnnaShortName } from './annaShortName'

// AT-3056: the phone's chat header names the assistant briefly so the focus task keeps the room.
describe('getAnnaShortName', () => {
    it.each([
        ['Anna Alldone', 'Anna'],
        ['  Alldone   CTO ', 'Alldone'],
        ['Mira', 'Mira'],
        ['Maximiliane Alexandra von Hohenzollern', 'Maximiliane'],
        // One or two letters say too little alone.
        ['AI Coach', 'AI Coach'],
        ['Dr Müller-Lüdenscheidt', 'Dr Müller-Lüdenscheidt'],
        ['A', 'A'],
        ['', ''],
        [null, ''],
        [undefined, ''],
    ])('%p → %p', (name, short) => {
        expect(getAnnaShortName(name)).toBe(short)
    })
})
