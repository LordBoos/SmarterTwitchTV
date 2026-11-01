/* Kick accounts: QR sign in like the official Kick TV app, a standalone Kick user and a Kick account linked to a Twitch user.
 * A linked account lives in user.kick = {id, username, slug, logo, token, date, expired?}, a standalone Kick user is a user entry
 * with platform 'kick' and id 'kick:<user id>' that has no Twitch token. The Kick token goes only to kick.com (KickApi_Headers). */

//Variable initialization
var KickLogin_Session = null; // {seq, uuid, key, mode, ws, timer, started, token, expired}
var KickLogin_Seq = 0;
var KickLogin_PollMs = 3000;
var KickLogin_TimeoutMs = 300000;
var KickLogin_AuthUrl = 'https://kick.com/api/tv/link/authenticate/';
// Bearer token characters only (Kick sends '<id>|<random>'), nothing that could break the header
var KickLogin_TokenRegex = /^[\w.~+\/=|-]{1,512}$/;
var KickUser_Warned = false;
//Variable initialization end

// Without an argument: the main user (an explicit undefined, e.g. a stale position, is not Kick only)
function KickUser_IsKickOnly(user) {
    if (!arguments.length) user = AddUser_UsernameArray[0];

    return !!user && user.platform === 'kick';
}

// Token of the main user, '' without a Kick account or after it expired
function KickUser_Token() {
    var kick = AddUser_UsernameArray[0] && AddUser_UsernameArray[0].kick;

    return kick && kick.token && !kick.expired ? kick.token : '';
}

// Kick refused the token (401): no refresh exists, the user signs in again from the user dialog
function KickUser_Expired() {
    var kick = AddUser_UsernameArray[0] && AddUser_UsernameArray[0].kick;
    if (!kick) return;

    if (!kick.expired) {
        kick.expired = true;
        AddUser_SaveUserArray();
    }

    if (!KickUser_Warned) {
        KickUser_Warned = true;
        Main_showWarningDialog(STR_KICK_SESSION_EXPIRED, 5000);
    }
}

// Third button of the user dialog: unlink a working linked account, otherwise sign in (link, or again)
function KickUser_CanUnlink(user) {
    return !!user && !!user.kick && !user.kick.expired && !KickUser_IsKickOnly(user);
}

// info: json of kick.com/api/v1/user (the email in it is never stored), mode.link >= 0: link to that user, -1: new user
function KickUser_Store(info, token, mode) {
    var id = ChatKick_PositiveInt(info && info.id);
    if (!id || typeof info.username !== 'string' || !info.username) return false;

    var channel = info.streamer_channel || {},
        now = new Date().getTime(),
        kick = {
            id: id,
            username: Screens_AriaEscape(info.username),
            slug: KickApi_SafeSlug(channel.slug) || KickApi_SafeSlug(info.username.toLowerCase()),
            logo: KickApi_Img(info.profilepic) || IMG_404_LOGO,
            token: token,
            date: now
        },
        pos = mode.id ? AddUser_UserFindPos(mode.id) : mode.link,
        user = pos > -1 ? AddUser_UsernameArray[pos] : null;

    if (!kick.slug || (mode.link > -1 && !user)) return false;

    // A standalone user takes only its own account back, any other account becomes a new user
    if (user && (!KickUser_IsKickOnly(user) || user.id === 'kick:' + id)) {
        user.kick = kick;
        user.date = now;
        if (KickUser_IsKickOnly(user)) {
            user.name = kick.slug;
            user.display_name = kick.username;
            user.logo = kick.logo;
        }
    } else {
        user = {
            platform: 'kick',
            id: 'kick:' + id,
            name: kick.slug,
            display_name: kick.username,
            logo: kick.logo,
            access_token: '',
            date: now,
            refresh_token: 0,
            expires_in: 0,
            expires_when: 0,
            timeout_id: null,
            kick: kick
        };

        pos = AddUser_UserFindPos(user.id);
        if (pos > -1) AddUser_UsernameArray[pos] = user;
        else AddUser_UsernameArray.push(user);
        delete AddUser_UsernameArrayRemoved[user.id];

        if (!Main_values_History_data[user.id]) Main_values_History_data[user.id] = {live: [], vod: [], clip: []};

        // First user: it is the main user now, no Twitch token of a user removed earlier in this run stays in the headers
        if (AddUser_UsernameArray.length === 1) {
            AddUser_UpdateSidePanel();
            OSInterface_UpdateUserId(user);
            AddUser_SetUserHeaders();
        }
    }

    AddUser_SaveUserArray();
    Users_status = false;
    return true;
}

