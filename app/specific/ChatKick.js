/*
 * Kick chat source of the merged chat: live messages over the Pusher websocket, history, role badges,
 * subs, gifts and moderation. Everything from Kick is untrusted: names are escaped, emote ids are numeric only,
 * badge images come from whitelisted hosts only. Every async path checks ChatMulti_IsActive(chat_number, seq).
 */

//Variable initialization
var ChatKick_State = []; // per chat_number {seq, slug, chatroom, channelId, subBadges, withHistory, ws, timer, retry}
var ChatKick_PusherFallback = {key: '34bf7a0ff419a2a775b9', cluster: 'us2'};
var ChatKick_Key = null; // last good {key, cluster}, dropped on Pusher error 4001
var ChatKick_ChannelUrl = 'https://kick.com/api/v2/channels/';
var ChatKick_RetryMs = 120000; // channel info failed: try again after this
var ChatKick_RealtimeUrl = 'https://api.jouki.cz/kick/realtime';
var ChatKick_EmoteRegex = /\[emote:(\d{1,12}):[^\]]*\]/g;
var ChatKick_ImageHostRegex = /^(files\.kick\.com|ext\.cdn\.kick\.com)$/;
var ChatKick_SlugRegex = /^[\w-]{1,40}$/;
var ChatKick_KeyRegex = /^[a-f0-9]{16,40}$/;
var ChatKick_ClusterRegex = /^[a-z0-9-]{2,12}$/;
var ChatKick_RoleBadges = {
    broadcaster: 'broadcaster',
    moderator: 'moderator',
    vip: 'vip',
    og: 'og',
    founder: 'founder',
    verified: 'verified',
    sub_gifter: 'sub_gifter',
    staff: 'staff',
    subscriber: 'subscriber'
};
//Variable initialization end

function ChatKick_Start(chat_number, seq, slug, withHistory) {
    ChatKick_Stop(chat_number);
    if (!ChatKick_SlugRegex.test(slug)) return;

    var st = {seq: seq, slug: slug, chatroom: 0, channelId: 0, subBadges: [], withHistory: withHistory, ws: null, timer: 0, retry: 0};
    ChatKick_State[chat_number] = st;
    ChatKick_FetchChannel(chat_number, st);
}

function ChatKick_FetchChannel(chat_number, st) {
    var url = ChatKick_ChannelUrl + encodeURIComponent(st.slug);

    ChatKick_Xhr(url, function (status, text) {
        if (!ChatKick_Live(chat_number, st)) return;

        // Blocked by Cloudflare or CORS: let the native side try
        if (status === 0 || status === 403) FullxmlHttpGet(url, null, ChatKick_ChannelNative, noop_fun, chat_number, st.seq);
        else if (status === 200) ChatKick_Channel(chat_number, st, text);
        else ChatKick_ChannelFailed(chat_number, st, status);
    });
}

// 404: the slug does not exist (a wrong manual link); anything else is an error. Both retry silently
function ChatKick_ChannelFailed(chat_number, st, status) {
    ChatStatus_Set(chat_number, 'kick', status === 404 ? 'notfound' : 'error', st.seq);
    ChatKick_RetryChannel(chat_number, st);
}

// Silent: no line in the chat, only a timer in st.timer so Stop clears it
function ChatKick_RetryChannel(chat_number, st) {
    st.timer = Main_setTimeout(
        function () {
            if (ChatKick_Live(chat_number, st)) ChatKick_FetchChannel(chat_number, st);
        },
        ChatKick_RetryMs,
        st.timer
    );
}

function ChatKick_Stop(chat_number) {
    var st = ChatKick_State[chat_number];
    ChatKick_State[chat_number] = null;
    if (!st) return;

    Main_clearTimeout(st.timer);
    ChatKick_CloseSocket(st);
}

function ChatKick_CloseSocket(st) {
    var ws = st.ws;
    st.ws = null;
    if (!ws) return;

    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    try {
        ws.close(1000);
    } catch (e) {
        // already closed
    }
}

// Session still current: not stopped, restarted or replaced
function ChatKick_Live(chat_number, st) {
    return ChatKick_State[chat_number] === st && ChatMulti_IsActive(chat_number, st.seq);
}

function ChatKick_Xhr(url, done) {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 15000;
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) done(xhr.status, xhr.responseText);
        };
        xhr.send();
    } catch (e) {
        done(0, '');
    }
}

function ChatKick_ParseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function ChatKick_ChannelNative(obj, chat_number, seq) {
    var st = ChatKick_State[chat_number];
    if (!st || st.seq !== seq || !ChatKick_Live(chat_number, st)) return;

    if (obj.status === 200) ChatKick_Channel(chat_number, st, obj.responseText);
    else ChatKick_ChannelFailed(chat_number, st, obj.status);
}

