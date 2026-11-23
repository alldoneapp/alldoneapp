'use strict'

// What one web search costs in Gold (AT-3126, Karsten 2026-11-23: "at cost", and the assistants'
// normal web_search costs Gold too). A Tavily search costs roughly 0.5-0.8 US cents; one Gold is
// about 0.00035 USD of upstream cost (Growth/growthCostModel.js), so 20 Gold covers one search.
// Charged per EXECUTED search: a refused or failed search costs nothing (as browserGold.js).
//
// Dependency-free: the wiki settings in the browser show the price too.

const WEB_SEARCH_GOLD = 20
// Ledger source of an assistant's web_search (the news screening bills its searches under
// `wiki_news_screening`, counted in the wiki's monthly cap).
const WEB_SEARCH_GOLD_SOURCE = 'web_search'

module.exports = { WEB_SEARCH_GOLD, WEB_SEARCH_GOLD_SOURCE }