function KickUser_Unlink(pos) {
    var user = AddUser_UsernameArray[pos];
    if (!user || !user.kick || KickUser_IsKickOnly(user)) return;

    delete user.kick;
    user.date = new Date().getTime();
    AddUser_SaveUserArray();
    Users_status = false;
}

// random: optional Math.random replacement (tests), the default uses the crypto source when the WebView has one
function KickLogin_NewCode(random) {
    var hex = '0123456789ABCDEF',
        uuid = '',
        key = '',
        i = 0,
        r;

    random = random || (window.crypto && window.crypto.getRandomValues ? KickLogin_Random : Math.random);

    for (i; i < 36; i++) {
        r = Math.floor(random() * 16);
        if (i === 8 || i === 13 || i === 18 || i === 23) uuid += '-';
        else if (i === 14) uuid += '4';
        else uuid += hex.charAt(i === 19 ? (r & 3) | 8 : r);
    }

    for (i = 0; i < 6; i++) key += Math.floor(random() * 10);

    return {uuid: uuid, key: key};
}

function KickLogin_Random() {
    var value = new Uint32Array(1);
    window.crypto.getRandomValues(value);

    return value[0] / 4294967296;
}

function KickLogin_QrUrl(code) {
    return 'https://kick.com/tv/login?uuid=' + code.uuid + '&code=' + code.key;
}

function KickLogin_IsVisible() {
    return Main_isElementShowing('dialog_kick_login');
}

// The target user is kept by id: a sync of the user list while the dialog is open can not move the account to another user
function KickLogin_Begin(mode) {
    KickLogin_Stop();

    var link = mode && mode.id ? AddUser_UserFindPos(mode.id) : mode && mode.link > -1 ? mode.link : -1;
    if (!AddUser_UsernameArray[link]) link = -1;

    KickLogin_Session = {
        seq: ++KickLogin_Seq,
        uuid: '',
        key: '',
        mode: {link: link, id: link > -1 ? AddUser_UsernameArray[link].id : null},
        ws: null,
        timer: null,
        started: new Date().getTime(),
        token: '',
        expired: false
    };

    return KickLogin_Session;
}

function KickLogin_Stop() {
    var ses = KickLogin_Session;
    KickLogin_Session = null;
    if (!ses) return;

    Main_clearTimeout(ses.timer);
    ChatKick_CloseSocket(ses);
}

function KickLogin_Show(mode) {
    var ses = KickLogin_Begin(mode),
        code = KickLogin_NewCode();

    ses.uuid = code.uuid;
    ses.key = code.key;

    Main_textContent('kick_login_title', STR_KICK_LOGIN_TITLE);
    Main_textContent('kick_login_text', STR_KICK_LOGIN_TEXT);
    Main_textContent('kick_login_status', STR_KICK_LOGIN_WAIT);
    try {
        PhoneChat_DrawQr(Main_getElementById('kick_login_qr'), KickLogin_QrUrl(ses));
    } catch (e) {
        Main_textContent('kick_login_status', STR_KICK_LOGIN_FAIL);
    }
    Main_ShowElement('dialog_kick_login');

    KickLogin_Connect(ses);
    KickLogin_Schedule(ses);
}

function KickLogin_Hide() {
    KickLogin_Stop();
    Main_HideElement('dialog_kick_login');
    KickLogin_ClearQr();
}

