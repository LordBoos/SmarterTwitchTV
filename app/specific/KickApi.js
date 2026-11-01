/* Kick as a second platform: unofficial kick.com API helpers and converters from Kick responses to the app's card rows.
 * Rows keep the Twitch positions and carry 'kick' in [19]. Every Kick text is escaped and every url is checked here,
 * the card builders can insert row values as they do for Twitch. */

var KickApi_Base = 'https://kick.com/api/';
var KickApi_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var KickApi_ImgHosts = /^(images\.kick\.com|files\.kick\.com|clips\.kick\.com|stream\.kick\.com)$/;
var KickApi_ClipHost = /^clips\.kick\.com$/;
var KickApi_SlugRegex = /^[\w-]{1,40}$/;
var KickApi_IsoRegex = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)?$/;
var KickApi_IdRegex = /^[\w-]+$/;
//Fresh live rows by slug, filled by the playlist info step (PlayHLS_KickInfo)
var KickApi_LiveCache = {};

// The Kick token goes only to kick.com hosts, callers must never use these headers for another host
function KickApi_Headers(token) {
    var headers = [
        ['User-Agent', KickApi_UA],
        ['Accept', 'application/json']
    ];

    if (token) headers.push(['Authorization', 'Bearer ' + token]);

    return headers;
}

function KickApi_Id(slug) {
    return 'kick:' + String(slug).toLowerCase();
}

function KickApi_IsKickId(id) {
    return /^kick:/.test(String(id));
}

function KickApi_Slug(id) {
    return String(id).slice(5);
}

function KickApi_IsKickRow(data) {
    return !!data && data[19] === 'kick';
}

function KickApi_SafeSlug(slug) {
    return typeof slug === 'string' && KickApi_SlugRegex.test(slug) ? slug : '';
}

// Row id [7] from an untrusted Kick id (livestream id, video uuid, clip id), null when unsafe: the builder then drops the row
function KickApi_RowId(id) {
    return id !== null && id !== undefined && KickApi_IdRegex.test(String(id)) ? 'kick:' + id : null;
}

// '2026-10-31 22:33:21' (UTC without zone) -> '2026-10-31T22:33:21Z', unusable input -> ''
function KickApi_Iso(str) {
    if (typeof str !== 'string' || !KickApi_IsoRegex.test(str)) return '';

    str = str.replace(' ', 'T');
    if (!/(Z|[+-]\d\d:?\d\d)$/.test(str)) str += 'Z';

    return isNaN(new Date(str).getTime()) ? '' : str;
}

function KickApi_Img(url) {
    if (typeof url !== 'string') return '';

    return ChatMulti_SafeUrl(url.split('?')[0], KickApi_ImgHosts) || '';
}

//Kick sends the full language name ('English') where Twitch sends the iso code, unknown names give no tag
var KickApi_LangNames = {
    arabic: 'ar',
    chinese: 'zh',
    czech: 'cs',
    danish: 'da',
    dutch: 'nl',
    english: 'en',
    finnish: 'fi',
    french: 'fr',
    german: 'de',
    greek: 'el',
    hindi: 'hi',
    hungarian: 'hu',
    indonesian: 'id',
    italian: 'it',
    japanese: 'ja',
    korean: 'ko',
    norwegian: 'no',
    polish: 'pl',
    portuguese: 'pt',
    romanian: 'ro',
    russian: 'ru',
    spanish: 'es',
    swedish: 'sv',
    thai: 'th',
    turkish: 'tr',
    ukrainian: 'uk',
    vietnamese: 'vi'
};

function KickApi_Lang(value) {
    if (typeof value !== 'string') return '';
    if (/^[a-z]{2}$/i.test(value)) return value.toLowerCase();

    value = value.toLowerCase();
    return Object.prototype.hasOwnProperty.call(KickApi_LangNames, value) ? KickApi_LangNames[value] : '';
}

