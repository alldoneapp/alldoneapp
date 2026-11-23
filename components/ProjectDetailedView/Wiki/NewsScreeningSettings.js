import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import Switch from '../../UIControls/Switch'
import { translate } from '../../../i18n/TranslationService'
import { formatWikiDate } from '../../WikiView/useKnowledgeBase'
import {
    MAX_NEWS_TOPICS,
    NEWS_DISABLED_REASONS,
    NEWS_TOPIC_MAX_CHARS,
    WEB_SEARCH_GOLD,
} from '../../../functions/KnowledgeBase/knowledgeNewsModel'

const LANGUAGE_LABELS = { de: 'German', en: 'English', es: 'Spanish' }

const DISABLED_REASON_LABELS = {
    not_relevant: 'News screening reason not relevant',
    too_expensive: 'News screening reason too expensive',
    too_many: 'News screening reason too many',
    other: 'News screening reason other',
}

function languageLabel(code) {
    return LANGUAGE_LABELS[code] ? translate(LANGUAGE_LABELS[code]) : String(code || '').toUpperCase()
}

// The daily news screening (AT-3126): one switch, the topics it searches for (derived from the
// project description, optionally the member's own), and its state. A step of the wiki run, so it
// needs the wiki on and is changed by whoever may change the wiki (it is billed to the wiki's payer,
// within the wiki's monthly Gold limit).
export default function NewsScreeningSettings({ settings, wikiEnabled, disabled, onSave }) {
    const news = settings || {}
    const enabled = news.enabled !== false
    const [editing, setEditing] = useState(false)
    const [topicsText, setTopicsText] = useState('')

    useEffect(() => {
        if (!editing) setTopicsText((news.topics || []).join('\n'))
    }, [editing, (news.topics || []).join('\n')])

    const typedTopics = topicsText
        .split('\n')
        .map(topic => topic.trim())
        .filter(Boolean)
    const topicsValid =
        typedTopics.length > 0 &&
        typedTopics.length <= MAX_NEWS_TOPICS &&
        typedTopics.every(topic => topic.length <= NEWS_TOPIC_MAX_CHARS)

    const saveTopics = async topics => {
        if (await onSave({ newsScreeningTopics: topics })) setEditing(false)
    }

    const statusParts = []
    if (news.lastRunAt)
        statusParts.push(translate('News screening last checked', { date: formatWikiDate(news.lastRunAt) }))
    if (news.lastPublishedAt) {
        statusParts.push(translate('News screening last new entries', { date: formatWikiDate(news.lastPublishedAt) }))
    }

    return (
        <View testID="news-screening-settings" style={localStyles.block}>
            <View style={localStyles.row}>
                <Icon name="globe" size={24} color={colors.Text03} />
                <Text style={localStyles.label}>{translate('Daily news screening')}</Text>
                <View style={localStyles.right}>
                    <Switch
                        active={wikiEnabled && enabled}
                        disabled={disabled || !wikiEnabled}
                        activeSwitch={() => onSave({ newsScreeningEnabled: true })}
                        deactiveSwitch={() => onSave({ newsScreeningEnabled: false })}
                    />
                </View>
            </View>
            <Text style={localStyles.hint}>{translate('News screening hint', { gold: WEB_SEARCH_GOLD })}</Text>
            {!wikiEnabled && (
                <Text testID="news-screening-needs-wiki" style={localStyles.hint}>
                    {translate('News screening needs the wiki')}
                </Text>
            )}

            {wikiEnabled && enabled && (
                <View testID="news-screening-details">
                    <Text style={localStyles.hint}>
                        {translate(
                            news.topicsSource === 'member'
                                ? 'News screening searches for your topics'
                                : 'News screening searches for'
                        )}
                    </Text>
                    {news.topics?.length > 0 && !editing ? (
                        <View testID="news-screening-topics" style={localStyles.chips}>
                            {news.topics.map(topic => (
                                <View key={topic} style={localStyles.chip}>
                                    <Text style={localStyles.chipText}>{topic}</Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        !editing && <Text style={localStyles.hint}>{translate('News screening no topics yet')}</Text>
                    )}
                    {editing && (
                        <TextInput
                            testID="news-screening-topics-input"
                            style={localStyles.topicsInput}
                            value={topicsText}
                            onChangeText={setTopicsText}
                            multiline
                            placeholder={translate('News topics placeholder', { amount: MAX_NEWS_TOPICS })}
                            placeholderTextColor={colors.Text03}
                            accessible={false}
                        />
                    )}
                    {!disabled && (
                        <View style={localStyles.actions}>
                            {editing ? (
                                <>
                                    <Button
                                        type={'ghost'}
                                        title={translate('Cancel')}
                                        onPress={() => setEditing(false)}
                                    />
                                    <Button
                                        type={'ghost'}
                                        title={translate('Save topics')}
                                        disabled={!topicsValid}
                                        onPress={() => saveTopics(typedTopics)}
                                        buttonStyle={localStyles.secondAction}
                                    />
                                </>
                            ) : (
                                <>
                                    {news.topicsSource === 'member' && (
                                        <Button
                                            type={'ghost'}
                                            title={translate('Use automatic topics')}
                                            onPress={() => saveTopics(null)}
                                        />
                                    )}
                                    <Button
                                        type={'ghost'}
                                        icon={'edit-2'}
                                        title={translate('Edit search topics')}
                                        onPress={() => setEditing(true)}
                                        buttonStyle={localStyles.secondAction}
                                    />
                                </>
                            )}
                        </View>
                    )}
                    {news.descriptionChangedSinceTopicsEdit && (
                        <Text testID="news-screening-description-changed" style={localStyles.hint}>
                            {translate('News screening description changed')}
                        </Text>
                    )}
                    {news.languages?.length > 0 && (
                        <Text style={localStyles.hint}>
                            {translate('News screening languages', {
                                languages: news.languages.map(languageLabel).join(', '),
                            })}
                        </Text>
                    )}
                    <Text style={localStyles.hint}>{translate('News screening privacy')}</Text>
                    {statusParts.length > 0 && (
                        <Text testID="news-screening-status" style={localStyles.hint}>
                            {statusParts.join(' · ')}
                        </Text>
                    )}
                    {news.lastSkipReason === 'no_description' && (
                        <Text style={localStyles.hint}>{translate('News screening needs a description')}</Text>
                    )}
                    {news.quietForDays > 0 && (
                        <Text testID="news-screening-quiet" style={localStyles.hint}>
                            {translate('News screening quiet', { days: news.quietForDays })}
                        </Text>
                    )}
                </View>
            )}

            {(!enabled || !wikiEnabled) && Number.isFinite(news.pausedSince) && news.lastRunAt && (
                <Text testID="news-screening-paused" style={localStyles.hint}>
                    {news.hiddenFromAssistants
                        ? translate('News screening paused and hidden', { date: formatWikiDate(news.pausedSince) })
                        : translate('News screening paused', {
                              date: formatWikiDate(news.pausedSince),
                              cutoff: formatWikiDate(news.assistantCutoffAt),
                          })}
                </Text>
            )}
            {wikiEnabled && !enabled && !disabled && !news.disabledReason && (
                <View testID="news-screening-reasons">
                    <Text style={localStyles.hint}>{translate('News screening why off')}</Text>
                    <View style={localStyles.reasonRow}>
                        {NEWS_DISABLED_REASONS.map(reason => (
                            <Button
                                key={reason}
                                type={'ghost'}
                                title={translate(DISABLED_REASON_LABELS[reason])}
                                onPress={() => onSave({ newsScreeningDisabledReason: reason })}
                                buttonStyle={localStyles.reasonButton}
                            />
                        ))}
                    </View>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    block: {
        marginTop: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingLeft: 8,
    },
    label: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 8,
    },
    right: {
        marginLeft: 'auto',
    },
    hint: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
        marginTop: 4,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginLeft: 8,
        marginTop: 6,
    },
    chip: {
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 2,
        marginRight: 6,
        marginBottom: 6,
    },
    chipText: {
        ...styles.caption1,
        color: colors.Text02,
    },
    topicsInput: {
        ...styles.body1,
        minHeight: 96,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        padding: 8,
        marginTop: 6,
        color: colors.Text01,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 4,
        flexWrap: 'wrap',
    },
    secondAction: {
        marginLeft: 8,
    },
    reasonRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingLeft: 8,
        marginTop: 4,
    },
    reasonButton: {
        marginRight: 8,
        marginBottom: 4,
    },
})
