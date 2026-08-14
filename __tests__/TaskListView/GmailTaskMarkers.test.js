import React from 'react'
import renderer from 'react-test-renderer'

import GmailTag from '../../components/Tags/GmailTag'
import TitleContainer from '../../components/TaskListView/TaskItem/TaskPresentation/TitleContainer/TitleContainer'
import { getGmailTaskWebUrl, isGmailLabelFollowUpTask, isInboxSummaryGmailTask } from '../../utils/Gmail/gmailTaskUtils'

jest.mock('../../components/UIControls/SocialText/SocialText', () => 'SocialText')
jest.mock('../../components/Icon', () => 'Icon')

// leftCustomElement is always a fragment now - it also carries the leading
// priority chip - so its mere presence says nothing. What matters is whether a
// GmailTag sits inside it.
const containsGmailTag = element =>
    React.Children.toArray(element?.props?.children ?? []).some(child => child?.type === GmailTag)

describe('Gmail task markers', () => {
    const baseTask = {
        id: 'task-1',
        name: 'Reply to supplier',
        extendedName: 'Reply to supplier',
        isSubtask: false,
        done: false,
    }

    test('renders a Gmail marker for Gmail follow-up tasks', () => {
        const tree = renderer.create(
            <TitleContainer
                task={{
                    ...baseTask,
                    gmailData: {
                        origin: 'gmail_label_follow_up',
                        messageId: 'msg-1',
                    },
                }}
                projectId="project-1"
                isObservedTask={false}
                toggleModal={() => {}}
                backColorHighlight="#fff"
                backColor="#fff"
                hasStar={false}
                inMyDayAndNotSubtask={false}
                blockOpen={false}
                tagsExpandedHeight={0}
                showVerticalEllipsisInByTime={false}
            />
        )

        const socialText = tree.root.findByType('SocialText')
        expect(containsGmailTag(socialText.props.leftCustomElement)).toBe(true)
    })

    test('does not render a Gmail marker for inbox summary email tasks', () => {
        const tree = renderer.create(
            <TitleContainer
                task={{
                    ...baseTask,
                    gmailData: {
                        email: 'person@example.com',
                        unreadMails: 4,
                    },
                }}
                projectId="project-1"
                isObservedTask={false}
                toggleModal={() => {}}
                backColorHighlight="#fff"
                backColor="#fff"
                hasStar={false}
                inMyDayAndNotSubtask={false}
                blockOpen={false}
                tagsExpandedHeight={0}
                showVerticalEllipsisInByTime={false}
            />
        )

        const socialText = tree.root.findByType('SocialText')
        expect(containsGmailTag(socialText.props.leftCustomElement)).toBe(false)
    })

    test('keeps Gmail follow-up tasks in the normal task list bucket', () => {
        expect(
            isGmailLabelFollowUpTask({
                ...baseTask,
                gmailData: {
                    origin: 'gmail_label_follow_up',
                    messageId: 'msg-1',
                },
            })
        ).toBe(true)
    })

    test('keeps inbox summary email tasks in the email bucket', () => {
        expect(
            isInboxSummaryGmailTask({
                ...baseTask,
                gmailData: {
                    email: 'person@example.com',
                    unreadMails: 4,
                },
            })
        ).toBe(true)
    })

    test('builds follow-up Gmail URLs with authuser and all mailbox', () => {
        expect(
            getGmailTaskWebUrl({
                origin: 'gmail_label_follow_up',
                gmailEmail: 'person@example.com',
                messageId: 'msg-1',
            })
        ).toBe(
            'https://accounts.google.com/AccountChooser?Email=person%40example.com&continue=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F%3Fauthuser%3Dperson%2540example.com%23all%2Fmsg-1&service=mail'
        )
    })
})