function KickApi_LangTag(lang) {
    return lang ? '[' + lang.toUpperCase() + ']' : '';
}

function KickApi_Num(value) {
    value = Number(value);
    return isNaN(value) ? 0 : value;
}

function KickApi_Cat(item) {
    var cat = item.categories && item.categories[0] ? item.categories[0] : item.category;

    return Screens_AriaEscape(cat && cat.name ? cat.name : '');
}

// Row builders return null when the Kick id is unsafe, callers skip null rows (KickApi_Item(null) is null too)
// ls: livestream of v1/user/livestreams, mobile.kick.com/api/v1/livestreams or v2/channels.livestream, ch: optional {slug, username, avatar}
function KickApi_LiveCell(ls, ch) {
    var id = KickApi_RowId(ls.id);
    if (!id) return null;

    var channel = ls.channel || {},
        user = channel.user || {},
        slug = KickApi_SafeSlug(ch ? ch.slug : channel.slug),
        name = ch ? ch.username : user.username || channel.username,
        avatar = ch ? ch.avatar : user.profilepic || channel.profile_pic || channel.profile_picture,
        iso = KickApi_Iso(ls.start_time || ls.created_at),
        lang = KickApi_Lang(ls.lang_iso || ls.language),
        viewers = KickApi_Num(ls.viewer_count);

    return [
        KickApi_Img(ls.thumbnail && (ls.thumbnail.src || ls.thumbnail.url)), //0
        Screens_AriaEscape(name || slug), //1
        Screens_AriaEscape(ls.session_title || ls.title), //2
        KickApi_Cat(ls), //3
        Main_formatNumber(viewers), //4
        KickApi_LangTag(lang), //5
        slug, //6
        id, //7
        false, //8
        KickApi_Img(avatar), //9
        false, //10
        iso ? Play_streamLiveAt(iso) : '', //11
        iso, //12
        viewers, //13
        KickApi_Id(slug), //14
        lang, //15
        null, //16
        null, //17
        null, //18
        'kick' //19
    ];
}

// json of v2/channels/<slug>, null when the channel is offline
function KickApi_ChannelLiveCell(json) {
    if (!json || !json.livestream) return null;

    var user = json.user || {};

    return KickApi_LiveCell(json.livestream, {slug: json.slug, username: user.username, avatar: user.profile_pic || user.profilepic});
}

// v: item of v2/channels/<slug>/videos, ch: {slug, name}
function KickApi_VodCell(v, ch) {
    var id = KickApi_RowId(v.video ? v.video.uuid : v.id);
    if (!id) return null;

    var slug = KickApi_SafeSlug(ch.slug),
        iso = KickApi_Iso(v.start_time || v.created_at),
        lang = KickApi_Lang(v.lang_iso || v.language),
        views = KickApi_Num(v.views),
        duration = Math.round(KickApi_Num(v.duration) / 1000);

    return [
        KickApi_Img(v.thumbnail && v.thumbnail.src), //0
        Screens_AriaEscape(ch.name || slug), //1
        iso ? Main_videoCreatedAt(iso) : '', //2
        KickApi_Cat(v), //3
        Main_formatNumber(views), //4
        KickApi_LangTag(lang), //5
        slug, //6
        id, //7
        null, //8
        lang, //9
        twemoji.parse(Screens_AriaEscape(v.session_title)), //10
        duration, //11
        iso, //12
        views, //13
        KickApi_Id(slug), //14
        duration, //15
        null, //16
        null, //17
        null, //18
        'kick' //19
    ];
}

