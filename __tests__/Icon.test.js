import React from 'react'
import Icon from '../components/Icon'

import renderer from 'react-test-renderer'

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
            const ico = new Icon()

            let char = ico.mapNameToChar('feed')
            expect(char).toBe('')

            char = ico.mapNameToChar('square-checked-gray')
            expect(char).toBe('')

            char = ico.mapNameToChar('multi-selection')
            expect(char).toBe('')

            char = ico.mapNameToChar('status')
            expect(char).toBe('')

            char = ico.mapNameToChar('workflow')
            expect(char).toBe('')

            char = ico.mapNameToChar('folder-open')
            expect(char).toBe('')

            char = ico.mapNameToChar('story-point')
            expect(char).toBe('')

            char = ico.mapNameToChar('sticky-note')
            expect(char).toBe('')

            char = ico.mapNameToChar('activity')
            expect(char).toBe('')

            char = ico.mapNameToChar('airplay')
            expect(char).toBe('')
            char = ico.mapNameToChar('alert-circle')

            expect(char).toBe('')
            char = ico.mapNameToChar('alert-octagon')

            expect(char).toBe('')
            char = ico.mapNameToChar('alert-triangle')

            expect(char).toBe('')
            char = ico.mapNameToChar('align-center')

            expect(char).toBe('')
            char = ico.mapNameToChar('align-justify')

            expect(char).toBe('')
            char = ico.mapNameToChar('align-left')

            expect(char).toBe('')
            char = ico.mapNameToChar('align-right')

            expect(char).toBe('')
            char = ico.mapNameToChar('anchor')

            expect(char).toBe('')
            char = ico.mapNameToChar('aperture')

            expect(char).toBe('')
            char = ico.mapNameToChar('archive')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-down')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-down-circle')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-down-left')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-down-right')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-left')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-left-circle')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-right')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-right-circle')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-up')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-up-circle')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-up-left')

            expect(char).toBe('')
            char = ico.mapNameToChar('arrow-up-right')

            expect(char).toBe('')
            char = ico.mapNameToChar('at-sign')

            expect(char).toBe('')
            char = ico.mapNameToChar('award')

            expect(char).toBe('')
            char = ico.mapNameToChar('bar-chart')

            expect(char).toBe('')
            char = ico.mapNameToChar('bar-chart-2')

            expect(char).toBe('')
            char = ico.mapNameToChar('bar-chart-3')

            expect(char).toBe('')
            char = ico.mapNameToChar('bar-chart-4')

            expect(char).toBe('')
            char = ico.mapNameToChar('battery')

            expect(char).toBe('')
            char = ico.mapNameToChar('battery-charging')

            expect(char).toBe('')
            char = ico.mapNameToChar('bell')

            expect(char).toBe('')
            char = ico.mapNameToChar('bell-off')

            expect(char).toBe('')
            char = ico.mapNameToChar('bluetooth')

            expect(char).toBe('')
            char = ico.mapNameToChar('bold')

            expect(char).toBe('')
            char = ico.mapNameToChar('book')

            expect(char).toBe('')
            char = ico.mapNameToChar('bookmark')
            expect(char).toBe('')

            char = ico.mapNameToChar('book-open')
            expect(char).toBe('')

            char = ico.mapNameToChar('box')
            expect(char).toBe('')

            char = ico.mapNameToChar('briefcase')
            expect(char).toBe('')

            char = ico.mapNameToChar('calendar')
            expect(char).toBe('')

            char = ico.mapNameToChar('camera')
            expect(char).toBe('')

            char = ico.mapNameToChar('camera-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('cast')
            expect(char).toBe('')

            char = ico.mapNameToChar('check')
            expect(char).toBe('')

            char = ico.mapNameToChar('check-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('check-square')
            expect(char).toBe('')

            char = ico.mapNameToChar('chevron-down')
            expect(char).toBe('')

            char = ico.mapNameToChar('chevron-left')
            expect(char).toBe('')

            char = ico.mapNameToChar('chevron-right')
            expect(char).toBe('')

            char = ico.mapNameToChar('chevrons-down')
            expect(char).toBe('')

            char = ico.mapNameToChar('chevrons-left')
            expect(char).toBe('')

            char = ico.mapNameToChar('chevrons-right')
            expect(char).toBe('')

            char = ico.mapNameToChar('chevrons-up')
            expect(char).toBe('')

            char = ico.mapNameToChar('chevron-up')
            expect(char).toBe('')

            char = ico.mapNameToChar('chrome')
            expect(char).toBe('')

            char = ico.mapNameToChar('circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('circle-poject_color')
            expect(char).toBe('')

            char = ico.mapNameToChar('clear-formatting')
            expect(char).toBe('')

            char = ico.mapNameToChar('clipboard')
            expect(char).toBe('')

            char = ico.mapNameToChar('clock')
            expect(char).toBe('')

            char = ico.mapNameToChar('cloud')
            expect(char).toBe('')

            char = ico.mapNameToChar('cloud-drizzle')
            expect(char).toBe('')

            char = ico.mapNameToChar('cloud-lightning')
            expect(char).toBe('')

            char = ico.mapNameToChar('cloud-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('cloud-rain')
            expect(char).toBe('')

            char = ico.mapNameToChar('cloud-snow')
            expect(char).toBe('')

            char = ico.mapNameToChar('code')
            expect(char).toBe('')

            char = ico.mapNameToChar('codepen')
            expect(char).toBe('')

            char = ico.mapNameToChar('codesandbox')
            expect(char).toBe('')

            char = ico.mapNameToChar('coffee')
            expect(char).toBe('')

            char = ico.mapNameToChar('columns')
            expect(char).toBe('')

            char = ico.mapNameToChar('command')
            expect(char).toBe('')

            char = ico.mapNameToChar('compass')
            expect(char).toBe('')

            char = ico.mapNameToChar('copy')
            expect(char).toBe('')

            char = ico.mapNameToChar('corner-down-left')
            expect(char).toBe('')

            char = ico.mapNameToChar('corner-down-right')
            expect(char).toBe('')

            char = ico.mapNameToChar('corner-left-down')
            expect(char).toBe('')

            char = ico.mapNameToChar('corner-left-up')
            expect(char).toBe('')

            char = ico.mapNameToChar('corner-right-down')
            expect(char).toBe('')

            char = ico.mapNameToChar('corner-right-up')
            expect(char).toBe('')

            char = ico.mapNameToChar('corner-up-left')
            expect(char).toBe('')

            char = ico.mapNameToChar('corner-up-right')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-circle-0')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-circle-1')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-circle-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-circle-3')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-circle-5')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-circle-8')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-circle-13')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-circle-21')
            expect(char).toBe('')

            char = ico.mapNameToChar('cpu')
            expect(char).toBe('')

            char = ico.mapNameToChar('credit-card')
            expect(char).toBe('')

            char = ico.mapNameToChar('crop')
            expect(char).toBe('')

            char = ico.mapNameToChar('crosshair')
            expect(char).toBe('')

            char = ico.mapNameToChar('cross-out-text')
            expect(char).toBe('')

            char = ico.mapNameToChar('database')
            expect(char).toBe('')

            char = ico.mapNameToChar('decrease-ident')
            expect(char).toBe('')

            char = ico.mapNameToChar('delete')
            expect(char).toBe('')

            char = ico.mapNameToChar('disc')
            expect(char).toBe('')

            char = ico.mapNameToChar('dollar-sign')
            expect(char).toBe('')

            char = ico.mapNameToChar('dot')
            expect(char).toBe('')

            char = ico.mapNameToChar('download')
            expect(char).toBe('')

            char = ico.mapNameToChar('download-cloud')
            expect(char).toBe('')

            char = ico.mapNameToChar('droplet')
            expect(char).toBe('')

            char = ico.mapNameToChar('dumbbell')
            expect(char).toBe('')

            char = ico.mapNameToChar('ear')
            expect(char).toBe('')

            char = ico.mapNameToChar('edit')
            expect(char).toBe('')

            char = ico.mapNameToChar('edit-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('edit-3')
            expect(char).toBe('')

            char = ico.mapNameToChar('edit-4')
            expect(char).toBe('')

            char = ico.mapNameToChar('edit-5')
            expect(char).toBe('')

            char = ico.mapNameToChar('edit-6')
            expect(char).toBe('')

            char = ico.mapNameToChar('envelope-open')
            expect(char).toBe('')

            char = ico.mapNameToChar('external-link')
            expect(char).toBe('')

            char = ico.mapNameToChar('eye')
            expect(char).toBe('')

            char = ico.mapNameToChar('eye-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('facebook')
            expect(char).toBe('')
            char = ico.mapNameToChar('fast-forward')

            expect(char).toBe('')
            char = ico.mapNameToChar('feather')

            expect(char).toBe('')
            char = ico.mapNameToChar('figma')

            expect(char).toBe('')
            char = ico.mapNameToChar('file')

            expect(char).toBe('')

            char = ico.mapNameToChar('file-minus')
            expect(char).toBe('')

            char = ico.mapNameToChar('file-plus')
            expect(char).toBe('')

            char = ico.mapNameToChar('file-text')
            expect(char).toBe('')

            char = ico.mapNameToChar('film')
            expect(char).toBe('')

            char = ico.mapNameToChar('filter')
            expect(char).toBe('')

            char = ico.mapNameToChar('flag')
            expect(char).toBe('')

            char = ico.mapNameToChar('folder')
            expect(char).toBe('')

            char = ico.mapNameToChar('folder-minus')
            expect(char).toBe('')

            char = ico.mapNameToChar('folder-plus')
            expect(char).toBe('')

            char = ico.mapNameToChar('framer')
            expect(char).toBe('')

            char = ico.mapNameToChar('frown')
            expect(char).toBe('')

            char = ico.mapNameToChar('gift')
            expect(char).toBe('')

            char = ico.mapNameToChar('git-branch')
            expect(char).toBe('')

            char = ico.mapNameToChar('git-commit')
            expect(char).toBe('')

            char = ico.mapNameToChar('github')
            expect(char).toBe('')

            char = ico.mapNameToChar('gitlab')
            expect(char).toBe('')

            char = ico.mapNameToChar('git-merge')
            expect(char).toBe('')

            char = ico.mapNameToChar('git-pull-request')
            expect(char).toBe('')

            char = ico.mapNameToChar('globe')
            expect(char).toBe('')

            char = ico.mapNameToChar('grid')
            expect(char).toBe('')

            char = ico.mapNameToChar('hard-drive')
            expect(char).toBe('')

            char = ico.mapNameToChar('hash')
            expect(char).toBe('')

            char = ico.mapNameToChar('headphones')
            expect(char).toBe('')

            char = ico.mapNameToChar('heart')
            expect(char).toBe('')

            char = ico.mapNameToChar('help-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('hexagon')
            expect(char).toBe('')

            char = ico.mapNameToChar('highlight')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-0')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-1')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-3')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-5')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-8')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-13')
            expect(char).toBe('')

            char = ico.mapNameToChar('count-21')
            expect(char).toBe('')

            char = ico.mapNameToChar('home')
            expect(char).toBe('')

            char = ico.mapNameToChar('image')
            expect(char).toBe('')

            char = ico.mapNameToChar('inbox')
            expect(char).toBe('')

            char = ico.mapNameToChar('increase-ident')
            expect(char).toBe('')

            char = ico.mapNameToChar('info')
            expect(char).toBe('')

            char = ico.mapNameToChar('instagram')
            expect(char).toBe('')

            char = ico.mapNameToChar('italic')
            expect(char).toBe('')

            char = ico.mapNameToChar('key')
            expect(char).toBe('')

            char = ico.mapNameToChar('kick')
            expect(char).toBe('')

            char = ico.mapNameToChar('layers')
            expect(char).toBe('')

            char = ico.mapNameToChar('layout')
            expect(char).toBe('')

            char = ico.mapNameToChar('life-buoy')
            expect(char).toBe('')

            char = ico.mapNameToChar('line-spacing')
            expect(char).toBe('')

            char = ico.mapNameToChar('link')
            expect(char).toBe('')

            char = ico.mapNameToChar('link-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('linkedin')
            expect(char).toBe('')

            char = ico.mapNameToChar('list')
            expect(char).toBe('')

            char = ico.mapNameToChar('list-bulleted')
            expect(char).toBe('')

            char = ico.mapNameToChar('list-numbered')
            expect(char).toBe('')

            char = ico.mapNameToChar('loader')
            expect(char).toBe('')

            char = ico.mapNameToChar('lock')
            expect(char).toBe('')

            char = ico.mapNameToChar('log-in')
            expect(char).toBe('')

            char = ico.mapNameToChar('log-out')
            expect(char).toBe('')

            char = ico.mapNameToChar('mail')
            expect(char).toBe('')

            char = ico.mapNameToChar('map')
            expect(char).toBe('')

            char = ico.mapNameToChar('map-pin')
            expect(char).toBe('')

            char = ico.mapNameToChar('maximize')
            expect(char).toBe('')

            char = ico.mapNameToChar('maximize-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('meh')
            expect(char).toBe('')

            char = ico.mapNameToChar('menu')
            expect(char).toBe('')

            char = ico.mapNameToChar('message-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('message-square')
            expect(char).toBe('')

            char = ico.mapNameToChar('mic')
            expect(char).toBe('')

            char = ico.mapNameToChar('mic-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('minimize')
            expect(char).toBe('')

            char = ico.mapNameToChar('minimize-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('minus')
            expect(char).toBe('')

            char = ico.mapNameToChar('minus-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('minus-square')
            expect(char).toBe('')

            char = ico.mapNameToChar('monitor')
            expect(char).toBe('')

            char = ico.mapNameToChar('moon')
            expect(char).toBe('')

            char = ico.mapNameToChar('more-horizontal')
            expect(char).toBe('')

            char = ico.mapNameToChar('more-vertical')
            expect(char).toBe('')

            char = ico.mapNameToChar('more-vertical-smaller')
            expect(char).toBe('')

            char = ico.mapNameToChar('mouse-pointer')
            expect(char).toBe('')

            char = ico.mapNameToChar('move')
            expect(char).toBe('')

            char = ico.mapNameToChar('music')
            expect(char).toBe('')

            char = ico.mapNameToChar('navigation')
            expect(char).toBe('')

            char = ico.mapNameToChar('navigation-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('octagon')
            expect(char).toBe('')

            char = ico.mapNameToChar('package')
            expect(char).toBe('')

            char = ico.mapNameToChar('paintbrush')
            expect(char).toBe('')

            char = ico.mapNameToChar('paperclip')
            expect(char).toBe('')

            char = ico.mapNameToChar('pause')
            expect(char).toBe('')

            char = ico.mapNameToChar('pause-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('pen-tool')
            expect(char).toBe('')

            char = ico.mapNameToChar('percent')
            expect(char).toBe('')

            char = ico.mapNameToChar('phone')
            expect(char).toBe('')

            char = ico.mapNameToChar('phone-call')
            expect(char).toBe('')

            char = ico.mapNameToChar('phone-forwarded')
            expect(char).toBe('')

            char = ico.mapNameToChar('phone-incoming')
            expect(char).toBe('')

            char = ico.mapNameToChar('phone-missed')
            expect(char).toBe('')

            char = ico.mapNameToChar('phone-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('phone-outgoing')
            expect(char).toBe('')

            char = ico.mapNameToChar('pie-chart')
            expect(char).toBe('')

            char = ico.mapNameToChar('pill')
            expect(char).toBe('')

            char = ico.mapNameToChar('play')
            expect(char).toBe('')

            char = ico.mapNameToChar('play-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('plus')
            expect(char).toBe('')

            char = ico.mapNameToChar('plus-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('plus-square')
            expect(char).toBe('')

            char = ico.mapNameToChar('pocket')
            expect(char).toBe('')

            char = ico.mapNameToChar('power')
            expect(char).toBe('')

            char = ico.mapNameToChar('printer')
            expect(char).toBe('')

            char = ico.mapNameToChar('radio')
            expect(char).toBe('')

            char = ico.mapNameToChar('refresh-ccw')
            expect(char).toBe('')

            char = ico.mapNameToChar('refresh-cw')
            expect(char).toBe('')

            char = ico.mapNameToChar('repeat')
            expect(char).toBe('')

            char = ico.mapNameToChar('rewind')
            expect(char).toBe('')

            char = ico.mapNameToChar('rotate-ccw')
            expect(char).toBe('')

            char = ico.mapNameToChar('rotate-cw')
            expect(char).toBe('')

            char = ico.mapNameToChar('rss')
            expect(char).toBe('')

            char = ico.mapNameToChar('save')
            expect(char).toBe('')

            char = ico.mapNameToChar('scissors')
            expect(char).toBe('')

            char = ico.mapNameToChar('search')
            expect(char).toBe('')

            char = ico.mapNameToChar('send')
            expect(char).toBe('')

            char = ico.mapNameToChar('server')
            expect(char).toBe('')

            char = ico.mapNameToChar('settings')
            expect(char).toBe('')

            char = ico.mapNameToChar('share')
            expect(char).toBe('')

            char = ico.mapNameToChar('share-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('shield')
            expect(char).toBe('')

            char = ico.mapNameToChar('shield-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('shoe')
            expect(char).toBe('')

            char = ico.mapNameToChar('shopping-bag')
            expect(char).toBe('')

            char = ico.mapNameToChar('shopping-cart')
            expect(char).toBe('')

            char = ico.mapNameToChar('shuffle')
            expect(char).toBe('')

            char = ico.mapNameToChar('sidebar')
            expect(char).toBe('')

            char = ico.mapNameToChar('skip-back')
            expect(char).toBe('')

            char = ico.mapNameToChar('skip-forward')
            expect(char).toBe('')

            char = ico.mapNameToChar('slack')
            expect(char).toBe('')

            char = ico.mapNameToChar('slack-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('slash')
            expect(char).toBe('')

            char = ico.mapNameToChar('sliders')
            expect(char).toBe('')

            char = ico.mapNameToChar('smartphone')
            expect(char).toBe('')

            char = ico.mapNameToChar('smile')
            expect(char).toBe('')

            char = ico.mapNameToChar('sort-arrow')
            expect(char).toBe('')

            char = ico.mapNameToChar('sort-list')
            expect(char).toBe('')

            char = ico.mapNameToChar('speaker')
            expect(char).toBe('')

            char = ico.mapNameToChar('square')
            expect(char).toBe('')

            char = ico.mapNameToChar('star')
            expect(char).toBe('')

            char = ico.mapNameToChar('stop-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('summation')
            expect(char).toBe('')

            char = ico.mapNameToChar('sun')
            expect(char).toBe('')

            char = ico.mapNameToChar('sunrise')
            expect(char).toBe('')

            char = ico.mapNameToChar('sunset')
            expect(char).toBe('')

            char = ico.mapNameToChar('tablet')
            expect(char).toBe('')

            char = ico.mapNameToChar('tag')
            expect(char).toBe('')

            char = ico.mapNameToChar('target')
            expect(char).toBe('')

            char = ico.mapNameToChar('terminal')
            expect(char).toBe('')

            char = ico.mapNameToChar('text-color')
            expect(char).toBe('')

            char = ico.mapNameToChar('thermometer')
            expect(char).toBe('')

            char = ico.mapNameToChar('thumbs-down')
            expect(char).toBe('')

            char = ico.mapNameToChar('thumbs-up')
            expect(char).toBe('')

            char = ico.mapNameToChar('timestamp')
            expect(char).toBe('')

            char = ico.mapNameToChar('toggle-left')
            expect(char).toBe('')

            char = ico.mapNameToChar('toggle-right')
            expect(char).toBe('')

            char = ico.mapNameToChar('tool')
            expect(char).toBe('')

            char = ico.mapNameToChar('tooth')
            expect(char).toBe('')

            char = ico.mapNameToChar('trash')
            expect(char).toBe('')

            char = ico.mapNameToChar('trash-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('trello')
            expect(char).toBe('')

            char = ico.mapNameToChar('trending-down')
            expect(char).toBe('')

            char = ico.mapNameToChar('trending-up')
            expect(char).toBe('')

            char = ico.mapNameToChar('triangle')
            expect(char).toBe('')

            char = ico.mapNameToChar('truck')
            expect(char).toBe('')

            char = ico.mapNameToChar('tv')
            expect(char).toBe('')

            char = ico.mapNameToChar('twitch')
            expect(char).toBe('')

            char = ico.mapNameToChar('twitter')
            expect(char).toBe('')

            char = ico.mapNameToChar('type')
            expect(char).toBe('')

            char = ico.mapNameToChar('umbrella')
            expect(char).toBe('')

            char = ico.mapNameToChar('underline')
            expect(char).toBe('')

            char = ico.mapNameToChar('unlock')
            expect(char).toBe('')

            char = ico.mapNameToChar('upload')
            expect(char).toBe('')

            char = ico.mapNameToChar('upload-cloud')
            expect(char).toBe('')

            char = ico.mapNameToChar('user')
            expect(char).toBe('')

            char = ico.mapNameToChar('user-check')
            expect(char).toBe('')

            char = ico.mapNameToChar('user-minus')
            expect(char).toBe('')

            char = ico.mapNameToChar('user-plus')
            expect(char).toBe('')

            char = ico.mapNameToChar('users')
            expect(char).toBe('')

            char = ico.mapNameToChar('user-x')
            expect(char).toBe('')

            char = ico.mapNameToChar('video')
            expect(char).toBe('')

            char = ico.mapNameToChar('video-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('voicemail')
            expect(char).toBe('')

            char = ico.mapNameToChar('volume')
            expect(char).toBe('')

            char = ico.mapNameToChar('volume-1')
            expect(char).toBe('')

            char = ico.mapNameToChar('volume-2')
            expect(char).toBe('')

            char = ico.mapNameToChar('volume-x')
            expect(char).toBe('')

            char = ico.mapNameToChar('watch')
            expect(char).toBe('')

            char = ico.mapNameToChar('wifi')
            expect(char).toBe('')

            char = ico.mapNameToChar('wifi-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('wind')
            expect(char).toBe('')

            char = ico.mapNameToChar('x')
            expect(char).toBe('')

            char = ico.mapNameToChar('x-circle')
            expect(char).toBe('')

            char = ico.mapNameToChar('x-octagon')
            expect(char).toBe('')

            char = ico.mapNameToChar('x-square')
            expect(char).toBe('')

            char = ico.mapNameToChar('youtube')
            expect(char).toBe('')

            char = ico.mapNameToChar('zap')
            expect(char).toBe('')

            char = ico.mapNameToChar('zap-off')
            expect(char).toBe('')

            char = ico.mapNameToChar('zoom-in')
            expect(char).toBe('')

            char = ico.mapNameToChar('zoom-out')
            expect(char).toBe('')
        })
    })
})
