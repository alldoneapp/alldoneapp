import React from 'react'
import Icon from '../components/Icon'

import renderer from 'react-test-renderer'

// Icon is a function component and the name-to-glyph map is module-private, so
// the mapping is checked the way it is actually consumed: render the icon and
// read the character it puts on screen.
const firstString = node => {
    if (typeof node === 'string') return node
    if (!node || !node.children) return ''
    for (const child of node.children) {
        const found = firstString(child)
        if (found) return found
    }
    return ''
}

const charFor = name => firstString(renderer.create(<Icon name={name} />).toJSON())

describe('Icon component', () => {
    describe('Icon snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Icon />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Icon with opacity animation snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<Icon animation="loopOpacity" />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('mapNameToChar() test', () => {
        it('should return the correct text character for a given icon name', () => {
            let char = charFor('feed')
            expect(char).toBe('')

            char = charFor('square-checked-gray')
            expect(char).toBe('')

            char = charFor('multi-selection')
            expect(char).toBe('')

            char = charFor('status')
            expect(char).toBe('')

            char = charFor('workflow')
            expect(char).toBe('')

            char = charFor('folder-open')
            expect(char).toBe('')

            char = charFor('story-point')
            expect(char).toBe('')

            char = charFor('sticky-note')
            expect(char).toBe('')

            char = charFor('activity')
            expect(char).toBe('')

            char = charFor('airplay')
            expect(char).toBe('')
            char = charFor('alert-circle')

            expect(char).toBe('')
            char = charFor('alert-octagon')

            expect(char).toBe('')
            char = charFor('alert-triangle')

            expect(char).toBe('')
            char = charFor('align-center')

            expect(char).toBe('')
            char = charFor('align-justify')

            expect(char).toBe('')
            char = charFor('align-left')

            expect(char).toBe('')
            char = charFor('align-right')

            expect(char).toBe('')
            char = charFor('anchor')

            expect(char).toBe('')
            char = charFor('aperture')

            expect(char).toBe('')
            char = charFor('archive')

            expect(char).toBe('')
            char = charFor('arrow-down')

            expect(char).toBe('')
            char = charFor('arrow-down-circle')

            expect(char).toBe('')
            char = charFor('arrow-down-left')

            expect(char).toBe('')
            char = charFor('arrow-down-right')

            expect(char).toBe('')
            char = charFor('arrow-left')

            expect(char).toBe('')
            char = charFor('arrow-left-circle')

            expect(char).toBe('')
            char = charFor('arrow-right')

            expect(char).toBe('')
            char = charFor('arrow-right-circle')

            expect(char).toBe('')
            char = charFor('arrow-up')

            expect(char).toBe('')
            char = charFor('arrow-up-circle')

            expect(char).toBe('')
            char = charFor('arrow-up-left')

            expect(char).toBe('')
            char = charFor('arrow-up-right')

            expect(char).toBe('')
            char = charFor('at-sign')

            expect(char).toBe('')
            char = charFor('award')

            expect(char).toBe('')
            char = charFor('bar-chart')

            expect(char).toBe('')
            char = charFor('bar-chart-2')

            expect(char).toBe('')
            char = charFor('bar-chart-3')

            expect(char).toBe('')
            char = charFor('bar-chart-4')

            expect(char).toBe('')
            char = charFor('battery')

            expect(char).toBe('')
            char = charFor('battery-charging')

            expect(char).toBe('')
            char = charFor('bell')

            expect(char).toBe('')
            char = charFor('bell-off')

            expect(char).toBe('')
            char = charFor('bluetooth')

            expect(char).toBe('')
            char = charFor('bold')

            expect(char).toBe('')
            char = charFor('book')

            expect(char).toBe('')
            char = charFor('bookmark')
            expect(char).toBe('')

            char = charFor('book-open')
            expect(char).toBe('')

            char = charFor('box')
            expect(char).toBe('')

            char = charFor('briefcase')
            expect(char).toBe('')

            char = charFor('calendar')
            expect(char).toBe('')

            char = charFor('camera')
            expect(char).toBe('')

            char = charFor('camera-off')
            expect(char).toBe('')

            char = charFor('cast')
            expect(char).toBe('')

            char = charFor('check')
            expect(char).toBe('')

            char = charFor('check-circle')
            expect(char).toBe('')

            char = charFor('check-square')
            expect(char).toBe('')

            char = charFor('chevron-down')
            expect(char).toBe('')

            char = charFor('chevron-left')
            expect(char).toBe('')

            char = charFor('chevron-right')
            expect(char).toBe('')

            char = charFor('chevrons-down')
            expect(char).toBe('')

            char = charFor('chevrons-left')
            expect(char).toBe('')

            char = charFor('chevrons-right')
            expect(char).toBe('')

            char = charFor('chevrons-up')
            expect(char).toBe('')

            char = charFor('chevron-up')
            expect(char).toBe('')

            char = charFor('chrome')
            expect(char).toBe('')

            char = charFor('circle')
            expect(char).toBe('')

            char = charFor('circle-poject_color')
            expect(char).toBe('')

            char = charFor('clear-formatting')
            expect(char).toBe('')

            char = charFor('clipboard')
            expect(char).toBe('')

            char = charFor('clock')
            expect(char).toBe('')

            char = charFor('cloud')
            expect(char).toBe('')

            char = charFor('cloud-drizzle')
            expect(char).toBe('')

            char = charFor('cloud-lightning')
            expect(char).toBe('')

            char = charFor('cloud-off')
            expect(char).toBe('')

            char = charFor('cloud-rain')
            expect(char).toBe('')

            char = charFor('cloud-snow')
            expect(char).toBe('')

            char = charFor('code')
            expect(char).toBe('')

            char = charFor('codepen')
            expect(char).toBe('')

            char = charFor('codesandbox')
            expect(char).toBe('')

            char = charFor('coffee')
            expect(char).toBe('')

            char = charFor('columns')
            expect(char).toBe('')

            char = charFor('command')
            expect(char).toBe('')

            char = charFor('compass')
            expect(char).toBe('')

            char = charFor('copy')
            expect(char).toBe('')

            char = charFor('corner-down-left')
            expect(char).toBe('')

            char = charFor('corner-down-right')
            expect(char).toBe('')

            char = charFor('corner-left-down')
            expect(char).toBe('')

            char = charFor('corner-left-up')
            expect(char).toBe('')

            char = charFor('corner-right-down')
            expect(char).toBe('')

            char = charFor('corner-right-up')
            expect(char).toBe('')

            char = charFor('corner-up-left')
            expect(char).toBe('')

            char = charFor('corner-up-right')
            expect(char).toBe('')

            char = charFor('count-circle-0')
            expect(char).toBe('')

            char = charFor('count-circle-1')
            expect(char).toBe('')

            char = charFor('count-circle-2')
            expect(char).toBe('')

            char = charFor('count-circle-3')
            expect(char).toBe('')

            char = charFor('count-circle-5')
            expect(char).toBe('')

            char = charFor('count-circle-8')
            expect(char).toBe('')

            char = charFor('count-circle-13')
            expect(char).toBe('')

            char = charFor('count-circle-21')
            expect(char).toBe('')

            char = charFor('cpu')
            expect(char).toBe('')

            char = charFor('credit-card')
            expect(char).toBe('')

            char = charFor('crop')
            expect(char).toBe('')

            char = charFor('crosshair')
            expect(char).toBe('')

            char = charFor('cross-out-text')
            expect(char).toBe('')

            char = charFor('database')
            expect(char).toBe('')

            char = charFor('decrease-ident')
            expect(char).toBe('')

            char = charFor('delete')
            expect(char).toBe('')

            char = charFor('disc')
            expect(char).toBe('')

            char = charFor('dollar-sign')
            expect(char).toBe('')

            char = charFor('dot')
            expect(char).toBe('')

            char = charFor('download')
            expect(char).toBe('')

            char = charFor('download-cloud')
            expect(char).toBe('')

            char = charFor('droplet')
            expect(char).toBe('')

            char = charFor('dumbbell')
            expect(char).toBe('')

            char = charFor('ear')
            expect(char).toBe('')

            char = charFor('edit')
            expect(char).toBe('')

            char = charFor('edit-2')
            expect(char).toBe('')

            char = charFor('edit-3')
            expect(char).toBe('')

            char = charFor('edit-4')
            expect(char).toBe('')

            char = charFor('edit-5')
            expect(char).toBe('')

            char = charFor('edit-6')
            expect(char).toBe('')

            char = charFor('envelope-open')
            expect(char).toBe('')

            char = charFor('external-link')
            expect(char).toBe('')

            char = charFor('eye')
            expect(char).toBe('')

            char = charFor('eye-off')
            expect(char).toBe('')

            char = charFor('facebook')
            expect(char).toBe('')
            char = charFor('fast-forward')

            expect(char).toBe('')
            char = charFor('feather')

            expect(char).toBe('')
            char = charFor('figma')

            expect(char).toBe('')
            char = charFor('file')

            expect(char).toBe('')

            char = charFor('file-minus')
            expect(char).toBe('')

            char = charFor('file-plus')
            expect(char).toBe('')

            char = charFor('file-text')
            expect(char).toBe('')

            char = charFor('film')
            expect(char).toBe('')

            char = charFor('filter')
            expect(char).toBe('')

            char = charFor('flag')
            expect(char).toBe('')

            char = charFor('folder')
            expect(char).toBe('')

            char = charFor('folder-minus')
            expect(char).toBe('')

            char = charFor('folder-plus')
            expect(char).toBe('')

            char = charFor('framer')
            expect(char).toBe('')

            char = charFor('frown')
            expect(char).toBe('')

            char = charFor('gift')
            expect(char).toBe('')

            char = charFor('git-branch')
            expect(char).toBe('')

            char = charFor('git-commit')
            expect(char).toBe('')

            char = charFor('github')
            expect(char).toBe('')

            char = charFor('gitlab')
            expect(char).toBe('')

            char = charFor('git-merge')
            expect(char).toBe('')

            char = charFor('git-pull-request')
            expect(char).toBe('')

            char = charFor('globe')
            expect(char).toBe('')

            char = charFor('grid')
            expect(char).toBe('')

            char = charFor('hard-drive')
            expect(char).toBe('')

            char = charFor('hash')
            expect(char).toBe('')

            char = charFor('headphones')
            expect(char).toBe('')

            char = charFor('heart')
            expect(char).toBe('')

            char = charFor('help-circle')
            expect(char).toBe('')

            char = charFor('hexagon')
            expect(char).toBe('')

            char = charFor('highlight')
            expect(char).toBe('')

            char = charFor('count-0')
            expect(char).toBe('')

            char = charFor('count-1')
            expect(char).toBe('')

            char = charFor('count-2')
            expect(char).toBe('')

            char = charFor('count-3')
            expect(char).toBe('')

            char = charFor('count-5')
            expect(char).toBe('')

            char = charFor('count-8')
            expect(char).toBe('')

            char = charFor('count-13')
            expect(char).toBe('')

            char = charFor('count-21')
            expect(char).toBe('')

            char = charFor('home')
            expect(char).toBe('')

            char = charFor('image')
            expect(char).toBe('')

            char = charFor('inbox')
            expect(char).toBe('')

            char = charFor('increase-ident')
            expect(char).toBe('')

            char = charFor('info')
            expect(char).toBe('')

            char = charFor('instagram')
            expect(char).toBe('')

            char = charFor('italic')
            expect(char).toBe('')

            char = charFor('key')
            expect(char).toBe('')

            char = charFor('kick')
            expect(char).toBe('')

            char = charFor('layers')
            expect(char).toBe('')

            char = charFor('layout')
            expect(char).toBe('')

            char = charFor('life-buoy')
            expect(char).toBe('')

            char = charFor('line-spacing')
            expect(char).toBe('')

            char = charFor('link')
            expect(char).toBe('')

            char = charFor('link-2')
            expect(char).toBe('')

            char = charFor('linkedin')
            expect(char).toBe('')

            char = charFor('list')
            expect(char).toBe('')

            char = charFor('list-bulleted')
            expect(char).toBe('')

            char = charFor('list-numbered')
            expect(char).toBe('')

            char = charFor('loader')
            expect(char).toBe('')

            char = charFor('lock')
            expect(char).toBe('')

            char = charFor('log-in')
            expect(char).toBe('')

            char = charFor('log-out')
            expect(char).toBe('')

            char = charFor('mail')
            expect(char).toBe('')

            char = charFor('map')
            expect(char).toBe('')

            char = charFor('map-pin')
            expect(char).toBe('')

            char = charFor('maximize')
            expect(char).toBe('')

            char = charFor('maximize-2')
            expect(char).toBe('')

            char = charFor('meh')
            expect(char).toBe('')

            char = charFor('menu')
            expect(char).toBe('')

            char = charFor('message-circle')
            expect(char).toBe('')

            char = charFor('message-square')
            expect(char).toBe('')

            char = charFor('mic')
            expect(char).toBe('')

            char = charFor('mic-off')
            expect(char).toBe('')

            char = charFor('minimize')
            expect(char).toBe('')

            char = charFor('minimize-2')
            expect(char).toBe('')

            char = charFor('minus')
            expect(char).toBe('')

            char = charFor('minus-circle')
            expect(char).toBe('')

            char = charFor('minus-square')
            expect(char).toBe('')

            char = charFor('monitor')
            expect(char).toBe('')

            char = charFor('moon')
            expect(char).toBe('')

            char = charFor('more-horizontal')
            expect(char).toBe('')

            char = charFor('more-vertical')
            expect(char).toBe('')

            char = charFor('more-vertical-smaller')
            expect(char).toBe('')

            char = charFor('mouse-pointer')
            expect(char).toBe('')

            char = charFor('move')
            expect(char).toBe('')

            char = charFor('music')
            expect(char).toBe('')

            char = charFor('navigation')
            expect(char).toBe('')

            char = charFor('navigation-2')
            expect(char).toBe('')

            char = charFor('octagon')
            expect(char).toBe('')

            char = charFor('package')
            expect(char).toBe('')

            char = charFor('paintbrush')
            expect(char).toBe('')

            char = charFor('paperclip')
            expect(char).toBe('')

            char = charFor('pause')
            expect(char).toBe('')

            char = charFor('pause-circle')
            expect(char).toBe('')

            char = charFor('pen-tool')
            expect(char).toBe('')

            char = charFor('percent')
            expect(char).toBe('')

            char = charFor('phone')
            expect(char).toBe('')

            char = charFor('phone-call')
            expect(char).toBe('')

            char = charFor('phone-forwarded')
            expect(char).toBe('')

            char = charFor('phone-incoming')
            expect(char).toBe('')

            char = charFor('phone-missed')
            expect(char).toBe('')

            char = charFor('phone-off')
            expect(char).toBe('')

            char = charFor('phone-outgoing')
            expect(char).toBe('')

            char = charFor('pie-chart')
            expect(char).toBe('')

            char = charFor('pill')
            expect(char).toBe('')

            char = charFor('play')
            expect(char).toBe('')

            char = charFor('play-circle')
            expect(char).toBe('')

            char = charFor('plus')
            expect(char).toBe('')

            char = charFor('plus-circle')
            expect(char).toBe('')

            char = charFor('plus-square')
            expect(char).toBe('')

            char = charFor('pocket')
            expect(char).toBe('')

            char = charFor('power')
            expect(char).toBe('')

            char = charFor('printer')
            expect(char).toBe('')

            char = charFor('radio')
            expect(char).toBe('')

            char = charFor('refresh-ccw')
            expect(char).toBe('')

            char = charFor('refresh-cw')
            expect(char).toBe('')

            char = charFor('repeat')
            expect(char).toBe('')

            char = charFor('rewind')
            expect(char).toBe('')

            char = charFor('rotate-ccw')
            expect(char).toBe('')

            char = charFor('rotate-cw')
            expect(char).toBe('')

            char = charFor('rss')
            expect(char).toBe('')

            char = charFor('save')
            expect(char).toBe('')

            char = charFor('scissors')
            expect(char).toBe('')

            char = charFor('search')
            expect(char).toBe('')

            char = charFor('send')
            expect(char).toBe('')

            char = charFor('server')
            expect(char).toBe('')

            char = charFor('settings')
            expect(char).toBe('')

            char = charFor('share')
            expect(char).toBe('')

            char = charFor('share-2')
            expect(char).toBe('')

            char = charFor('shield')
            expect(char).toBe('')

            char = charFor('shield-off')
            expect(char).toBe('')

            char = charFor('shoe')
            expect(char).toBe('')

            char = charFor('shopping-bag')
            expect(char).toBe('')

            char = charFor('shopping-cart')
            expect(char).toBe('')

            char = charFor('shuffle')
            expect(char).toBe('')

            char = charFor('sidebar')
            expect(char).toBe('')

            char = charFor('skip-back')
            expect(char).toBe('')

            char = charFor('skip-forward')
            expect(char).toBe('')

            char = charFor('slack')
            expect(char).toBe('')

            char = charFor('slack-2')
            expect(char).toBe('')

            char = charFor('slash')
            expect(char).toBe('')

            char = charFor('sliders')
            expect(char).toBe('')

            char = charFor('smartphone')
            expect(char).toBe('')

            char = charFor('smile')
            expect(char).toBe('')

            char = charFor('sort-arrow')
            expect(char).toBe('')

            char = charFor('sort-list')
            expect(char).toBe('')

            char = charFor('speaker')
            expect(char).toBe('')

            char = charFor('square')
            expect(char).toBe('')

            char = charFor('star')
            expect(char).toBe('')

            char = charFor('stop-circle')
            expect(char).toBe('')

            char = charFor('summation')
            expect(char).toBe('')

            char = charFor('sun')
            expect(char).toBe('')

            char = charFor('sunrise')
            expect(char).toBe('')

            char = charFor('sunset')
            expect(char).toBe('')

            char = charFor('tablet')
            expect(char).toBe('')

            char = charFor('tag')
            expect(char).toBe('')

            char = charFor('target')
            expect(char).toBe('')

            char = charFor('terminal')
            expect(char).toBe('')

            char = charFor('text-color')
            expect(char).toBe('')

            char = charFor('thermometer')
            expect(char).toBe('')

            char = charFor('thumbs-down')
            expect(char).toBe('')

            char = charFor('thumbs-up')
            expect(char).toBe('')

            char = charFor('timestamp')
            expect(char).toBe('')

            char = charFor('toggle-left')
            expect(char).toBe('')

            char = charFor('toggle-right')
            expect(char).toBe('')

            char = charFor('tool')
            expect(char).toBe('')

            char = charFor('tooth')
            expect(char).toBe('')

            char = charFor('trash')
            expect(char).toBe('')

            char = charFor('trash-2')
            expect(char).toBe('')

            char = charFor('trello')
            expect(char).toBe('')

            char = charFor('trending-down')
            expect(char).toBe('')

            char = charFor('trending-up')
            expect(char).toBe('')

            char = charFor('triangle')
            expect(char).toBe('')

            char = charFor('truck')
            expect(char).toBe('')

            char = charFor('tv')
            expect(char).toBe('')

            char = charFor('twitch')
            expect(char).toBe('')

            char = charFor('twitter')
            expect(char).toBe('')

            char = charFor('type')
            expect(char).toBe('')

            char = charFor('umbrella')
            expect(char).toBe('')

            char = charFor('underline')
            expect(char).toBe('')

            char = charFor('unlock')
            expect(char).toBe('')

            char = charFor('upload')
            expect(char).toBe('')

            char = charFor('upload-cloud')
            expect(char).toBe('')

            char = charFor('user')
            expect(char).toBe('')

            char = charFor('user-check')
            expect(char).toBe('')

            char = charFor('user-minus')
            expect(char).toBe('')

            char = charFor('user-plus')
            expect(char).toBe('')

            char = charFor('users')
            expect(char).toBe('')

            char = charFor('user-x')
            expect(char).toBe('')

            char = charFor('video')
            expect(char).toBe('')

            char = charFor('video-off')
            expect(char).toBe('')

            char = charFor('voicemail')
            expect(char).toBe('')

            char = charFor('volume')
            expect(char).toBe('')

            char = charFor('volume-1')
            expect(char).toBe('')

            char = charFor('volume-2')
            expect(char).toBe('')

            char = charFor('volume-x')
            expect(char).toBe('')

            char = charFor('watch')
            expect(char).toBe('')

            char = charFor('wifi')
            expect(char).toBe('')

            char = charFor('wifi-off')
            expect(char).toBe('')

            char = charFor('wind')
            expect(char).toBe('')

            char = charFor('x')
            expect(char).toBe('')

            char = charFor('x-circle')
            expect(char).toBe('')

            char = charFor('x-octagon')
            expect(char).toBe('')

            char = charFor('x-square')
            expect(char).toBe('')

            char = charFor('youtube')
            expect(char).toBe('')

            char = charFor('zap')
            expect(char).toBe('')

            char = charFor('zap-off')
            expect(char).toBe('')

            char = charFor('zoom-in')
            expect(char).toBe('')

            char = charFor('zoom-out')
            expect(char).toBe('')
        })
    })
})