function KickApi_ClipCell(c) {
    var id = KickApi_RowId(c.id);
    if (!id) return null;

    var channel = c.channel || {},
        slug = KickApi_SafeSlug(channel.slug),
        iso = KickApi_Iso(c.created_at),
        views = KickApi_Num(c.view_count || c.views);

    return [
        ChatMulti_SafeUrl(c.clip_url, KickApi_ClipHost) || '', //0
        KickApi_Num(c.duration), //1
        KickApi_Id(slug), //2
        c.category && c.category.name ? Screens_AriaEscape(c.category.name) : '', //3
        Screens_AriaEscape(channel.username || slug), //4
        KickApi_Img(channel.profile_picture), //5
        slug, //6
        id, //7
        null, //8
        null, //9
        twemoji.parse(Screens_AriaEscape(c.title)), //10
        '', //11
        iso, //12
        views, //13
        Main_formatNumber(views), //14
        KickApi_Img(c.thumbnail_url), //15
        iso ? Main_videoCreatedAt(iso) : '', //16
        '', //17
        null, //18
        'kick' //19
    ];
}

// f: item of v2/channels/followed
function KickApi_ChannelCell(f) {
    var slug = KickApi_SafeSlug(f.channel_slug),
        cell = [slug, KickApi_Id(slug), KickApi_Img(f.profile_picture), Screens_AriaEscape(f.user_username || slug), false, null];

    cell[19] = 'kick';
    return cell;
}

// Wrapper for ScreenObj.data: Kick has no Twitch ids, the row is rebuilt from kickCell
function KickApi_Item(cell, id, channelId, isMature) {
    if (!cell) return null;

    return {kickCell: cell, id: id, user_id: channelId, broadcaster_id: channelId, game_id: null, is_mature: !!isMature};
}

//Twitch cards get the Twitch icon only while the main user has a working Kick account (Twitch only users see no change)
function KickApi_CardIcon(data) {
    if (KickApi_IsKickRow(data)) return '<span class="tag chat_pi_kick card_pi"></span>';

    return KickUser_Token() ? '<span class="tag chat_pi_tw card_pi"></span>' : '';
}

//Icon of a user card in Users: Kick only users the Kick icon, Twitch users the Twitch icon only with their own linked Kick account
function KickApi_UserIcon(user) {
    if (KickUser_IsKickOnly(user)) return '<span class="tag chat_pi_kick card_pi"></span>';

    return user && user.kick ? '<span class="tag chat_pi_tw card_pi"></span>' : '';
}

// Category row of Games, 'kick:' + slug in [3] is the game id of the app, the numeric id is kept in KickBrowse_CatIds
// because Kick filters livestreams by that id only
// cat: item of kick.com/api/v1/subcategories (or categories/top), null for an unsafe slug or id
function KickApi_GameCell(cat) {
    if (!cat || typeof cat !== 'object') return null;

    var slug = KickApi_SafeSlug(cat.slug);
    if (!slug || !/^\d{1,9}$/.test(String(cat.id))) return null;

    // subcategories have banner and viewers, the search has thumbnail and viewer_count
    var viewers = KickApi_Num(cat.viewers || cat.viewer_count),
        image = cat.banner || cat.thumbnail;
    KickBrowse_CatIds[slug.toLowerCase()] = Number(cat.id);

    return [
        KickApi_Img(image && (image.src || image.url)), //0
        Screens_AriaEscape(cat.name || slug), //1
        STR_FOR + STR_SPACE_HTML + Main_formatNumber(viewers) + STR_SPACE_HTML + Main_GetViewerStrings(viewers), //2
        KickApi_Id(slug) //3
    ];
}

// Browsing Kick (public endpoints, no token): the platform switch of Live and Games and the lists behind it
var KickBrowse_LiveBase = 'https://mobile.kick.com/api/v1/livestreams';
var KickBrowse_GamesBase = 'https://kick.com/api/v1/subcategories';
var KickBrowse_GamesLimit = 24;
var KickBrowse_CursorRegex = /^[\w-]{1,200}$/;
// slug -> numeric subcategory id, filled by KickApi_GameCell, 0 (rejected by Kick with 400) when unknown
var KickBrowse_CatIds = {};

function KickBrowse_On() {
    return Main_getItemBool('kick_browse', false);
}

