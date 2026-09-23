import React from 'react'
import renderer from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native-web'

import DvTitleLayout from './DvTitleLayout'

const mockState = {
    smallScreenNavigation: false,
    isMiddleScreen: false,
}

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../../hooks/useLastEditDate', () => () => '14 hours ago')
jest.mock('../Icon', () => 'Icon')
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))

const makeLayout = props =>
    renderer.create(
        <DvTitleLayout
            typeLabel="NOTE"
            typeIcon="file-text"
            lastEditionDate={123}
            editorName="Karsten Wysk"
            shortEditorName="Karsten"
            onPress={() => {}}
            {...props}
        >
            <Text>Note title</Text>
        </DvTitleLayout>
    )

const visibleText = tree => tree.root.findAllByType(Text).map(node => node.props.children)

describe('DvTitleLayout', () => {
    beforeEach(() => {
        mockState.smallScreenNavigation = false
        mockState.isMiddleScreen = false
    })

    test('keeps the full editor line beside the title on desktop', () => {
        const tree = makeLayout()

        expect(visibleText(tree)).toContain('edited 14 hours ago by Karsten Wysk')
        expect(tree.root.findAllByType(TouchableOpacity)).toHaveLength(1)
        expect(
            tree.root
                .findByType(TouchableOpacity)
                .findAllByType(Text)
                .map(node => node.props.children)
        ).toEqual(['Note title'])
    })

    test('uses the shorter editor name on middle screens', () => {
        mockState.isMiddleScreen = true
        const tree = makeLayout()

        expect(visibleText(tree)).toContain('edited 14 hours ago by Karsten')
    })

    test('keeps the type and short edit line beside the title on mobile', () => {
        mockState.smallScreenNavigation = true
        const tree = makeLayout()

        expect(visibleText(tree)).toContain('edited 14 hours ago\nby Karsten')
        expect(visibleText(tree)).toContain('NOTE')
    })

    test('hides the edit line in fullscreen while keeping the type', () => {
        const tree = makeLayout({ hideLastEdited: true })

        expect(visibleText(tree)).toContain('NOTE')
        expect(visibleText(tree)).not.toContain('edited 14 hours ago by Karsten Wysk')
    })
})