function ChatKick_PositiveInt(value) {
    var n = Number(value);
    return n > 0 && n % 1 === 0 && n < 1e12 ? n : 0;
}

function ChatKick_Channel(chat_number, st, text) {
    var json = ChatKick_ParseJson(text);
    if (!json) {
        ChatKick_ChannelFailed(chat_number, st, 0);
        return;
    }

    st.chatroom = ChatKick_PositiveInt(json.chatroom && json.chatroom.id);
    st.channelId = ChatKick_PositiveInt(json.id);
    st.subBadges = Object.prototype.toString.call(json.subscriber_badges) === '[object Array]' ? json.subscriber_badges : [];
    if (!st.chatroom) {
        ChatKick_ChannelFailed(chat_number, st, 0);
        return;
    }

    ChatKick_ViewersApply(chat_number, st, json);

    if (st.withHistory && st.channelId) ChatKick_History(chat_number, st);
    ChatKick_Open(chat_number, st);
}

function ChatKick_History(chat_number, st) {
    ChatKick_Xhr(ChatKick_ChannelUrl + st.channelId + '/messages', function (status, text) {
        if (status !== 200 || !ChatKick_Live(chat_number, st)) return;

        var json = ChatKick_ParseJson(text),
            list = json && json.data && json.data.messages,
            i = 0,
            msg;

        if (Object.prototype.toString.call(list) !== '[object Array]') return;

        for (i; i < list.length; i++) {
            msg = ChatKick_ToMsg(list[i], st.subBadges, true);
            if (msg) ChatMulti_Line(chat_number, st.seq, msg);
        }
    });
}

// Viewers of the channel answer: {viewers, live}; viewers only while live (validated by ChatStatus_SetViewers)
function ChatKick_ViewersOf(json) {
    var live = !!(json && json.livestream);
    return {viewers: live ? Number(json.livestream.viewer_count) : null, live: live};
}

function ChatKick_ViewersApply(chat_number, st, json) {
    var v = ChatKick_ViewersOf(json);
    ChatStatus_SetViewers(chat_number, 'kick', v.viewers, v.live, st.seq);
}

