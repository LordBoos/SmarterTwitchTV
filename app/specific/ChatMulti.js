/* global ChatKick_Start: false, ChatKick_Stop: false, ChatYouTube_Start: false, ChatYouTube_Stop: false -- defined in ChatKick.js / ChatYouTube.js (added later), remove the matching names then */
/*
 * Merged chat core: starts and stops the YouTube / Kick sources of a chat and renders their lines
 * through the Twitch line pipeline (delay, pause, spam merge, cleanup, moderation).
 * Everything that comes from YouTube / Kick is untrusted: names are escaped, text goes through
 * ChatLive_extraMessageTokenize, colors, ids and image urls are whitelisted.
 */

//Variable initialization
var ChatMulti_State = []; // per chat_number {id (Chat_Id), seq, withHistory, started} of the running session
var ChatMulti_Seq = 0; // session counter, a new value on every Start / Restart
var ChatMulti_Seen = []; // per chat_number {count, ids}, dedupes a message present in history and live
var ChatMulti_SeenMax = 500;
var ChatMulti_RoleColors = {owner: '#ffd600', mod: '#5e84f1', member: '#2ba640'}; // YouTube has role colors only
var ChatMulti_ColorRegex = /^#[0-9a-f]{6}$/i;
var ChatMulti_BackgroundRegex = /^(#[0-9a-f]{6}|rgba?\([\d., ]+\))$/i;
// No quotes, parentheses, spaces, '&' or '\': the url ends up in attributes, inline onerror js and css url()
var ChatMulti_UrlRegex = /^https:\/\/([a-z0-9.-]+)\/[\w.~\/%=+,:-]*$/i;
//Variable initialization end

function ChatMulti_Start(chat_number, id, withHistory) {
    ChatMulti_Stop(chat_number);
    if (!id || !Settings_value.chat_multi.defaultValue) return;

    ChatMulti_State[chat_number] = {id: id, seq: ++ChatMulti_Seq, withHistory: withHistory, started: false};
    ChatLink_Lookup(chat_number, id);
}

// Contract for ChatKick.js / ChatYouTube.js: their Start gets the session seq as its id, passes it as the
// FullxmlHttpGet checkResult and checks ChatMulti_IsActive before rendering, reconnecting or rescheduling.
// Turning the setting off and ChatMulti_Restart end a session without changing Chat_Id, so a Chat_Id check
// alone would let in-flight requests through.
function ChatMulti_IsActive(chat_number, seq) {
    var state = ChatMulti_State[chat_number];
    return !!state && state.seq === seq && state.id === Chat_Id[chat_number];
}

// Only ChatLive_Clear stops the sources, a Twitch IRC reconnect (ChatLive_Close) keeps them
function ChatMulti_Stop(chat_number) {
    ChatMulti_State[chat_number] = null;
    ChatMulti_Seen[chat_number] = null;
    ChatMulti_SetLinked(chat_number, false);

    if (typeof ChatKick_Stop === 'function') ChatKick_Stop(chat_number);
    if (typeof ChatYouTube_Stop === 'function') ChatYouTube_Stop(chat_number);
}

// After the links of the current streamer changed, history is not loaded again
function ChatMulti_Restart(chat_number) {
    ChatMulti_Start(chat_number, Chat_Id[chat_number], false);
}

function ChatMulti_OnLinks(chat_number, id) {
    var state = ChatMulti_State[chat_number];
    if (!state || state.id !== id || id !== Chat_Id[chat_number] || state.started) return;
    state.started = true;

    var links = ChatLink_Current(chat_number);
    ChatMulti_SetLinked(chat_number, !!(links.yt || links.kick));

    if (links.kick && typeof ChatKick_Start === 'function') ChatKick_Start(chat_number, state.seq, links.kick.value, state.withHistory);
    if (links.yt && typeof ChatYouTube_Start === 'function') ChatYouTube_Start(chat_number, state.seq, links.yt.value, state.withHistory);
}

// The Twitch icon of every line is only visible inside a linked chat (css .chat_linked .chat_pi_tw)
function ChatMulti_SetLinked(chat_number, linked) {
    if (linked) Main_AddClassWithEle(Chat_div[chat_number], 'chat_linked');
    else Main_RemoveClassWithEle(Chat_div[chat_number], 'chat_linked');
}

function ChatMulti_Icon(platform) {
    return '<span class="tag chat_pi chat_pi_' + platform + '"></span>';
}

function ChatMulti_SafeId(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[^\w-]/g, '');
}

function ChatMulti_SafeUrl(url, hostRegex) {
    var match = typeof url === 'string' ? url.match(ChatMulti_UrlRegex) : null;
    return match && hostRegex.test(match[1].toLowerCase()) ? url : null;
}

