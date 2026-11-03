/*
 * Merged chat core: starts and stops the YouTube / Kick sources of a chat and renders their lines
 * through the Twitch line pipeline (delay, pause, spam merge, cleanup, moderation).
 * On a Kick stream the Kick chat is the main source and Twitch (read-only IRC) / YouTube are the linked ones.
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
    if (!id) return;

    //The Kick main chat runs with merged chat off too, only its links need the setting.
    //chat_kick_main: its Kick icons show only while linked, as the Twitch icons of a Twitch chat (css)
    var kick = KickApi_IsKickId(ChatLink_Key(chat_number));
    if (kick) Main_AddClassWithEle(Chat_div[chat_number], 'chat_kick_main');
    else if (!Settings_value.chat_multi.defaultValue) return;

    ChatMulti_State[chat_number] = {id: id, seq: ++ChatMulti_Seq, withHistory: withHistory, started: false};

    if (Settings_value.chat_multi.defaultValue) ChatLink_Lookup(chat_number, id);
    else ChatMulti_OnLinks(chat_number, id);
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
    //First: closing the linked Twitch IRC below must not report into a bar that is going away
    if (typeof ChatStatus_Stop === 'function') ChatStatus_Stop(chat_number);
    ChatMulti_State[chat_number] = null;
    ChatMulti_Seen[chat_number] = null;
    ChatMulti_SetLinked(chat_number, false);
    Main_RemoveClassWithEle(Chat_div[chat_number], 'chat_kick_main');

    if (typeof ChatKick_Stop === 'function') ChatKick_Stop(chat_number);
    if (typeof ChatYouTube_Stop === 'function') ChatYouTube_Stop(chat_number);
    ChatLive_StopLinkedTwitch(chat_number);
}

// After the links of the current streamer changed, history is not loaded again
function ChatMulti_Restart(chat_number) {
    ChatMulti_Start(chat_number, Chat_Id[chat_number], false);
}

function ChatMulti_OnLinks(chat_number, id) {
    var state = ChatMulti_State[chat_number];
    if (!state || state.id !== id || id !== Chat_Id[chat_number] || state.started) return;
    state.started = true;

    var key = ChatLink_Key(chat_number),
        kick = KickApi_IsKickId(key),
        links = Settings_value.chat_multi.defaultValue ? ChatLink_Current(chat_number) : {tw: null, yt: null, kick: null},
        linked = !!(links.tw || links.yt || links.kick);

    ChatMulti_SetLinked(chat_number, linked);

    //Status bar before the sources start, so every report of theirs lands in it; the platform of the stream first
    if (linked && typeof ChatStatus_Start === 'function') {
        ChatStatus_Start(
            chat_number,
            state.seq,
            (kick ? ['kick'] : ['tw']).concat(links.tw ? ['tw'] : [], links.kick ? ['kick'] : [], links.yt ? ['yt'] : []),
            kick ? links.tw && links.tw.value : ChatLive_selectedChannel[chat_number]
        );
    }

    //Kick channel: its own chat always, the linked ones only with merged chat on
    if (kick && typeof ChatKick_Start === 'function') ChatKick_Start(chat_number, state.seq, KickApi_Slug(key), state.withHistory);

    if (links.tw) ChatLive_StartLinkedTwitch(chat_number, state.id, links.tw.value, state.withHistory);
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
    // Same as Twitch: hide bots also drops a lone !command
    if (ChatLive_HideBots && !special && text.charAt(0) === '!' && text.indexOf(' ') === -1) return;

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
        nick: platform + ':' + nick.toLowerCase(), // spam merge key: never merges into a Twitch or other-platform line of the same nick
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