// Status bar refresh: the channel answer again, once the chat knows its channel; failures keep the last count
function ChatKick_Viewers(chat_number) {
    var st = ChatKick_State[chat_number];
    if (!st || !st.chatroom || !ChatKick_Live(chat_number, st)) return;

    var url = ChatKick_ChannelUrl + encodeURIComponent(st.slug);
    ChatKick_Xhr(url, function (status, text) {
        if (!ChatKick_Live(chat_number, st)) return;

        if (status === 0 || status === 403) FullxmlHttpGet(url, null, ChatKick_ViewersNative, noop_fun, chat_number, st.seq);
        else if (status === 200) ChatKick_ViewersText(chat_number, st, text);
    });
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function ChatKick_ViewersNative(obj, chat_number, seq) {
    var st = ChatKick_State[chat_number];
    if (!st || st.seq !== seq || !ChatKick_Live(chat_number, st)) return;

    if (obj.status === 200) ChatKick_ViewersText(chat_number, st, obj.responseText);
}

function ChatKick_ViewersText(chat_number, st, text) {
    var json = ChatKick_ParseJson(text);
    if (json && typeof json === 'object') ChatKick_ViewersApply(chat_number, st, json);
}

// Gets the Pusher key (cached after the first good one) and connects
function ChatKick_Open(chat_number, st) {
    if (ChatKick_Key) ChatKick_Connect(chat_number, st);
    else FullxmlHttpGet(ChatKick_RealtimeUrl, null, ChatKick_KeyResult, noop_fun, chat_number, st.seq);
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function ChatKick_KeyResult(obj, chat_number, seq) {
    var st = ChatKick_State[chat_number];
    if (!st || st.seq !== seq || !ChatKick_Live(chat_number, st)) return;

    var json = obj.status === 200 ? ChatKick_ParseJson(obj.responseText) : null;

    if (json && ChatKick_KeyRegex.test(json.key) && ChatKick_ClusterRegex.test(json.cluster)) ChatKick_Key = {key: json.key, cluster: json.cluster};
    else ChatKick_Key = ChatKick_PusherFallback;

    ChatKick_Connect(chat_number, st);
}

function ChatKick_Connect(chat_number, st) {
    if (!ChatKick_Live(chat_number, st)) return;

    ChatKick_CloseSocket(st);

    var ws;
    try {
        ws = new WebSocket(
            'wss://ws-' + ChatKick_Key.cluster + '.pusher.com/app/' + ChatKick_Key.key + '?protocol=7&client=js&version=8.3.0&flash=false'
        );
    } catch (e) {
        ChatKick_Reconnect(chat_number, st);
        return;
    }
    st.ws = ws;

    ws.onmessage = function (e) {
        if (st.ws === ws && ChatKick_Live(chat_number, st)) ChatKick_OnFrame(chat_number, st, ws, e.data);
    };
    ws.onclose = function (e) {
        if (st.ws !== ws) return;
        st.ws = null;
        // Three reconnects without a subscription (Pusher blocked, a dead key): red; a subscription resets retry
        ChatStatus_Set(chat_number, 'kick', st.retry >= 3 ? 'error' : 'connecting', st.seq);
        if (e && e.code === 4001) ChatKick_Key = null;
        ChatKick_Reconnect(chat_number, st);
    };
    ws.onerror = noop_fun;
}

function ChatKick_Reconnect(chat_number, st) {
    if (!ChatKick_Live(chat_number, st)) return;

    var delay = Math.min(60000, 2000 * Math.pow(2, st.retry++));
    st.timer = Main_setTimeout(
        function () {
            if (ChatKick_Live(chat_number, st)) ChatKick_Open(chat_number, st);
        },
        delay,
        st.timer
    );
}

function ChatKick_Send(ws, event, data) {
    try {
        ws.send(JSON.stringify({event: event, data: data}));
    } catch (e) {
        // closing socket, onclose reconnects
    }
}

function ChatKick_OnFrame(chat_number, st, ws, raw) {
    var frame = ChatKick_ParseJson(raw);
    if (!frame || typeof frame.event !== 'string') return;

    var name = ChatKick_EventName(frame),
        data = typeof frame.data === 'string' ? ChatKick_ParseJson(frame.data) : frame.data;

    if (frame.event === 'pusher:connection_established') {
        ChatKick_Send(ws, 'pusher:subscribe', {auth: '', channel: 'chatrooms.' + st.chatroom + '.v2'});
        ChatKick_Send(ws, 'pusher:subscribe', {auth: '', channel: 'chatroom_' + st.chatroom});
    } else if (frame.event === 'pusher:ping') {
        ChatKick_Send(ws, 'pusher:pong', {});
    } else if (frame.event === 'pusher_internal:subscription_succeeded') {
        st.retry = 0;
        ChatStatus_Set(chat_number, 'kick', 'ok', st.seq);
    } else if (frame.event === 'pusher:error') {
        // The shared key was replaced by Kick, fetch the current one on the reconnect
        if (data && data.code === 4001) ChatKick_Key = null;
    } else if (data) {
        ChatKick_OnEvent(chat_number, st, frame.channel, name, data);
    }
}

function ChatKick_OnEvent(chat_number, st, channel, name, data) {
    var v2 = channel === 'chatrooms.' + st.chatroom + '.v2';

    // Chat messages and moderation only from .v2, subs and gifts from both channels (deduped by msgId)
    if (!v2 && channel !== 'chatroom_' + st.chatroom) return;
    if (!v2 && (name === 'ChatMessageEvent' || name === 'MessageDeletedEvent' || name === 'UserBannedEvent')) return;

    var msg = ChatKick_EventToMsg(name, data, st.subBadges);
    if (!msg) return;

    if (msg.platform) ChatMulti_Line(chat_number, st.seq, msg);
    else if (msg.del) ChatMulti_DeleteMsg('kick', msg.del);
    else if (msg.ban) ChatMulti_DeleteAuthor(chat_number, 'kick', msg.ban);
}

// Event name without the optional 'App\Events\' prefix
function ChatKick_EventName(ev) {
    var name = typeof ev === 'string' ? ev : ev && ev.event;
    return typeof name === 'string' ? name.replace(/^App\\Events\\/, '') : '';
}

// [emote:<numeric id>:<name>] becomes an image, everything else stays a string token
function ChatKick_Tokens(content) {
    var text = String(content || ''),
        tokens = [],
        last = 0,
        match,
        before;

    ChatKick_EmoteRegex.lastIndex = 0;
    while ((match = ChatKick_EmoteRegex.exec(text))) {
        before = text.slice(last, match.index).trim();
        // text after an emote keeps a leading space: extraMessageTokenize overwrites the first word with the previous emote otherwise
        if (before) tokens.push(last ? ' ' + before : before);
        tokens.push([emoteTemplate('https://files.kick.com/emotes/' + match[1] + '/fullsize')]);
        last = match.index + match[0].length;
    }

    before = text.slice(last).trim();
    if (before) tokens.push(last ? ' ' + before : before);

    return tokens;
}

// The badge with the highest months that is not above the subscriber's months
function ChatKick_SubBadgeUrl(subBadges, months) {
    var best = null,
        bestMonths = -1,
        i = 0,
        len = subBadges ? subBadges.length : 0,
        item;

    for (i; i < len; i++) {
        item = subBadges[i];
        if (item && item.months <= months && item.months > bestMonths && item.badge_image && typeof item.badge_image.src === 'string') {
            best = item.badge_image.src;
            bestMonths = item.months;
        }
    }

    return best;
}

function ChatKick_ImageBadge(url) {
    var safe = ChatMulti_SafeUrl(url, ChatKick_ImageHostRegex);
    return safe ? '<span class="tag" style="background-image: url(' + safe + ');"></span>' : '';
}

// Role badges are built in css, images only from Kick hosts. role: 'owner' | 'mod' | ''
function ChatKick_Badges(identity, subBadges) {
    var html = '',
        role = '',
        done = {},
        list = identity && identity.badges,
        v2 = identity && identity.badges_v2,
        i = 0,
        item,
        cls,
        img;

    for (i = 0; list && i < list.length; i++) {
        item = list[i];
        cls = item && ChatKick_RoleBadges.hasOwnProperty(item.type) ? ChatKick_RoleBadges[item.type] : null;
        if (!cls) continue;

        done[item.type] = true;
        if (item.type === 'broadcaster') role = 'owner';
        else if (item.type === 'moderator' && !role) role = 'mod';

        img = item.type === 'subscriber' ? ChatKick_ImageBadge(ChatKick_SubBadgeUrl(subBadges, Number(item.count) || 0)) : '';
        html += img || '<span class="tag chat_b_kick_' + cls + '"></span>';
    }

    // Kick's own images (level and so on), only the selected ones, not repeating a role already shown
    for (i = 0; v2 && i < v2.length; i++) {
        item = v2[i];
        if (item && item.selected && !done[item.name]) html += ChatKick_ImageBadge(item.image_url);
    }

    return {html: html, role: role};
}

function ChatKick_ToMsg(data, subBadges, history) {
    if (!data || !data.sender || typeof data.content !== 'string') return null;

    var identity = data.sender.identity || {},
        badges = ChatKick_Badges(identity, subBadges);

    return {
        platform: 'kick',
        msgId: data.id,
        authorId: data.sender.id,
        nick: data.sender.username,
        color: identity.color,
        role: badges.role,
        badges: badges.html,
        tokens: ChatKick_Tokens(data.content),
        text: data.content,
        ts: Date.parse(data.created_at) || 0,
        history: !!history,
        special: null,
        highlight: null
    };
}

function ChatKick_Special(nick, text) {
    return {
        platform: 'kick',
        msgId: '',
        authorId: '',
        nick: nick,
        color: null,
        role: '',
        badges: '',
        tokens: [],
        text: '',
        ts: Date.now(),
        history: false,
        special: Screens_AriaEscape(nick) + ' ' + text,
        highlight: null
    };
}

// -> msg for ChatMulti_Line | {del: msgId} | {ban: userId} | null
function ChatKick_EventToMsg(name, data, subBadges) {
    var msg, months, count, gifted;

    if (!data) return null;

    if (name === 'ChatMessageEvent') return ChatKick_ToMsg(data, subBadges, false);

    if (name === 'MessageDeletedEvent') return data.message && data.message.id ? {del: data.message.id} : null;

    if (name === 'UserBannedEvent') return data.user && data.user.id ? {ban: data.user.id} : null;

    // shape not yet seen live
    if (name === 'SubscriptionEvent') {
        if (typeof data.username !== 'string') return null;

        months = ChatKick_PositiveInt(data.months) || 1;
        msg = ChatKick_Special(data.username, STR_CHAT_KICK_SUB.replace('%x', months));
        msg.msgId = 'sub_' + data.username + '_' + months;
        return msg;
    }

    // shape not yet seen live
    if (name === 'GiftedSubscriptionsEvent') {
        if (typeof data.gifter_username !== 'string') return null;

        gifted = Object.prototype.toString.call(data.gifted_usernames) === '[object Array]' ? data.gifted_usernames : null;
        count = gifted ? gifted.length : 1;
        msg = ChatKick_Special(data.gifter_username, STR_CHAT_KICK_GIFT.replace('%x', count || 1));
        msg.msgId = 'gift_' + data.gifter_username + '_' + (data.id || (gifted && gifted.join('_')) || count);
        return msg;
    }

    return null;
}