function KickBrowse_SwitchLabel() {
    return STR_PLATFORM + ': ' + (KickBrowse_On() ? STR_KICK : STR_TWITCH);
}

// Saves the other platform and reloads the screen, Live, Games and the search results all follow the one switch
function KickBrowse_Toggle(key) {
    Main_setItem('kick_browse', !KickBrowse_On());

    var keys = [Main_Live, Main_games, Main_SearchLive, Main_SearchGames, Main_SearchChannels, Main_SearchVod],
        i = 0;

    for (i; i < keys.length; i++) {
        if (ScreenObj[keys[i]]) ScreenObj[keys[i]].status = false;
    }

    Screens_StartLoad(key);
}

function KickBrowse_CatId(slug) {
    slug = String(slug).toLowerCase();
    return Object.prototype.hasOwnProperty.call(KickBrowse_CatIds, slug) ? KickBrowse_CatIds[slug] : 0;
}

// Cache miss (app restarted inside a category, entry from Blocked): kick.com/api/v1/subcategories/<slug> gives the id, '' for an unsafe slug
function KickBrowse_CatUrl(slug) {
    slug = KickApi_SafeSlug(slug);
    return slug ? KickBrowse_GamesBase + '/' + slug : '';
}

// json of the single subcategory, true when its id was stored for the slug
function KickBrowse_CatResolve(json, slug) {
    if (!json || typeof json !== 'object' || !/^\d{1,9}$/.test(String(json.id)) || Number(json.id) <= 0 || !KickApi_SafeSlug(slug)) return false;

    KickBrowse_CatIds[String(slug).toLowerCase()] = Number(json.id);
    return true;
}

// Kick search: one page of 20 (the API refuses more for the enriched search), Search_data goes through encodeURIComponent
var KickSearch_Base = 'https://search.kick.com/api/v1/';
var KickSearch_Limit = 20;

// kind: 'channels' and 'live' share the enriched search, 'categories' has its own endpoint
function KickSearch_Url(kind, term) {
    return (
        KickSearch_Base +
        (kind === 'categories' ? 'categories/search' : 'search/enriched') +
        '?query=' +
        encodeURIComponent(term === null || term === undefined ? '' : term) +
        '&limit=' +
        KickSearch_Limit
    );
}

function KickSearch_List(json, name) {
    var list = json && json.data ? json.data[name] : null;

    return Array.isArray(list) ? list : [];
}

// json of the enriched search -> channel items, a live channel carries the live mark in [5], unsafe rows are skipped
function KickSearch_Channels(json) {
    var list = KickSearch_List(json, 'channels'),
        items = [],
        i = 0,
        cell;

    for (i; i < list.length; i++) {
        if (!list[i] || typeof list[i] !== 'object') continue;

        cell = KickApi_ChannelCell({channel_slug: list[i].slug, user_username: list[i].username, profile_picture: list[i].profile_picture});
        if (!cell[0]) continue;

        cell[5] = list[i].is_live === true ? true : null;
        items.push({kickCell: cell, id: cell[1]});
    }

    return items;
}

// json of the enriched search -> its livestreams as live items (Kick has a real live search)
function KickSearch_Live(json) {
    return KickBrowse_Items({data: {livestreams: KickSearch_List(json, 'livestreams')}}).data;
}

// json of categories/search (or the enriched search) -> category items, the numeric ids are cached by KickApi_GameCell
function KickSearch_Categories(json) {
    var list = json && Array.isArray(json.data) ? json.data : KickSearch_List(json, 'categories'),
        items = [],
        i = 0,
        cell;

    for (i; i < list.length; i++) {
        cell = KickApi_GameCell(list[i]);
        if (cell) items.push({kickCell: cell, id: cell[3]});
    }

    return items;
}

