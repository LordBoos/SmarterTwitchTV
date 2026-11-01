/* Focused regression checks for the raid follower (PlayRaid): EventSub websocket lifecycle and raid switching. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('app/specific/PlayRaid.js', 'utf8');
let passed = 0;
function check(value, label) {
    assert.ok(value, label);
    passed++;
}
function checkEqual(value, expected, label) {
    assert.strictEqual(value, expected, label + ' (got ' + JSON.stringify(value) + ')');
    passed++;
}

function makeSandbox() {
    const sockets = [];
    class FakeSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 0; //CONNECTING
            this.sent = [];
            sockets.push(this);
        }
        open() {
            this.readyState = 1;
            if (this.onopen) this.onopen();
        }
        message(obj) {
            if (this.onmessage) this.onmessage({data: JSON.stringify(obj)});
        }
        close() {
            this.readyState = 3;
            if (this.onclose) this.onclose();
        }
    }

    const http = []; //every FullxmlHttpGet/BaseXmlHttpGet call
    const warnings = [];
    let openStreamCount = 0;
    let savedPlayData = 0;
    const timers = [];
    let timerId = 0;

    const s = {
        WebSocket: FakeSocket,
        //globals read by the module
        //raid_switch defaultValue mirrors the post-Settings_SetDefaults runtime value:
        //Settings_SetDefaults loads (stored = index + 1) and subtracts 1, so 'auto' (index 1) is 1 at runtime
        Settings_value: {raid_switch: {defaultValue: 1}},
        AddUser_UserHasToken: () => s._hasToken,
        _hasToken: true,
        AddUser_UsernameArray: [{access_token: 'user-token'}],
        AddCode_backup_client_id: 'client-id',
        clientIdHeader: 'Client-ID',
        Bearer: 'Bearer ',
        Bearer_Header: 'Authorization',
        Main_helix_api: 'https://api.twitch.tv/helix/',
        Main_IsOn_OSInterface: false,
        Play_MultiEnable: false,
        PlayExtra_PicturePicture: false,
        PlayVod_isOn: false,
        PlayClip_isOn: false,
        Play_isOn: true,
        Play_EndDialogEnter: 0,
        Play_data: {data: ['thumb', 'Raider', 'title', 'game', '', '', 'raider', 'bcid', false, null, null, '', '', 0, '111', 'en', null, null, null]},
        Play_data_base: {data: []},
        noop_fun: () => {},
        Main_Log: () => {},
        Main_clearTimeout: id => {
            for (let i = timers.length - 1; i >= 0; i--) {
                if (timers[i].id === id) timers.splice(i, 1);
            }
        },
        Main_setTimeout: fn => {
            const id = ++timerId;
            timers.push({id, fn});
            return id;
        },
        runTimers: () => {
            const pending = timers.splice(0, timers.length);
            pending.forEach(timer => timer.fn());
        },
        timerCount: () => timers.length,
        STR_SPACE_HTML: ' ',
        STR_LIVE: ' live ',
        STR_IS_OFFLINE: 'is offline',
        STR_RAID_SWITCHING: ' is raiding, switching to ',
        AddCode_validateToken: () => http.push('validateToken'),
        Play_showWarningMiddleDialog: text => warnings.push(text),
        Play_SavePlayData: () => savedPlayData++,
        Play_StopStay: () => {},
        Play_HideEndDialog: () => {},
        Main_openStream: () => openStreamCount++,
        KickApi_IsKickId: id => /^kick:/.test(String(id)),
        ScreensObj_LiveCellArray: cell => ['thumb', cell.user_name, cell.title, cell.game_name, '', '', cell.user_login, 'bcid-new', false, null, null, '', '', 0, cell.user_id, 'en', null, null, null],
        BaseXmlHttpGet: (url, success, error, key, checkResult) => http.push({url, success, error, checkResult, kind: 'get'}),
        FullxmlHttpGet: (url, headers, success, error, key, checkResult, method, body) =>
            http.push({url, headers, success, error, checkResult, method, body, kind: 'full'}),
        _sockets: sockets,
        _http: http,
        _warnings: warnings,
        _openStreamCount: () => openStreamCount,
        _savedPlayData: () => savedPlayData
    };
    return s;
}

function loadModule(sandbox) {
    vm.createSandbox ?? null;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
}

function lastHttp(sandbox, kind) {
    const list = sandbox._http.filter(entry => !kind || entry.kind === kind);
    return list[list.length - 1];
}

function welcomeAndSubscribe(sandbox) {
    sandbox.PlayRaid_SetChannel('111');
    const socket = sandbox._sockets[sandbox._sockets.length - 1];
    socket.open();
    socket.message({metadata: {message_type: 'session_welcome'}, payload: {session: {id: 'sess-1'}}});
    return socket;
}

function raidEvent(from, toLogin, toName) {
    return {
        from_broadcaster_user_id: from,
        to_broadcaster_user_login: toLogin,
        to_broadcaster_user_name: toName,
        viewers: 42
    };
}

//1. Enabled, logged in: connects and subscribes with the watched channel as raid source
{
    const s = makeSandbox();
    loadModule(s);
    const socket = welcomeAndSubscribe(s);
    check(socket.url.indexOf('eventsub.wss.twitch.tv') !== -1, 'connects to EventSub websocket');
    const sub = lastHttp(s, 'full');
    checkEqual(sub.method, 'POST', 'subscribe uses POST');
    checkEqual(sub.url, 'https://api.twitch.tv/helix/eventsub/subscriptions', 'subscribe hits eventsub endpoint');
    const body = JSON.parse(sub.body);
    checkEqual(body.type, 'channel.raid', 'subscription type is channel.raid');
    checkEqual(body.condition.from_broadcaster_user_id, '111', 'subscribes to raids from the watched channel');
    checkEqual(body.transport.session_id, 'sess-1', 'subscribe carries the welcome session id');
    check(sub.headers.some(h => h[0] === 'Authorization' && h[1] === 'Bearer user-token'), 'subscribe uses the user token');
}

//1b. A Kick channel never subscribes to Twitch EventSub
{
    const s = makeSandbox();
    loadModule(s);
    s.PlayRaid_SetChannel('kick:xqc');
    checkEqual(s._sockets.length, 0, 'kick channel never subscribes');
}

//2. Subscribe success stores the subscription id scoped to the current channel
{
    const s = makeSandbox();
    loadModule(s);
    welcomeAndSubscribe(s);
    const sub = lastHttp(s, 'full');
    sub.success({status: 202, responseText: JSON.stringify({data: [{id: 'sub-1', condition: {from_broadcaster_user_id: '111'}}]})});
    checkEqual(s.PlayRaid_SubscriptionId, 'sub-1', 'subscription id stored for the subscribed channel');

    s.PlayRaid_SetChannel('222'); //channel change must delete the old subscription
    const del = s._http.filter(entry => entry.method === 'DELETE')[0];
    check(del, 'channel change deletes the old subscription');
    check(del.url.indexOf('id=sub-1') !== -1, 'delete targets the stored subscription id');
    checkEqual(del.checkResult, 0, 'delete passes a numeric bridge checkResult');
    const newSub = s._http.filter(entry => entry.method === 'POST').pop();
    checkEqual(JSON.parse(newSub.body).condition.from_broadcaster_user_id, '222', 'channel change subscribes to the new channel');
    checkEqual(newSub.checkResult, 0, 'subscribe passes a numeric bridge checkResult');

    //A response for a channel we are no longer on must not store its id
    s.PlayRaid_SubscribeSuccess({status: 202, responseText: JSON.stringify({data: [{id: 'sub-9', condition: {from_broadcaster_user_id: '111'}}]})});
    checkEqual(s.PlayRaid_SubscriptionId, 'sub-1', 'stale channel response does not store its id');
}

//3. Raid triggers the switch: warning, history save, stream fetch, player open
{
    const s = makeSandbox();
    loadModule(s);
    welcomeAndSubscribe(s);
    const sub = lastHttp(s, 'full');
    sub.success({status: 202, responseText: JSON.stringify({data: [{id: 'sub-1'}]})}, 0, '111');

    const socket = s._sockets[s._sockets.length - 1];
    socket.message({metadata: {message_type: 'notification'}, payload: {subscription: {type: 'channel.raid'}, event: raidEvent('111', 'target', 'Target')}});
    check(s._warnings.length === 1 && s._warnings[0].indexOf('Target') !== -1, 'raid shows a switching warning');
    checkEqual(s._savedPlayData(), 1, 'raid saves watch history of the raided-from stream');
    const fetch = lastHttp(s, 'get');
    check(fetch.url.indexOf('streams?user_login=target') !== -1, 'raid fetches the target stream');
    checkEqual(fetch.checkResult, s.PlayRaid_SwitchCheckId, 'stream fetch is staleness guarded');

    s._http.length = 0;
    fetch.success(JSON.stringify({data: [{user_id: '999', user_login: 'target', user_name: 'Target', title: 't', game_name: 'g'}]}), null, s.PlayRaid_SwitchCheckId);
    checkEqual(s._openStreamCount(), 1, 'switch opens the player for the target');
    checkEqual(s.Play_data.data[14], '999', 'player data now points at the target channel');
    checkEqual(s.Play_data.data[6], 'target', 'player data carries the target login');
}

//4. Target offline: warning only, no switch
{
    const s = makeSandbox();
    loadModule(s);
    welcomeAndSubscribe(s);
    const socket = s._sockets[s._sockets.length - 1];
    socket.message({metadata: {message_type: 'notification'}, payload: {subscription: {type: 'channel.raid'}, event: raidEvent('111', 'gone', 'Gone')}});
    const fetch = lastHttp(s, 'get');
    fetch.error(null, s.PlayRaid_SwitchCheckId, {status: 404});
    check(s._warnings.length === 2 && s._warnings[1].indexOf('offline') !== -1, 'offline target warns');
    checkEqual(s._openStreamCount(), 0, 'offline target does not switch');
}

//5. Guards: wrong source, duplicate raids, setting off, no token, multi and PiP
{
    const s = makeSandbox();
    loadModule(s);
    welcomeAndSubscribe(s);
    const socket = s._sockets[s._sockets.length - 1];
    socket.message({metadata: {message_type: 'notification'}, payload: {subscription: {type: 'channel.raid'}, event: raidEvent('999', 'target', 'Target')}});
    checkEqual(s._warnings.length, 0, 'raid from another channel is ignored');

    socket.message({metadata: {message_type: 'notification'}, payload: {subscription: {type: 'channel.raid'}, event: raidEvent('111', 'target', 'Target')}});
    const fetch = lastHttp(s, 'get');
    fetch.success(JSON.stringify({data: []}), null, s.PlayRaid_SwitchCheckId);
    socket.message({metadata: {message_type: 'notification'}, payload: {subscription: {type: 'channel.raid'}, event: raidEvent('111', 'target2', 'Target2')}});
    checkEqual(s._warnings.length, 2, 'only one raid is handled per stream (duplicate ignored)');
    checkEqual(s._openStreamCount(), 0, 'empty stream response does not switch');

    s.Settings_value.raid_switch.defaultValue = 0;
    s.PlayRaid_SetChannel('333');
    checkEqual(s._sockets.length, 1, 'setting off never opens a socket');
}

//6. Not logged in, multi view, PiP: no connection
{
    const s = makeSandbox();
    loadModule(s);
    s._hasToken = false;
    s.PlayRaid_SetChannel('111');
    checkEqual(s._sockets.length, 0, 'anonymous users never connect');

    s._hasToken = true;
    s.Play_MultiEnable = true;
    s.PlayRaid_SetChannel('111');
    checkEqual(s._sockets.length, 0, 'multi view never connects');
    s.Play_MultiEnable = false;
    s.PlayExtra_PicturePicture = true;
    s.PlayRaid_SetChannel('111');
    checkEqual(s._sockets.length, 0, 'picture in picture never connects');
}

//7. Close cancels reconnects; closed socket does not resurrect
{
    const s = makeSandbox();
    loadModule(s);
    welcomeAndSubscribe(s);
    s.PlayRaid_Close();
    checkEqual(s.timerCount(), 0, 'close clears pending timers');
    const socket = s._sockets[s._sockets.length - 1];
    socket.message({metadata: {message_type: 'notification'}, payload: {subscription: {type: 'channel.raid'}, event: raidEvent('111', 'target', 'Target')}});
    checkEqual(s._warnings.length, 0, 'closed follower ignores raids');

    //Remote reconnect loop: schedule a retry then close, retry must not fire
    const s2 = makeSandbox();
    loadModule(s2);
    const sock2 = welcomeAndSubscribe(s2);
    sock2.close(); //triggers onClose -> schedules reconnect
    checkEqual(s2.timerCount(), 1, 'drop schedules one reconnect');
    s2.PlayRaid_Close();
    checkEqual(s2.timerCount(), 0, 'close cancels the scheduled reconnect');
    s2.runTimers();
    checkEqual(s2._sockets.length, 1, 'cancelled reconnect never fires');
}

//8. Subscribe failure retries; 409 treated as success; 401 refreshes the token
{
    const s = makeSandbox();
    loadModule(s);
    welcomeAndSubscribe(s);
    const sub = lastHttp(s, 'full');
    sub.error && sub.error();
    checkEqual(s.timerCount(), 1, 'subscribe failure schedules one retry');
    s._http.length = 0;
    s.runTimers();
    const retry = lastHttp(s, 'full');
    checkEqual(retry.method, 'POST', 'retry subscribes again');
    retry.success({status: 409, responseText: ''}, 0, '111');
    checkEqual(s.timerCount(), 0, '409 conflict does not schedule more retries');

    const s2 = makeSandbox();
    loadModule(s2);
    welcomeAndSubscribe(s2);
    const sub2 = lastHttp(s2, 'full');
    sub2.success({status: 401, responseText: ''}, 0, '111');
    check(s2._http.indexOf('validateToken') !== -1, '401 triggers a token refresh');
}

//9. Late unsubscribe response keeps the newer subscription; subscribe attempts are capped
{
    const s = makeSandbox();
    loadModule(s);
    welcomeAndSubscribe(s);
    const sub = lastHttp(s, 'full');
    sub.success({status: 202, responseText: JSON.stringify({data: [{id: 'sub-1', condition: {from_broadcaster_user_id: '111'}}]})});
    checkEqual(s.PlayRaid_SubscriptionId, 'sub-1', 'subscription id stored');

    //Unsubscribe for sub-1 is issued, its response only lands after sub-2 was stored
    s.PlayRaid_UnsubscribeOld();
    s.PlayRaid_ChannelId = '222';
    s.PlayRaid_SubscribeSuccess({status: 202, responseText: JSON.stringify({data: [{id: 'sub-2', condition: {from_broadcaster_user_id: '222'}}]})});
    checkEqual(s.PlayRaid_SubscriptionId, 'sub-2', 'new channel subscription stored');

    s.PlayRaid_UnsubscribeSuccess();
    checkEqual(s.PlayRaid_SubscriptionId, 'sub-2', 'late unsubscribe response keeps the newer subscription id');

    //Matching pending unsubscribe still clears
    s.PlayRaid_UnsubscribeOld();
    s.PlayRaid_UnsubscribeSuccess();
    checkEqual(s.PlayRaid_SubscriptionId, null, 'on-time unsubscribe clears the subscription id');

    s._http.length = 0;
    for (let i = 0; i < 8; i++) {
        s.PlayRaid_SubscribeError();
        s.runTimers();
    }
    checkEqual(s.timerCount(), 0, 'no retry pending after repeated failures');
    checkEqual(s._http.filter(entry => entry.method === 'POST').length, 5, 'subscribe attempts capped at five');

    //A new stream gets a fresh retry budget
    s._http.length = 0;
    s.PlayRaid_SetChannel('333');
    s.PlayRaid_SubscribeError();
    checkEqual(s.timerCount(), 1, 'new channel resets the retry budget');
}

//10. Enabled follows the runtime settings convention: 'auto' is 1, never the pre-load literal 2
{
    const s = makeSandbox();
    loadModule(s);
    checkEqual(s.PlayRaid_Enabled(), true, 'runtime value 1 (auto) enables the follower');
    s.Settings_value.raid_switch.defaultValue = 0;
    checkEqual(s.PlayRaid_Enabled(), false, 'runtime value 0 (no) disables the follower');
    s.Settings_value.raid_switch.defaultValue = 2;
    checkEqual(s.PlayRaid_Enabled(), false, 'the pre-load literal 2 must not read as enabled');
}

//11. Same-channel reload (ad escape) keeps a working subscription, retries a missing one
{
    const s = makeSandbox();
    loadModule(s);
    welcomeAndSubscribe(s);
    const sub = lastHttp(s, 'full');
    sub.success({status: 202, responseText: JSON.stringify({data: [{id: 'sub-1', condition: {from_broadcaster_user_id: '111'}}]})});
    s._http.length = 0;
    s.PlayRaid_SetChannel('111');
    checkEqual(s._http.length, 0, 'same-channel reload with a live subscription does no subscribe churn');

    const s2 = makeSandbox();
    loadModule(s2);
    welcomeAndSubscribe(s2); //subscription response never arrived
    s2._http.length = 0;
    s2.PlayRaid_SetChannel('111');
    const retrySub = lastHttp(s2, 'full');
    check(retrySub && retrySub.method === 'POST', 'same-channel reload without a subscription retries the subscribe');
}

//12. Connection failures exhaust retries; a new stream start gets a fresh budget
{
    const s = makeSandbox();
    loadModule(s);
    s.PlayRaid_SetChannel('111');
    for (let i = 0; i < 6; i++) {
        s._sockets[s._sockets.length - 1].close();
        s.runTimers();
    }
    checkEqual(s.PlayRaid_Active, false, 'six connection failures deactivate the follower');
    checkEqual(s._sockets.length, 6, 'no connect attempt beyond the retry cap');

    s.PlayRaid_SetChannel('111');
    checkEqual(s.PlayRaid_Active, true, 'a new stream start reactivates the follower');
    checkEqual(s._sockets.length, 7, 'a new stream start reconnects');
    s._sockets[s._sockets.length - 1].close();
    checkEqual(s.timerCount(), 1, 'the retry budget was reset for the new stream');
}

console.log(passed + ' raid follower checks passed');