function KickLogin_ClearQr() {
    var canvas = Main_getElementById('kick_login_qr');
    if (canvas && canvas.getContext) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// Back closes, OK makes a new code once the old one expired or failed (OK while waiting does nothing: the phone may be confirming)
function KickLogin_HandleKeyDown(e) {
    switch (e.keyCode) {
        case KEY_KEYBOARD_BACKSPACE:
        case KEY_RETURN:
            KickLogin_Hide();
            break;
        case KEY_PLAY:
        case KEY_PLAYPAUSE:
        case KEY_KEYBOARD_SPACE:
        case KEY_ENTER:
            if (!e.repeat && KickLogin_Session && KickLogin_Session.expired) KickLogin_Show(KickLogin_Session.mode);
            break;
        default:
            break;
    }
}

// Same Pusher app as the chat, the phone confirmation arrives as SetupTvEvent on tv-setup-<UUID>; polling covers a lost socket
function KickLogin_Connect(ses) {
    var ws;

    try {
        ws = new WebSocket(
            'wss://ws-' +
                ChatKick_PusherFallback.cluster +
                '.pusher.com/app/' +
                ChatKick_PusherFallback.key +
                '?protocol=7&client=js&version=8.3.0&flash=false'
        );
    } catch (e) {
        return;
    }
    ses.ws = ws;

    ws.onmessage = function (e) {
        if (KickLogin_Session === ses && ses.ws === ws) KickLogin_OnFrame(ses, ws, e.data);
    };
    ws.onclose = function () {
        if (ses.ws === ws) ses.ws = null;
    };
    ws.onerror = noop_fun;
}

function KickLogin_OnFrame(ses, ws, raw) {
    var frame = ChatKick_ParseJson(raw),
        channel = 'tv-setup-' + ses.uuid;

    if (!frame || typeof frame.event !== 'string') return;

    if (frame.event === 'pusher:connection_established') ChatKick_Send(ws, 'pusher:subscribe', {auth: '', channel: channel});
    else if (frame.event === 'pusher:ping') ChatKick_Send(ws, 'pusher:pong', {});
    else if (frame.channel === channel && ChatKick_EventName(frame) === 'SetupTvEvent' && !ses.token && !ses.expired) KickLogin_Post(ses);
}

function KickLogin_Schedule(ses) {
    ses.timer = Main_setTimeout(
        function () {
            if (KickLogin_Session !== ses || ses.token || ses.expired) return;

            if (new Date().getTime() - ses.started >= KickLogin_TimeoutMs) KickLogin_End(ses, STR_KICK_LOGIN_EXPIRED);
            else KickLogin_Post(ses);
        },
        KickLogin_PollMs,
        ses.timer
    );
}

function KickLogin_Post(ses) {
    FullxmlHttpGet(
        KickLogin_AuthUrl + ses.uuid,
        KickApi_Headers('').concat([['Content-Type', 'application/json']]),
        KickLogin_AuthResult,
        noop_fun,
        0,
        ses.seq,
        'POST',
        JSON.stringify({key: ses.key})
    );
}

// The code is over (expired or failed): socket and polling stop, OK makes a new one
function KickLogin_End(ses, text) {
    ses.expired = true;
    Main_clearTimeout(ses.timer);
    ChatKick_CloseSocket(ses);
    KickLogin_ClearQr();
    Main_textContent('kick_login_status', text);
}

// Named top-level because FullxmlHttpGet resolves callbacks by name. 403 = not confirmed yet, anything else: wait until expiry
function KickLogin_AuthResult(obj, key, seq) {
    var ses = KickLogin_Session;
    if (!ses || ses.seq !== seq || ses.token || ses.expired) return;

    var json = obj.status === 200 ? ChatKick_ParseJson(obj.responseText) : null;

    if (json && typeof json.token === 'string' && KickLogin_TokenRegex.test(json.token)) KickLogin_FetchUser(ses, json.token);
    else KickLogin_Schedule(ses);
}

function KickLogin_FetchUser(ses, token) {
    ses.token = token;
    Main_clearTimeout(ses.timer);
    FullxmlHttpGet(KickApi_Base + 'v1/user', KickApi_Headers(token), KickLogin_UserResult, noop_fun, 0, ses.seq, null, null);
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function KickLogin_UserResult(obj, key, seq) {
    var ses = KickLogin_Session;
    if (!ses || ses.seq !== seq || !ses.token || ses.expired) return;

    var json = obj.status === 200 ? ChatKick_ParseJson(obj.responseText) : null;

    if (!json || !KickUser_Store(json, ses.token, ses.mode)) {
        KickLogin_End(ses, STR_KICK_LOGIN_FAIL);
        return;
    }

    var fromAddUser = AddUser_IsInUserScreen(),
        fromUsers = Main_values.Main_Go === Main_Users;

    KickLogin_Hide();

    if (fromAddUser) {
        AddUser_exit();
        Main_values.Main_Go = Main_Users;
        Main_SwitchScreen();
    } else if (fromUsers) {
        Users_init();
    }
}

// Entry without the QR (CDP, tests): signs in with a token the caller already has
function KickLogin_Accept(token, mode) {
    var ses = KickLogin_Begin(mode);

    if (typeof token === 'string' && KickLogin_TokenRegex.test(token)) KickLogin_FetchUser(ses, token);

    return ses.seq;
}

/* Followed Kick live streams in Following Live, the player feed and the side panel: only with a Kick token (Twitch only users
 * send nothing to kick.com) and only for the first page. Any Kick failure leaves the Twitch part as it is. */
var KickFollow_Url = 'https://kick.com/api/v1/user/livestreams';
// Kick requests that gate a Twitch list give up early, a hanging kick.com must not hold the Twitch list on the spinner
var KickFollow_Timeout = 8000;

// Kick items (viewer_count set) inserted by viewers into the Twitch list, the Twitch order stays as Twitch sent it
function KickFollow_MergeHelix(twitchData, kickItems) {
    var kick = kickItems.slice().sort(function (a, b) {
            return b.viewer_count - a.viewer_count;
        }),
        merged = [],
        i = 0,
        j = 0;

    for (i; i < twitchData.length; i++) {
        while (j < kick.length && kick[j].viewer_count > twitchData[i].viewer_count) merged.push(kick[j++]);
        merged.push(twitchData[i]);
    }

    return merged.concat(kick.slice(j));
}

// Livestreams of a v1/user/livestreams answer, [] on any failure. 401: Kick refused the token
function KickFollow_List(obj) {
    var json = null;

    if (obj.status === 401) KickUser_Expired();

    try {
        if (obj.status === 200) json = JSON.parse(obj.responseText);
    } catch (e) {}

    return Array.isArray(json) ? json : [];
}

// Screen items (KickApi_Item with viewer_count), rows with an unsafe id or slug are skipped
function KickFollow_Items(list) {
    var items = [],
        i = 0,
        cell;

    for (i; i < list.length; i++) {
        cell = list[i] && typeof list[i] === 'object' ? KickApi_LiveCell(list[i]) : null;
        if (!cell || !cell[6]) continue;

        items.push(KickApi_Item(cell, cell[7], cell[14], list[i].is_mature));
        items[items.length - 1].viewer_count = cell[13];
    }

    return items;
}

// Nodes shaped like the GQL feed nodes, so the existing live_feed_sort orders Twitch and Kick together
function KickFollow_FeedNodes(list) {
    return KickFollow_Items(list).map(function (item) {
        var cell = item.kickCell;

        return {
            kickCell: cell,
            stream: {
                viewersCount: cell[13],
                createdAt: cell[12],
                broadcaster: {login: cell[6].toLowerCase(), id: cell[14]},
                game: {displayName: cell[3]},
                is_mature: item.is_mature
            }
        };
    });
}

// Following Live: the first Twitch page waits in kickPending for the Kick part, false without a token or on a next page
function KickFollow_Start(key, responseObj) {
    var token = KickUser_Token(),
        obj = token ? ScreenObj[key] : null;

    if (!obj || obj.data) return false;

    obj.kickPending = responseObj;
    FullxmlHttpGet(KickFollow_Url, KickApi_Headers(token), KickFollow_LiveResult, noop_fun, key, obj.navigationRequest.id, null, null, KickFollow_Timeout);

    return true;
}

// Named top-level because FullxmlHttpGet resolves callbacks by name. A refresh or another user drops the answer (Screens_HttpResultStatus)
function KickFollow_LiveResult(obj, key, requestId) {
    var screen = ScreenObj[key],
        request = screen && screen.navigationRequest,
        pending = screen && screen.kickPending;

    if (!request || request.id !== Number(requestId) || request.account !== Navigation_Account() || !pending) return;

    screen.kickPending = null;
    screen.concatenateAfter({
        data: KickFollow_MergeHelix(pending.data || [], KickFollow_Items(KickFollow_List(obj))),
        pagination: pending.pagination || {}
    });
}

// Player feed and side panel: the GQL nodes wait in the feed ticket for the Kick part, false without a token
function KickFollow_FeedStart(response) {
    var token = KickUser_Token();
    if (!token) return false;

    Navigation_FeedFull(KickFollow_Url, KickApi_Headers(token), KickFollow_FeedResult, noop_fun, UserLiveFeedobj_UserLivePos, response, null, null, KickFollow_Timeout);

    return true;
}

// Called by the feed ticket only while the feed load and the user are still current
function KickFollow_FeedResult(obj, pos, twitch) {
    UserLiveFeed_loadDataSuccessEnd(twitch.concat(KickFollow_FeedNodes(KickFollow_List(obj))));
}

/* Followed Kick channels in Following Channels: once after the last Twitch page, all pages of v2/channels/followed (cursor), the screen
 * then sorts them with the Twitch channels. Any Kick failure leaves the Twitch channels as they are. */
var KickFollow_ChannelsUrl = 'https://kick.com/api/v2/channels/followed';
var KickFollow_ChannelsMaxPages = 20;

// Channel nodes shaped like the GQL follow nodes (login for the sort), rows with an unsafe slug are skipped
function KickFollow_ChannelNodes(channels) {
    var nodes = [],
        i = 0,
        cell;

    for (i; i < channels.length; i++) {
        cell = channels[i] && typeof channels[i] === 'object' ? KickApi_ChannelCell(channels[i]) : null;
        if (!cell || !cell[0]) continue;

        nodes.push({node: {login: cell[0], id: cell[1], kickCell: cell}});
    }

    return nodes;
}

// The Kick part is asked after the last Twitch page, false without a token (nothing is sent)
function KickFollow_ChannelsStart(key) {
    var token = KickUser_Token(),
        obj = token ? ScreenObj[key] : null;

    if (!obj) return false;

    obj.kickChannels = {nodes: [], pages: 0};
    FullxmlHttpGet(KickFollow_ChannelsUrl, KickApi_Headers(token), KickFollow_ChannelsResult, noop_fun, key, obj.navigationRequest.id, null, null, KickFollow_Timeout);

    return true;
}

// Named top-level because FullxmlHttpGet resolves callbacks by name. A refresh or another user drops the answer
function KickFollow_ChannelsResult(obj, key, requestId) {
    var screen = ScreenObj[key],
        request = screen && screen.navigationRequest,
        pending = screen && screen.kickChannels,
        json = null,
        next = null,
        token = KickUser_Token();

    if (!request || request.id !== Number(requestId) || request.account !== Navigation_Account() || !pending) return;

    if (obj.status === 401) KickUser_Expired();

    try {
        if (obj.status === 200) json = JSON.parse(obj.responseText);
    } catch (e) {}

    // Any failure keeps the Twitch channels, what arrived before is dropped too (no half lists)
    if (!json || !Array.isArray(json.channels)) {
        screen.kickChannels = null;
        screen.finishChannels();
        return;
    }

    pending.nodes = pending.nodes.concat(KickFollow_ChannelNodes(json.channels));
    pending.pages++;
    next = typeof json.nextCursor === 'number' || (typeof json.nextCursor === 'string' && /^\d{1,10}$/.test(json.nextCursor)) ? json.nextCursor : null;

    if (next !== null && token && pending.pages < KickFollow_ChannelsMaxPages) {
        FullxmlHttpGet(
            KickFollow_ChannelsUrl + '?cursor=' + next,
            KickApi_Headers(token),
            KickFollow_ChannelsResult,
            noop_fun,
            key,
            requestId,
            null,
            null,
            KickFollow_Timeout
        );
        return;
    }

    screen.kickChannels = null;
    screen.data.push.apply(screen.data, pending.nodes);
    screen.finishChannels();
}

// Follow state and follow/unfollow of one Kick channel. Both are plain kick.com requests with the Kick token.
// State: GET v2/channels/<slug>/me answers is_following, follow: POST v2/channels/<slug>/follow, unfollow: DELETE (same url).
// One request is pending at a time, a newer one drops the answer of an older one. done(state, slug): state is true or false,
// null when a change failed (the old state stays).
var KickFollow_BaseUrl = 'https://kick.com/api/v2/channels/';
var KickFollow_Seq = 0;
var KickFollow_Pending = null;

// false when nothing was sent (no Kick token or an unsafe slug)
function KickFollow_Check(slug, done) {
    var token = KickUser_Token();

    if (!token || !KickApi_SafeSlug(slug)) return false;

    KickFollow_Pending = {done: done, slug: slug, token: token};
    FullxmlHttpGet(KickFollow_BaseUrl + slug + '/me', KickApi_Headers(token), KickFollow_CheckResult, noop_fun, 0, ++KickFollow_Seq, null, null, KickFollow_Timeout);

    return true;
}

// Named top-level because FullxmlHttpGet resolves callbacks by name
function KickFollow_CheckResult(obj, key, seq) {
    var pending = KickFollow_Pending,
        json = null;

    if (!pending || Number(seq) !== KickFollow_Seq) return;

    KickFollow_Pending = null;

    //The main user changed while the check was in flight: the answer belongs to the old token, a 401 must not expire the new user
    if (pending.token !== KickUser_Token()) return;

    if (obj.status === 401) KickUser_Expired();

    try {
        if (obj.status === 200) json = JSON.parse(obj.responseText);
    } catch (e) {}

    pending.done(!!json && json.is_following === true, pending.slug);
}

// false when nothing was sent. The body of the follow is an empty json object, HttpURLConnection sends no length for a POST without a body.
function KickFollow_Set(slug, follow, done) {
    var token = KickUser_Token(),
        headers;

    if (!token || !KickApi_SafeSlug(slug)) return false;

    headers = KickApi_Headers(token);
    if (follow) headers.push(['Content-Type', 'application/json']);

    KickFollow_Pending = {done: done, slug: slug};
    FullxmlHttpGet(
        KickFollow_BaseUrl + slug + '/follow',
        headers,
        KickFollow_SetResult,
        noop_fun,
        follow ? 1 : 0,
        ++KickFollow_Seq,
        follow ? 'POST' : 'DELETE',
        follow ? '{}' : null,
        KickFollow_Timeout
    );

    return true;
}

function KickFollow_SetResult(obj, key, seq) {
    var pending = KickFollow_Pending;

    if (!pending || Number(seq) !== KickFollow_Seq) return;

    KickFollow_Pending = null;

    // A 401 here does not expire the token: the wire format of this mutating route is unconfirmed (a cookie or XSRF could be
    // needed instead of the Bearer) and expiring would disable every Kick feature until a relink. Read routes still expire.
    if (obj.status >= 200 && obj.status < 300) {
        pending.done(Number(key) === 1, pending.slug);
    } else {
        KickUser_Warn(STR_KICK_FOLLOW_FAIL, 2000);
        pending.done(null, pending.slug);
    }
}

// Short warning on the player or on the screens
function KickUser_Warn(text, time) {
    if (Play_isOn) Play_showWarningMiddleDialog(text, time);
    else Main_showWarningDialog(text, time);
}

var KickChat_SendUrl = 'https://kick.com/api/v2/messages/send/';
var KickChat_SendTimeout = 8000;

// false when nothing was sent (no Kick token, no chatroom of this Kick chat). The message is not added locally, it comes back through Pusher.
// Wire format of the official app: POST /api/v2/messages/send/<chatroom id>, json {"content": text, "type": "message"} (KickApiDataSourceImpl.sendMessage).
function KickChat_Send(chat_number, text) {
    var token = KickUser_Token(),
        st = ChatKick_State[chat_number],
        chatroom = st && ChatKick_PositiveInt(st.chatroom),
        headers;

    if (!token || !chatroom || typeof text !== 'string' || !text) return false;

    headers = KickApi_Headers(token);
    headers.push(['Content-Type', 'application/json']);

    FullxmlHttpGet(
        KickChat_SendUrl + chatroom,
        headers,
        KickChat_SendResult,
        noop_fun,
        chat_number,
        st.seq,
        'POST',
        JSON.stringify({content: text, type: 'message'}),
        KickChat_SendTimeout
    );

    return true;
}

// Named top-level because FullxmlHttpGet resolves callbacks by name. A 401 does not expire the token, see KickFollow_SetResult.
function KickChat_SendResult(obj, key, seq) {
    var st = ChatKick_State[key];

    // The chat was closed or restarted since the message was sent
    if (!st || st.seq !== Number(seq) || (obj.status >= 200 && obj.status < 300)) return;

    ChatLiveControls_showWarningDialog(STR_KICK_CHAT_SEND_FAIL, 2000);
}