// lang: Twitch content language ('' for all), cursor: the next_cursor of the previous page, catId: numeric subcategory id or 0
// Kick wants the sort whenever a category is given, so it is always sent
function KickBrowse_LiveUrl(limit, lang, cursor, catId) {
    var iso = KickApi_Lang(lang);

    return (
        KickBrowse_LiveBase +
        '?limit=' +
        Number(limit) +
        '&sort=viewer_count_desc' +
        (/^\d{1,9}$/.test(String(catId)) && Number(catId) ? '&category_id=' + catId : '') +
        (iso ? '&language=' + iso : '') +
        (typeof cursor === 'string' && KickBrowse_CursorRegex.test(cursor) ? '&after=' + cursor : '')
    );
}

function KickBrowse_GamesUrl(cursor) {
    return KickBrowse_GamesBase + '?limit=' + KickBrowse_GamesLimit + '&page=' + (/^\d{1,5}$/.test(String(cursor)) ? cursor : 1);
}

// json of mobile.kick.com/api/v1/livestreams -> {data: items, pagination: {cursor}}, rows with an unsafe id or slug are skipped
function KickBrowse_Items(json) {
    var list = json && json.data && Array.isArray(json.data.livestreams) ? json.data.livestreams : [],
        next = json && json.data && json.data.pagination ? json.data.pagination.next_cursor : '',
        items = [],
        i = 0,
        cell;

    for (i; i < list.length; i++) {
        cell = list[i] && typeof list[i] === 'object' ? KickApi_LiveCell(list[i]) : null;
        if (!cell || !cell[6]) continue;

        items.push(KickApi_Item(cell, cell[7], cell[14], list[i].is_mature));
        items[items.length - 1].viewer_count = cell[13];
    }

    return {data: items, pagination: {cursor: typeof next === 'string' && KickBrowse_CursorRegex.test(next) ? next : ''}};
}

// json of kick.com/api/v1/subcategories (paged by number) -> {data: items, pagination: {cursor: next page}}
function KickBrowse_Games(json) {
    var list = json && Array.isArray(json.data) ? json.data : [],
        items = [],
        i = 0,
        cell;

    for (i; i < list.length; i++) {
        cell = KickApi_GameCell(list[i]);
        if (cell) items.push({kickCell: cell, id: cell[3]});
    }

    var page = json ? Number(json.current_page) : 0,
        last = json ? Number(json.last_page) : 0;

    return {data: items, pagination: {cursor: page > 0 && page < last ? String(page + 1) : ''}};
}

//Opens a live Kick channel by slug (debug entry from CDP for now), offline shows a warning
var KickApi_OpenLiveSeq = 0;
var KickApi_OpenLiveSlug = '';
function KickApi_OpenLive(slug) {
    slug = KickApi_SafeSlug(slug);
    if (!slug) return;

    KickApi_OpenLiveSlug = slug;
    FullxmlHttpGet(KickApi_Base + 'v2/channels/' + slug, KickApi_Headers(''), KickApi_OpenLiveResult, noop_fun, 0, ++KickApi_OpenLiveSeq, null, null);
}

function KickApi_OpenLiveResult(obj, key, seq) {
    if (seq !== KickApi_OpenLiveSeq) return;

    var cell = null;

    try {
        if (obj.status === 200) cell = KickApi_ChannelLiveCell(JSON.parse(obj.responseText));
    } catch (e) {}

    if (!cell) {
        Main_showWarningDialog(KickApi_OpenLiveSlug + ' ' + STR_LIVE + STR_IS_OFFLINE, 3000);
        return;
    }

    //Same as the live branch of Main_onNewIntent
    if (Main_isScene2DocVisible()) Main_onNewIntentClearPlay();
    else if (ScreenObj[Main_values.Main_Go].exit_fun) ScreenObj[Main_values.Main_Go].exit_fun();

    Play_data = JSON.parse(JSON.stringify(Play_data_base));
    Play_data.data = cell;
    Main_values_Play_data = cell;
    Main_openStream();
}