// role: 'owner' | 'mod' | 'member' | ''
function ChatMulti_NickStyle(platform, nick, color, role) {
    var value;

    if (!ChatLive_Custom_Nick_Color) {
        if (platform === 'yt') value = ChatMulti_RoleColors[role];
        else if (ChatMulti_ColorRegex.test(color)) value = color;
    }

    if (!value) value = defaultColors[(String(nick).charCodeAt(0) || 0) % defaultColorsLength];

    return 'style="color: ' + value + ';"';
}

// seq: the session seq the source got in its Start (see ChatMulti_IsActive)
// msg = {platform, msgId, authorId, nick, color, role, badges (html), tokens (strings and [html]), text, ts (ms),
//        history (bool), special (html header or null), highlight (css background color or null)}
// nick, color, ids, highlight and string tokens are sanitized here; badges, special and [html] tokens
// must be built by the source from escaped text and ChatMulti_SafeUrl urls only

function ChatMulti_Line(chat_number, seq, msg) {
    if (!ChatMulti_IsActive(chat_number, seq)) return;

    var platform = msg.platform,
        msgId = ChatMulti_SafeId(msg.msgId),
        seen = ChatMulti_Seen[chat_number],
        key;

    if (msgId) {
        if (!seen || seen.count >= ChatMulti_SeenMax) seen = ChatMulti_Seen[chat_number] = {count: 0, ids: {}};

        key = platform + '_' + msg.msgId;
        if (seen.ids[key]) return;
        seen.ids[key] = true;
        seen.count++;
    }

    var nick = String(msg.nick || ''),
        special = msg.special,
        text = String(msg.text || ''),
        role = msg.role,
        atstreamer = false,
        fromstreamer = false,
        mod = false;

    if ((ChatLive_HideBots && KnowBots.hasOwnProperty(nick)) || (special && !ChatLive_Show_SUB)) return;

    if (ChatLive_Highlight_AtStreamer && ChatLive_Channel_Regex_Search[chat_number].test(text)) atstreamer = true;
    else if (ChatLive_Highlight_FromStreamer && role === 'owner') fromstreamer = true;
    else if (ChatLive_Highlight_Mod && role === 'mod') mod = true;

    var nickHtml =
            '<span ' +
            (atstreamer || fromstreamer || mod ? chat_Line_highlight_green : ChatMulti_NickStyle(platform, nick, msg.color, role)) +
            '>' +
            Screens_AriaEscape(nick) +
            '</span>',
        background = msg.highlight && ChatMulti_BackgroundRegex.test(msg.highlight) ? ' style="background-color: ' + msg.highlight + ';"' : '',
        body = msg.tokens && msg.tokens.length ? ChatLive_extraMessageTokenize(msg.tokens, chat_number, 0) : '',
        badges = msg.badges || '',
        message;

    if (special) {
        message =
            '<span class="message"' +
            background +
            '>' +
            ChatMulti_Icon(platform) +
            special +
            (body ? STR_BR + STR_BR + badges + nickHtml + ': ' + body : '') +
            '</span>';
    } else {
        message =
            (ChatLive_Show_TimeStamp ? (msg.history && msg.ts ? ChatLive_GetTimeStamp(msg.ts) : Main_clock_H_M) + ' ' : '') +
            ChatMulti_Icon(platform) +
            badges +
            nickHtml +
            ':&nbsp;' +
            '<span ' +
            (msgId ? 'id="' + platform + '_' + msgId + '" ' : '') +
            'class="' +
            platform +
            '_' +
            ChatMulti_SafeId(msg.authorId) +
            ' message"' +
            background +
            '>' +
            body +
            '</span>';
    }

    ChatLive_LineAddCheckDelay(chat_number, {
        chat_number: chat_number,
        message: message,
        nick: nick.toLowerCase(),
        text: special ? undefined : text, // a Super Chat / sub line never merges as spam
        atstreamer: atstreamer,
        fromstreamer: fromstreamer,
        mod: mod,
        sub: !!special,
        addToStart: !!msg.history,
        historyTs: (msg.history && msg.ts) || 0
    });
}

function ChatMulti_DeleteMsg(platform, msgId) {
    var safe = ChatMulti_SafeId(msgId);
    if (safe) ChatLive_CleanMessage({tags: {'target-msg-id': platform + '_' + safe}});
}

function ChatMulti_DeleteAuthor(chat_number, platform, authorId) {
    var safe = ChatMulti_SafeId(authorId);
    if (safe) ChatLive_CleanUser(chat_number, {tags: {'target-user-id': platform + '_' + safe}});
}
