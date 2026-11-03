/*
 * Status bar above a chat with linked platforms: total viewers, then per platform its icon, viewers and a dot for the
 * chat connection (green connected, yellow connecting, grey not live without a chat, red failed with a short reason).
 * The sources report through ChatStatus_Set / ChatStatus_SetViewers and fetch their own counts on ChatStatus_Refresh.
 * A failed count refresh never changes the dot: the last known count stays.
 */

//Variable initialization
var ChatStatus_State = []; // per chat_number {seq, order, twLogin, p: {code: {state, viewers, live}}, timer}
var ChatStatus_RefreshMs = 60000;
//Variable initialization end

// order: platform codes 'tw' | 'kick' | 'yt', the platform of the stream first; twLogin: Twitch login of the chat or of its link
function ChatStatus_Start(chat_number, seq, order, twLogin) {
    ChatStatus_Stop(chat_number);

    var st = {seq: seq, order: order, twLogin: twLogin, p: {}, timer: 0, twChecked: false},
        i = 0;

    for (i; i < order.length; i++) st.p[order[i]] = {state: 'connecting', viewers: null, live: null};
    if (st.p.tw && ChatLive_loaded[chat_number]) st.p.tw.state = 'ok';

    ChatStatus_State[chat_number] = st;
    ChatStatus_Layout(chat_number, true);
    ChatStatus_Render(chat_number);

    st.timer = Main_setInterval(
        function () {
            ChatStatus_Refresh(chat_number);
        },
        ChatStatus_RefreshMs,
        st.timer
    );
    ChatStatus_Refresh(chat_number);
}

function ChatStatus_Stop(chat_number) {
    var st = ChatStatus_State[chat_number];
    ChatStatus_State[chat_number] = null;
    if (!st) return;

    Main_clearInterval(st.timer);
    ChatStatus_Layout(chat_number, false);
}

// The entry of a platform of the running session, null for an old session (seq given and different) or no bar
function ChatStatus_Entry(chat_number, platform, seq) {
    var st = ChatStatus_State[chat_number];
    if (!st || (seq !== undefined && seq !== st.seq) || !st.p.hasOwnProperty(platform)) return null;
    return st.p[platform];
}

// A channel that does not exist stays not found for the session: an IRC join of an unknown login must not turn it green
function ChatStatus_Set(chat_number, platform, state, seq) {
    var entry = ChatStatus_Entry(chat_number, platform, seq);
    //Unchanged: no redraw (a working YouTube poll reports ok every second)
    if (!entry || entry.state === 'notfound' || entry.state === state) return;

    entry.state = state;
    ChatStatus_Render(chat_number);
}

// viewers: kept only as a whole number >= 0, else the last known count stays; live: stored when it is a boolean
function ChatStatus_SetViewers(chat_number, platform, viewers, live, seq) {
    var entry = ChatStatus_Entry(chat_number, platform, seq);
    if (!entry) return;

    if (typeof viewers === 'number' && isFinite(viewers) && viewers >= 0 && viewers % 1 === 0) entry.viewers = viewers;
    if (typeof live === 'boolean') entry.live = live;
    ChatStatus_Render(chat_number);
}

function ChatStatus_Refresh(chat_number) {
    var st = ChatStatus_State[chat_number];
    if (!st) return;

    if (st.p.tw) ChatStatus_TwitchViewers(chat_number, st.seq);
    //A linked Twitch login (Kick chat) may not exist and an IRC join does not tell: checked until Helix answers
    if (st.p.tw && st.order[0] === 'kick' && !st.twChecked) ChatStatus_TwitchExists(chat_number, st.seq);
    if (st.p.yt) ChatYouTube_Viewers(chat_number);
    if (st.p.kick) ChatKick_Viewers(chat_number);
}

function ChatStatus_TwitchUrl(chat_number, path) {
    var st = ChatStatus_State[chat_number];
    return st && /^\w{3,25}$/.test(st.twLogin) ? Main_helix_api + path + encodeURIComponent(st.twLogin) : null;
}

function ChatStatus_TwitchViewers(chat_number, seq) {
    var url = ChatStatus_TwitchUrl(chat_number, 'streams?user_login=');
    if (url) BaseXmlHttpGet(url, ChatStatus_TwitchViewersResult, noop_fun, chat_number, seq, true);
}

// Named top-level because BaseXmlHttpGet resolves callbacks by name; unreadable answers keep the last count
function ChatStatus_TwitchViewersResult(responseText, chat_number, seq) {
    var data = ChatStatus_HelixData(responseText);
    if (!data) return;

    if (data.length) ChatStatus_SetViewers(chat_number, 'tw', Number(data[0].viewer_count), true, seq);
    else ChatStatus_SetViewers(chat_number, 'tw', null, false, seq);
}

function ChatStatus_TwitchExists(chat_number, seq) {
    var url = ChatStatus_TwitchUrl(chat_number, 'users?login=');
    if (url) BaseXmlHttpGet(url, ChatStatus_TwitchExistsResult, noop_fun, chat_number, seq, true);
}

function ChatStatus_TwitchExistsResult(responseText, chat_number, seq) {
    var st = ChatStatus_State[chat_number],
        data = ChatStatus_HelixData(responseText);
    if (!data || !st || st.seq !== seq) return;

    st.twChecked = true;
    if (!data.length) ChatStatus_Set(chat_number, 'tw', 'notfound', seq);
}

// Helix `data` array or null
function ChatStatus_HelixData(responseText) {
    var json;
    try {
        json = JSON.parse(responseText);
    } catch (e) {
        return null;
    }
    return json && Object.prototype.toString.call(json.data) === '[object Array]' ? json.data : null;
}

function ChatStatus_Label(entry) {
    if (entry.state === 'notfound') return STR_CHAT_STATUS_NOT_FOUND;
    if (entry.state === 'error') return STR_CHAT_STATUS_ERROR;
    if (entry.state === 'offline' || entry.live === false) return STR_CHAT_STATUS_OFFLINE;
    return entry.viewers !== null ? Main_formatNumber(entry.viewers) : '...';
}

function ChatStatus_Dot(entry) {
    if (entry.state === 'ok') return 'ok';
    if (entry.state === 'connecting') return 'wait';
    if (entry.state === 'offline') return 'off';
    return 'bad';
}

// Sum of the known counts of live platforms with a working chat, null when none is known
function ChatStatus_Total(st) {
    var total = null,
        i = 0,
        entry;

    for (i; i < st.order.length; i++) {
        entry = st.p[st.order[i]];
        if (entry.viewers !== null && entry.live !== false && (entry.state === 'ok' || entry.state === 'connecting'))
            total = (total || 0) + entry.viewers;
    }

    return total;
}

function ChatStatus_Render(chat_number) {
    var st = ChatStatus_State[chat_number];
    if (!st) return;

    var total = ChatStatus_Total(st),
        row = '',
        i = 0,
        code,
        dot;

    for (i; i < st.order.length; i++) {
        code = st.order[i];
        dot = ChatStatus_Dot(st.p[code]);
        row +=
            (i ? '<span class="chat_status_sep">|</span>' : '') +
            ChatMulti_Icon(code) +
            '<span class="chat_status_label' +
            (dot === 'bad' ? ' chat_status_label_bad' : '') +
            '">' +
            ChatStatus_Label(st.p[code]) +
            '</span><span class="chat_status_dot chat_status_' +
            dot +
            '"></span>';
    }

    Main_innerHTML(
        'chat_status' + chat_number,
        '<div class="chat_status_total">' +
            (total === null ? '...' : Main_formatNumber(total) + STR_SPACE_HTML + Main_GetViewerStrings(total)) +
            '</div><div class="chat_status_row">' +
            row +
            '</div>'
    );
}

// active: two-row bar instead of the one-line counter; else back to the one-line counter when the setting shows it (Twitch and Kick)
function ChatStatus_Layout(chat_number, active) {
    var oneLine = !active && Settings_value.show_chatters.defaultValue;

    if (active) {
        Main_AddClass('chat_loggedin' + chat_number, 'hide');
        Main_RemoveClass('chat_status' + chat_number, 'hide');
    } else {
        Main_AddClass('chat_status' + chat_number, 'hide');
        if (oneLine) Main_RemoveClass('chat_loggedin' + chat_number, 'hide');
    }

    Main_getElementById('chat_box_holder' + chat_number).style.height = active ? 'calc(100% - 5.3vh)' : oneLine ? 'calc(100% - 2.9vh)' : '';
    if (!chat_number) Main_getElementById('chat_container_name' + chat_number).style.top = active ? '5.4vh' : oneLine ? '3vh' : '';
}
