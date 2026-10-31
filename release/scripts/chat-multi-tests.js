/* Merged YouTube/Kick chat: link resolution and (later) pollers, run against the real app files in a vm sandbox. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
// Append later files (ChatMulti.js, ChatKick.js, ChatYouTube.js) here; missing ones are skipped.
const FILES = ['ChatLink.js', 'ChatMulti.js', 'ChatKick.js', 'ChatYouTube.js', 'ChatLinkDialog.js'];
function sandbox() {
    const store = {};
    const s = {
        noop_fun: () => {}, Main_Log: () => {},
        Main_getItemJson: (key, def) => (key in store ? JSON.parse(store[key]) : def),
        Main_setItem: (key, value) => { store[key] = value; },
        FullxmlHttpGet: () => {}
    };
    vm.createContext(s);
    FILES.forEach(f => {
        const p = 'app/specific/' + f;
        if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), s, {filename: p});
    });
    s.Chat_Id = [1, 0]; s.ChatLive_selectedChannel = ['', ''];
    return {s, store};
}
const {s, store} = sandbox();
let onLinksCalls = 0;
s.ChatMulti_OnLinks = () => { onLinksCalls++; };

check(s.ChatLink_NormalizeYouTube('https://www.youtube.com/@ArcadeBulls/live') === '@arcadebulls', 'yt url handle');
check(s.ChatLink_NormalizeYouTube('arcadebulls') === '@arcadebulls' && s.ChatLink_NormalizeYouTube('@arcadebulls') === '@arcadebulls', 'yt bare handle');
check(s.ChatLink_NormalizeYouTube('youtube.com/channel/UCi41sMqhol1dxVZ7g2UUj7w') === 'UCi41sMqhol1dxVZ7g2UUj7w', 'yt channel url');
check(s.ChatLink_NormalizeYouTube('"><img>') === null && s.ChatLink_NormalizeYouTube('') === null, 'yt rejects junk');
check(s.ChatLink_NormalizeKick('https://kick.com/RobDiesALot') === 'robdiesalot' && s.ChatLink_NormalizeKick('a b') === null, 'kick slug');
var dir = {youtubeHandle: 'arcadebulls', youtubeChannelId: 'UCi41sMqhol1dxVZ7g2UUj7w', kickSlug: null};
var r = s.ChatLink_Resolve({enabled: true}, dir);
check(r.yt.value === 'UCi41sMqhol1dxVZ7g2UUj7w' && r.yt.source === 'dir' && r.kick === null, 'dir prefers channel id, null kick');
check(s.ChatLink_Resolve({enabled: true, yt: ''}, dir).yt === null, 'empty manual disables platform');
check(s.ChatLink_Resolve({enabled: true, kick: 'robdiesalot'}, null).kick.source === 'manual', 'manual works without directory');
check(s.ChatLink_Resolve({enabled: false, kick: 'x'}, dir).kick === null, 'disabled streamer links nothing');

// store round trip and default
check(s.ChatLink_Get('nobody').enabled === true, 'default entry enabled');
s.ChatLink_Save('robdiesalot', {enabled: true, kick: 'abc'});
check(s.ChatLink_Get('robdiesalot').kick === 'abc' && JSON.parse(store.chat_links).robdiesalot.kick === 'abc', 'save and get');

// Review Focus 4: errors are not cached
s.Chat_Id = [7, 0]; s.ChatLive_selectedChannel = ['robdiesalot', ''];
s.ChatLink_LookupResult({status: 0, responseText: ''}, 0, 7);
check(!('robdiesalot' in s.ChatLink_DirCache) && onLinksCalls === 1, 'network error: not cached, links still resolved');
s.ChatLink_LookupResult({status: 200, responseText: '<html>'}, 0, 7);
check(!('robdiesalot' in s.ChatLink_DirCache) && onLinksCalls === 2, 'invalid json: treated as network error');
s.ChatLink_LookupResult({status: 404, responseText: '{}'}, 0, 7);
check(s.ChatLink_DirCache.robdiesalot === null, '404 cached as not found');
s.ChatLink_LookupResult({status: 200, responseText: '{"ok":true,"found":true,"streamer":{"kickSlug":"robdiesalot"}}'}, 0, 6);
check(s.ChatLink_DirCache.robdiesalot === null, 'stale generation ignored');
s.ChatLink_LookupResult({status: 200, responseText: '{"ok":true,"found":true,"streamer":{"kickSlug":"robdiesalot"}}'}, 0, 7);
check(s.ChatLink_DirCache.robdiesalot.kickSlug === 'robdiesalot', '200 found cached');

// cache hit resolves immediately, no request
var requests = 0; s.FullxmlHttpGet = () => { requests++; };
var before = onLinksCalls;
s.ChatLink_Lookup(0, 7);
check(requests === 0 && onLinksCalls === before + 1, 'cache hit calls OnLinks without request');
s.ChatLive_selectedChannel = ['other', '']; s.ChatLink_Lookup(0, 7);
check(requests === 1, 'cache miss requests directory');
check(s.ChatLink_Current(0).kick === null, 'current resolves for channel without entry');

// FullxmlHttpGet: omitted Method/postMessage must reach the native bridge as null, not undefined
{
    const src = fs.readFileSync('app/specific/Main.js', 'utf8');
    const start = src.indexOf('function FullxmlHttpGet(');
    const body = src.slice(start, src.indexOf('function Main_CheckFullxmlHttpGet'));
    let args = null;
    const x = {Main_IsOn_OSInterface: true, DefaultHttpGetTimeout: 1, OSInterface_BaseXmlHttpGet: function () { args = Array.prototype.slice.call(arguments); }};
    vm.createContext(x); vm.runInContext(body, x);
    function cb() {}
    x.FullxmlHttpGet('u', null, cb, cb, 0, 1);
    check(args[2] === null && args[3] === null, 'FullxmlHttpGet: omitted postMessage and Method are null for native bridge');
    x.FullxmlHttpGet('u', null, cb, cb, 0, 1, 'POST', 'body');
    check(args[2] === 'body' && args[3] === 'POST', 'FullxmlHttpGet: explicit POST and body pass through');
}

// Core (ChatMulti.js) on the real ChatLive line pipeline, stubs as in chat-optimization-tests.js
function coreSandbox() {
    const s = {
        Date, noop_fun: () => {}, Main_Log: () => {}, FullxmlHttpGet: () => {},
        Main_setTimeout: () => 0, Main_clearTimeout: () => {}, Main_clearInterval: () => {},
        Main_getItemJson: (key, def) => def, Main_setItem: () => {}, Main_emptyWithEle: () => {},
        Main_A_equals_B: (a, b) => a === b, Main_A_includes_B: (a, b) => String(a).indexOf(b) !== -1,
        Main_AddClassWithEle: (el, c) => el.classes.add(c), Main_RemoveClassWithEle: (el, c) => el.classes.delete(c),
        Main_clock_H_M: '12:00', Play_ChatDelayPosition: 0, STR_BR: '<br>', STR_CHAT_MESSAGE_DELETED_ALL: 'deleted',
        Settings_value: {chat_multi: {defaultValue: 1}, disabled_shared: {defaultValue: 0}}
    };
    vm.createContext(s);
    const screens = fs.readFileSync('app/specific/Screens.js', 'utf8');
    const esc = screens.indexOf('function Screens_AriaEscape(');
    vm.runInContext(screens.slice(esc, screens.indexOf('\n}', esc) + 2), s);
    ['thirdparty/punycode.js', 'thirdparty/twemoji.js', 'thirdparty/kapchat.js', 'specific/ChatVod.js', 'specific/ChatLive.js', 'specific/ChatLink.js']
        .concat(FILES.slice(1).map(f => 'specific/' + f))
        .forEach(f => {
            const p = 'app/' + f;
            if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), s, {filename: p});
        });
    s.ChatLive_resetChatters = () => {};
    s.Chat_div = [{classes: new Set()}, {classes: new Set()}];
    s.Chat_Id = [7, 0];
    s.extraEmotes[0] = {}; s.extraEmotes[1] = {};
    s.ChatLive_selectedChannel = ['streamer', ''];
    s.ChatLive_Channel_Regex_Search[0] = /@streamer(?=\s|$)/i;
    return s;
}
{
    const s = coreSandbox();
    const lines = [];
    let stopCalls = 0;
    const started = [];
    s.ChatLive_LineAddCheckDelay = (n, m) => lines.push(m);
    s.ChatKick_Stop = s.ChatYouTube_Stop = () => stopCalls++;
    s.ChatKick_Start = (n, id, slug, withHistory) => started.push('kick:' + id + ':' + slug + ':' + withHistory);
    s.ChatYouTube_Start = (n, id, target, withHistory) => started.push('yt:' + id + ':' + target + ':' + withHistory);
    const msgWithId = id => ({platform: 'yt', msgId: id, authorId: 'UC1', nick: 'bob', color: null, role: '', badges: '',
        tokens: ['hi'], text: 'hi', ts: 1, history: false, special: null, highlight: null});

    // every rendered line needs a live session seq; seqs start above any Chat_Id so a seq / id mixup fails
    s.ChatMulti_Seq = 100;
    s.ChatMulti_Start(0, 7, true);
    let seq = s.ChatMulti_State[0].seq;

    // Review Focus 1
    s.ChatLive_Custom_Nick_Color = 0;
    s.ChatMulti_Line(0, seq, {platform: 'kick', msgId: 'a"b', authorId: '1 2', nick: '"><img src=x onerror=1>', color: 'red;x:url(y)',
        role: '', badges: '', tokens: ['<script>x</script>'], text: 't', ts: 1, history: false, special: null, highlight: null});
    var html = lines.pop().message;
    check(html.indexOf('<img src=x') === -1 && html.indexOf('<script>') === -1 && html.indexOf('url(y)') === -1, 'foreign line is escaped');
    check(/id="kick_ab"/.test(html) && /class="kick_12 message"/.test(html), 'ids sanitized and prefixed');
    check(html.indexOf('<span class="tag chat_pi chat_pi_kick"></span>') !== -1, 'foreign line has its platform icon');
    check(s.ChatMulti_SafeUrl('https://evil.example/x.png', /^yt3\.ggpht\.com$/) === null, 'foreign host rejected');
    check(s.ChatMulti_SafeUrl('https://yt3.ggpht.com/a=s64-c-k', /^yt3\.ggpht\.com$/) === 'https://yt3.ggpht.com/a=s64-c-k', 'allowed host accepted');
    check(s.ChatMulti_SafeUrl("https://yt3.ggpht.com/a');alert(1)//", /^yt3\.ggpht\.com$/) === null &&
        s.ChatMulti_SafeUrl('http://yt3.ggpht.com/a', /^yt3\.ggpht\.com$/) === null &&
        s.ChatMulti_SafeUrl('https://yt3.ggpht.com.evil.example/a', /^yt3\.ggpht\.com$/) === null, 'quote, http and host suffix rejected');
    // colors
    check(s.ChatMulti_NickStyle('kick', 'bob', '#00ff00', '') === 'style="color: #00ff00;"', 'own color when readable off');
    check(s.ChatMulti_NickStyle('yt', 'bob', null, 'mod') === 'style="color: #5e84f1;"', 'youtube role color');
    s.ChatLive_Custom_Nick_Color = 1;
    check(s.ChatMulti_NickStyle('yt', 'bob', null, 'owner') === 'style="color: ' + s.defaultColors['b'.charCodeAt(0) % s.defaultColorsLength] + ';"', 'readable palette overrides roles');
    // dedupe
    s.ChatMulti_Line(0, seq, msgWithId('x1')); s.ChatMulti_Line(0, seq, msgWithId('x1'));
    check(lines.length === 1, 'same platform message shown once');
    // Review Focus 2: stale generation
    s.ChatMulti_Line(0, seq - 1, msgWithId('x2')); check(lines.length === 1, 'stale session dropped');

    // highlights follow the Twitch settings and order
    s.ChatLive_Highlight_AtStreamer = 1; s.ChatLive_Highlight_Mod = 1;
    s.ChatMulti_Line(0, seq, Object.assign(msgWithId('x3'), {tokens: ['@streamer', 'hi'], text: '@streamer hi', role: 'mod'}));
    var obj = lines.pop();
    check(obj.atstreamer && !obj.mod && obj.nick === 'bob' && obj.message.indexOf('#4eff42') !== -1, 'mention of the Twitch login highlights first');
    s.ChatMulti_Line(0, seq, Object.assign(msgWithId('x4'), {role: 'mod'}));
    check(lines.pop().mod, 'moderator highlight');
    s.ChatLive_Highlight_AtStreamer = 0; s.ChatLive_Highlight_Mod = 0;
    // special lines follow show_sub
    s.ChatLive_Show_SUB = 0;
    s.ChatMulti_Line(0, seq, Object.assign(msgWithId('x5'), {special: 'SC $5', highlight: '#1565c0'}));
    check(lines.length === 1, 'special line hidden when subs are hidden');
    s.ChatLive_Show_SUB = 1;
    s.ChatMulti_Line(0, seq, Object.assign(msgWithId('x6'), {special: 'SC $5', highlight: '#1565c0'}));
    obj = lines.pop();
    check(obj.sub && obj.message.indexOf('SC $5') !== -1 && obj.message.indexOf('background-color: #1565c0') !== -1 && obj.message.indexOf('hi') !== -1, 'special line with header, body and background');
    s.ChatMulti_Line(0, seq, Object.assign(msgWithId('x7'), {highlight: 'red;x:url(y)'}));
    check(lines.pop().message.indexOf('url(y)') === -1, 'invalid highlight dropped');
    // history line keeps its time for the ordered insert
    s.ChatMulti_Line(0, seq, Object.assign(msgWithId('x8'), {history: true, ts: 1234}));
    obj = lines.pop();
    check(obj.addToStart && obj.historyTs === 1234, 'foreign history carries its time');
    // moderation
    let target = null;
    s.Main_getElementById = id => { target = id; return null; };
    s.ChatMulti_DeleteMsg('yt', 'a"b');
    check(target === 'yt_ab', 'delete message targets the prefixed id');
    s.Chat_div[0].getElementsByClassName = c => { target = c; return []; };
    s.ChatMulti_DeleteAuthor(0, 'kick', '1 2');
    check(target === 'kick_12', 'delete author targets the prefixed class');

    // lifecycle: links start the sources and mark the chat
    s.Main_getItemJson = (key, def) => (key === 'chat_links' ? {streamer: {enabled: true, kick: 'kickslug', yt: ''}} : def);
    s.ChatMulti_Start(0, 7, true);
    s.ChatMulti_OnLinks(0, 6);
    check(started.length === 0, 'stale links ignored');
    seq = s.ChatMulti_State[0].seq;
    s.ChatMulti_OnLinks(0, 7); s.ChatMulti_OnLinks(0, 7);
    check(started.join() === 'kick:' + seq + ':kickslug:true' && s.Chat_div[0].classes.has('chat_linked'), 'links start sources once, with the session seq, and mark the chat');
    s.ChatMulti_Stop(0); s.ChatMulti_OnLinks(0, 7);
    check(started.length === 1 && !s.Chat_div[0].classes.has('chat_linked'), 'stop unmarks and ignores late links');
    // Ruling 8: the session seq drops lines of a stopped or restarted session even when Chat_Id did not change
    let n = lines.length;
    s.ChatMulti_Start(0, 7, true); let oldSeq = s.ChatMulti_State[0].seq;
    s.ChatMulti_Stop(0); s.ChatMulti_Line(0, oldSeq, msgWithId('s1'));
    check(lines.length === n, 'stopped session renders nothing');
    s.ChatMulti_Start(0, 7, true); oldSeq = s.ChatMulti_State[0].seq;
    s.ChatMulti_Restart(0); const newSeq = s.ChatMulti_State[0].seq;
    s.ChatMulti_Line(0, oldSeq, msgWithId('s2'));
    check(lines.length === n && newSeq !== oldSeq && s.ChatMulti_State[0].withHistory === false, 'restart drops the old session, no history');
    s.ChatMulti_Line(0, newSeq, msgWithId('s3'));
    check(lines.length === n + 1, 'restarted session renders');
    check(s.ChatMulti_IsActive(0, newSeq), 'current session is active');
    s.Chat_Id[0] = 8;
    check(!s.ChatMulti_IsActive(0, newSeq), 'session inactive after Chat_Id changes');
    s.Chat_Id[0] = 7;
    s.Settings_value.chat_multi.defaultValue = 0;
    var requests = 0; s.FullxmlHttpGet = () => requests++;
    s.ChatMulti_Start(0, 7, true);
    check(requests === 0, 'setting off: no lookup');
    s.Settings_value.chat_multi.defaultValue = 1;
    s.FullxmlHttpGet = () => {};

    // Review Focus 3
    s.ChatMulti_Start(0, 7, true); var stops = stopCalls; s.ChatLive_Close(0);
    check(stopCalls === stops, 'IRC reconnect does not stop foreign sources');
    s.ChatLive_Clear(0); check(stopCalls > stops, 'full clear stops foreign sources');

    // Review Focus 5: history insert order (fake DOM nodes with firstChild/nextSibling/insertBefore/appendChild)
    const node = name => ({name, nextSibling: null});
    const fakeBox = names => {
        const kids = names.map(node);
        const box = {kids, firstChild: null};
        const relink = () => { kids.forEach((k, i) => (k.nextSibling = kids[i + 1] || null)); box.firstChild = kids[0] || null; };
        box.appendChild = n => { kids.push(n); relink(); };
        box.insertBefore = (n, ref) => { if (!ref) return box.appendChild(n); kids.splice(kids.indexOf(ref), 0, n); relink(); };
        relink();
        return box;
    };
    const order = box => box.kids.map(k => k.name);
    var box = fakeBox(['live-1']);
    s.ChatLive_HistoryInsert(box, node('tw-30'), 30); s.ChatLive_HistoryInsert(box, node('tw-10'), 10);
    s.ChatLive_HistoryInsert(box, node('yt-20'), 20);
    check(order(box).join() === 'tw-10,yt-20,tw-30,live-1', 'late history interleaves by time before live lines');
    s.ChatLive_HistoryInsert(box, node('old-no-ts'));
    check(order(box)[0] === 'old-no-ts', 'history without time goes to the top as before');
    box = fakeBox([]);
    s.ChatLive_HistoryInsert(box, node('only'), 5);
    check(order(box).join() === 'only', 'timed insert into an empty chat');

    // Twitch wiring: icon on every line, history time from tmi-sent-ts, ElementAdd uses the ordered insert
    s.Chat_Id[0] = 7;
    s.ChatLive_loadChatSuccess({tags: {'display-name': 'Viewer', 'tmi-sent-ts': '1500', color: '#ff0000'}, params: ['#streamer', 'hello']}, 0, true);
    obj = lines.pop();
    check(obj.historyTs === 1500 && obj.message.indexOf('chat_pi_tw') !== -1, 'twitch history line has icon and time');
    s.ChatLive_loadChatSuccess({tags: {'display-name': 'Viewer', 'tmi-sent-ts': '1500'}, params: ['#streamer', 'live']}, 0, false);
    check(lines.pop().historyTs === 0, 'live twitch line has no history time');
    s.ChatLive_CheckIfSubSend('sub!', 0, true);
    check(lines.pop().message.indexOf('<span class="message"><span class="tag chat_pi chat_pi_tw"></span>sub!') === 0, 'twitch sub line has icon');
    s.document = {createElement: () => ({set innerHTML(v) { this.firstChild = {}; }, name: 'holder'})};
    s.Chat_div[0] = fakeBox(['h-10', 'live-1']);
    s.Chat_div[0].kids[0].chatTs = 10;
    s.ChatLive_ElementAdd({chat_number: 0, message: 'm', addToStart: true, historyTs: 20, extraMessage: 'x'});
    check(s.Chat_div[0].kids.map(k => k.chatTs || 0).join() === '10,20,20,0', 'ElementAdd inserts history and its extra line by time');
}

// Kick source (ChatKick.js) with fixtures from the device probe
{
    const s = coreSandbox();
    const lines = [], sockets = [], xhrs = [], http = [], timers = [], cleared = [], deleted = [], banned = [];
    const json = f => JSON.parse(fs.readFileSync('jsonreferences/' + f, 'utf8'));
    const hist = json('kick_history.json'), chan = json('kick_channel.json'), events = json('kick_pusher_events.json');
    s.STR_CHAT_KICK_SUB = 'subscribed for %x months'; s.STR_CHAT_KICK_GIFT = 'gifted %x subscriptions';
    s.ChatLive_LineAddCheckDelay = (n, m) => lines.push(m);
    s.ChatLive_Show_SUB = 1; s.ChatLive_Custom_Nick_Color = 0;
    s.FullxmlHttpGet = (url, h, ok, err, key, check) => /lookup/.test(url) || http.push({url, ok: ok.name, key, check});
    s.Main_setTimeout = (fn, d) => { timers.push({fn, d}); return timers.length; };
    s.Main_clearTimeout = id => cleared.push(id);
    s.ChatMulti_DeleteMsg = (p, id) => deleted.push(p + ':' + id);
    s.ChatMulti_DeleteAuthor = (n, p, id) => banned.push(n + ':' + p + ':' + id);
    s.WebSocket = function (url) { this.url = url; this.sent = []; this.closed = null; sockets.push(this); };
    s.WebSocket.prototype.send = function (d) { this.sent.push(JSON.parse(d)); };
    s.WebSocket.prototype.close = function (c) { this.closed = c; };
    s.XMLHttpRequest = function () { xhrs.push(this); };
    s.XMLHttpRequest.prototype.open = function (m, u) { this.url = u; };
    s.XMLHttpRequest.prototype.send = function () {};
    s.XMLHttpRequest.prototype.reply = function (status, text) { this.readyState = 4; this.status = status; this.responseText = text; this.onreadystatechange(); };
    const start = (id, slug, withHistory) => { s.ChatMulti_Start(0, id, withHistory); const seq = s.ChatMulti_State[0].seq; s.ChatKick_Start(0, seq, slug, withHistory); return seq; };
    const frame = (ws, ev, data, channel) => ws.onmessage({data: JSON.stringify({event: ev, data: typeof data === 'string' ? data : JSON.stringify(data), channel})});
    const V2 = 'chatrooms.32806.v2';
    s.ChatMulti_SetLinked = () => {};

    // pure helpers
    var m = s.ChatKick_ToMsg(hist.data.messages[0], [], true);
    check(m.platform === 'kick' && m.history === true && m.ts === Date.parse(hist.data.messages[0].created_at), 'kick history message maps with timestamp');
    var t = s.ChatKick_Tokens('hi [emote:37226:KEKW] there [emote:x:bad]');
    check(t[1][0].indexOf('https://files.kick.com/emotes/37226/fullsize') !== -1 && t.join('').indexOf('[emote:x:bad]') !== -1, 'numeric emote ids only');
    check(s.ChatKick_SubBadgeUrl([{months: 1, badge_image: {src: 'https://files.kick.com/a.png'}}, {months: 6, badge_image: {src: 'https://files.kick.com/b.png'}}], 10) === 'https://files.kick.com/b.png', 'best sub badge');
    check(s.ChatKick_SubBadgeUrl([{months: 6, badge_image: {src: 'https://files.kick.com/b.png'}}], 3) === null, 'no sub badge above the months');
    var b = s.ChatKick_Badges({badges: [{type: 'moderator'}], badges_v2: [{image_url: 'https://evil.example/x.png', selected: true}]}, []);
    check(b.role === 'mod' && b.html.indexOf('evil.example') === -1 && b.html.indexOf('chat_b_kick_moderator') !== -1, 'role badge, foreign badge host dropped');
    b = s.ChatKick_Badges({badges: [{type: 'broadcaster'}, {type: 'subscriber', count: 3}], badges_v2: [{name: 'level', image_url: 'https://ext.cdn.kick.com/chat/badges/40_a.png', selected: true}, {name: 'x', image_url: 'https://ext.cdn.kick.com/y.png', selected: false}]},
        [{months: 1, badge_image: {src: 'https://files.kick.com/s.png'}}]);
    check(b.role === 'owner' && b.html.indexOf('files.kick.com/s.png') !== -1 && b.html.indexOf('40_a.png') !== -1 && b.html.indexOf('y.png') === -1, 'owner, sub image and selected kick badge');
    check(s.ChatKick_EventName('App\\Events\\ChatMessageEvent') === 'ChatMessageEvent' && s.ChatKick_EventName('RewardRedeemedEvent') === 'RewardRedeemedEvent', 'event prefix stripped');
    var ev = (n, i) => events.filter(e => s.ChatKick_EventName(e.event) === n).map(e => JSON.parse(e.data))[i || 0];
    var d = s.ChatKick_EventToMsg('MessageDeletedEvent', ev('MessageDeletedEvent'));
    check(d.del === ev('MessageDeletedEvent').message.id, 'deleted event gives the message id');
    d = s.ChatKick_EventToMsg('UserBannedEvent', ev('UserBannedEvent'));
    check(d.ban === ev('UserBannedEvent').user.id, 'banned event gives the user id');
    check(s.ChatKick_EventToMsg('RewardRedeemedEvent', ev('RewardRedeemedEvent')) === null, 'reward redeemed ignored');
    var reply = events.map(e => JSON.parse(e.data || '{}')).filter(x => x.type === 'reply')[0];
    check(s.ChatKick_EventToMsg('ChatMessageEvent', reply).platform === 'kick', 'reply renders as a normal message');
    // shape not yet seen live: hand-built per spec 6.2 point 6
    m = s.ChatKick_EventToMsg('SubscriptionEvent', {username: '"><img src=x onerror=1>', months: 3});
    check(m.special.indexOf('<img') === -1 && m.special.indexOf('subscribed for 3 months') !== -1 && !m.history, 'sub event: escaped special line');
    m = s.ChatKick_EventToMsg('GiftedSubscriptionsEvent', {gifter_username: 'Bob', gifted_usernames: ['a', 'b', 'c']});
    check(m.special === 'Bob gifted 3 subscriptions', 'gift event: special line with the count');
    check(s.ChatKick_EventToMsg('SubscriptionEvent', {months: 3}) === null && s.ChatKick_EventToMsg('Nope', {}) === null, 'bad event shapes give null');

    // start: channel by XHR, then key, then socket
    var seq = start(7, 'buddha', true);
    check(xhrs[0].url === 'https://kick.com/api/v2/channels/buddha', 'channel info by XHR');
    xhrs[0].reply(200, JSON.stringify(chan));
    check(xhrs[1].url === 'https://kick.com/api/v2/channels/32807/messages', 'history uses the channel id, not the chatroom id');
    check(http.length === 1 && http[0].url === 'https://api.jouki.cz/kick/realtime' && http[0].ok === 'ChatKick_KeyResult' && http[0].check === seq && http[0].key === 0, 'key by FullxmlHttpGet with named callback and session seq');
    s.ChatKick_KeyResult({status: 500, responseText: ''}, 0, seq - 1);
    check(sockets.length === 0, 'stale key result ignored');
    s.ChatKick_KeyResult({status: 200, responseText: '{"ok":true,"key":"<bad>","cluster":"us2"}'}, 0, seq);
    check(sockets.length === 1 && sockets[0].url.indexOf('/app/34bf7a0ff419a2a775b9?') !== -1 && sockets[0].url.indexOf('ws-us2.pusher.com') !== -1, 'invalid key shape uses the fallback');
    var ws = sockets[0];
    frame(ws, 'pusher:connection_established', {socket_id: '1.2', activity_timeout: 120});
    check(ws.sent.map(x => x.data.channel).join() === V2 + ',chatroom_32806', 'subscribes both channels');
    frame(ws, 'pusher:ping', {});
    check(ws.sent[2].event === 'pusher:pong', 'ping answered with pong');

    // history: lines with history flag and time
    xhrs[1].reply(200, JSON.stringify(hist));
    check(lines.length === hist.data.messages.length && lines[0].addToStart && lines[0].historyTs > 0, 'history rendered with time');
    var n = lines.length;
    // live: the real events, remapped to our chatroom
    events.forEach(e => { if (e.channel) frame(ws, e.event, e.data, /v2$/.test(e.channel) ? V2 : e.channel.replace(/\d+/, '32806')); });
    var liveMsgs = events.filter(e => /ChatMessageEvent/.test(e.event) && /v2$/.test(e.channel)).length;
    check(liveMsgs > 0 && lines.length > n && lines.length <= n + liveMsgs, 'live messages render once each');
    check(deleted.length >= 1 && deleted[0].indexOf('kick:') === 0 && banned.length >= 1 && /^0:kick:\d+$/.test(banned[0]), 'moderation events are forwarded');
    n = lines.length;
    frame(ws, 'App\\Events\\ChatMessageEvent', JSON.stringify(reply), 'chatroom_32806');
    frame(ws, 'App\\Events\\ChatMessageEvent', JSON.stringify(reply), 'chatrooms.999.v2');
    check(lines.length === n, 'chat message only from our .v2 channel');
    frame(ws, 'App\\Events\\SubscriptionEvent', {username: 'Ann', months: 2}, 'chatroom_32806');
    frame(ws, 'App\\Events\\SubscriptionEvent', {username: 'Ann', months: 2}, V2);
    check(lines.length === n + 1 && lines[n].sub, 'sub on both channels shows once');
    frame(ws, 'pusher:subscription_garbage', '{bad json');
    ws.onmessage({data: '<html>'});

    // reconnect: backoff, 4001 drops the key and fetches it again
    ChatKickBackoff();
    function ChatKickBackoff() {
        s.ChatKick_Key = {key: 'abcdef0123456789abcd', cluster: 'eu'};
        ws.onclose({code: 1006});
        var delays = [timers[timers.length - 1].d];
        timers[timers.length - 1].fn();
        sockets[sockets.length - 1].onclose({code: 1006});
        delays.push(timers[timers.length - 1].d);
        check(delays.join() === '2000,4000', 'reconnect backoff doubles from 2 s');
        check(sockets[sockets.length - 1].url.indexOf('ws-eu.pusher.com/app/abcdef0123456789abcd?') !== -1, 'good key is cached for reconnects');
    }
    var before = http.length;
    timers[timers.length - 1].fn();
    sockets[sockets.length - 1].onclose({code: 4001});
    check(s.ChatKick_Key === null, 'error 4001 drops the key');
    timers[timers.length - 1].fn();
    check(http.length === before + 1 && http[http.length - 1].url === 'https://api.jouki.cz/kick/realtime', 'key is fetched again after 4001');
    for (var i = 0; i < 10; i++) { s.ChatKick_Key = s.ChatKick_PusherFallback; timers[timers.length - 1].fn(); sockets[sockets.length - 1].onclose({code: 1006}); }
    check(timers[timers.length - 1].d === 60000, 'backoff is capped at 60 s');

    // stop: socket closed without reconnect, timers cleared, late frames ignored
    timers[timers.length - 1].fn();
    ws = sockets[sockets.length - 1];
    n = lines.length;
    var lateHandler = ws.onmessage;
    check(typeof lateHandler === 'function', 'socket had a message handler before stop');
    s.ChatMulti_Stop(0);
    check(ws.closed === 1000 && ws.onclose === null && cleared.length > 0, 'stop closes the socket with 1000, no reconnect handler, clears the timer');
    var timersBefore = timers.length;
    lateHandler({data: JSON.stringify({event: 'App\\Events\\ChatMessageEvent', data: JSON.stringify(reply), channel: V2})});
    check(lines.length === n && timers.length === timersBefore, 'nothing happens after stop');

    // reconnect timer of a stale session (Chat_Id changed, no Stop) does nothing
    {
        var seqS = start(7, 'buddha', false);
        xhrs[xhrs.length - 1].reply(200, JSON.stringify(chan));
        s.ChatKick_Key = s.ChatKick_PusherFallback; s.ChatKick_KeyResult({status: 200, responseText: '{}'}, 0, seqS);
        var wsS = sockets[sockets.length - 1];
        wsS.onclose({code: 1006});
        var timerS = timers[timers.length - 1], sc = sockets.length, hc = http.length;
        s.ChatKick_Key = null; s.Chat_Id[0] = 8;
        timerS.fn();
        s.Chat_Id[0] = 7;
        check(sockets.length === sc && http.length === hc, 'stale reconnect timer opens nothing');
        s.ChatMulti_Stop(0);
    }
    // Kick tokens through the real tokenizer: the word after an emote survives
    {
        var tok = s.ChatLive_extraMessageTokenize(s.ChatKick_Tokens('hi [emote:37226:KEKW] there friend'), 0, 0);
        check(/<img[^>]*> there friend/.test(tok), 'word after emote survives');
        tok = s.ChatLive_extraMessageTokenize(s.ChatKick_Tokens('[emote:37226:KEKW] yelling in texts aswell'), 0, 0);
        check(tok.indexOf('yelling in texts aswell') !== -1, 'fixture style message keeps its first word');
        tok = s.ChatLive_extraMessageTokenize(s.ChatKick_Tokens('a [emote:1:x][emote:2:y]b'), 0, 0);
        check(/>\s*b/.test(tok), 'text glued to an emote survives');
    }

    // Review Focus 2: restart closes the previous socket, stale XHR / native results are ignored
    s.ChatKick_Key = s.ChatKick_PusherFallback;
    var sCount = sockets.length, xCount = xhrs.length;
    var seq1 = start(7, 'robdiesalot', false);
    var xhr1 = xhrs[xCount];
    xhr1.reply(200, JSON.stringify(chan));
    var ws1 = sockets[sCount];
    var seq2 = start(7, 'xqc', false);
    check(ws1.closed === 1000 && seq2 !== seq1, 'restart closes previous socket');
    xhrs[xCount].reply(200, JSON.stringify(chan));
    check(sockets.length === sCount + 1, 'stale channel response does not connect');
    // channel XHR blocked: native fallback with named callback, later stale native result ignored
    var xhr3 = xhrs[xCount + 1];
    var hCount = http.length;
    xhr3.reply(0, '');
    check(http.length === hCount + 1 && http[hCount].ok === 'ChatKick_ChannelNative' && http[hCount].url === 'https://kick.com/api/v2/channels/xqc' && http[hCount].check === seq2, 'blocked XHR falls back to native with the seq');
    s.ChatKick_ChannelNative({status: 200, responseText: JSON.stringify(chan)}, 0, seq1);
    check(sockets.length === sCount + 1, 'stale native channel result ignored');
    s.ChatKick_ChannelNative({status: 200, responseText: JSON.stringify(chan)}, 0, seq2);
    check(sockets.length === sCount + 2, 'native channel result connects');
    // failures are silent
    var l = lines.length; start(7, 'x y', false); start(7, 'ok', false);
    xhrs[xhrs.length - 1].reply(500, 'err'); xhrs[xhrs.length - 1].reply(200, '<html>');
    check(lines.length === l, 'failures add nothing to the chat');
    s.ChatMulti_Stop(0);
}

// YouTube source (ChatYouTube.js) with fixtures from the device probe
{
    const s = coreSandbox();
    const lines = [], http = [], timers = [], deleted = [], banned = [];
    const json = f => JSON.parse(fs.readFileSync('jsonreferences/' + f, 'utf8'));
    const acts = json('youtube_chat_initial_actions.json'), polls = json('youtube_get_live_chat.json');
    s.STR_CHAT_YT_SUPERCHAT = 'Super Chat'; s.STR_CHAT_YT_SUPERSTICKER = 'Super Sticker'; s.STR_CHAT_YT_MEMBERSHIP = 'New member'; s.STR_CHAT_YT_GIFT = 'gifted memberships';
    s.ChatLive_LineAddCheckDelay = (n, m) => lines.push(m);
    s.ChatLive_Show_SUB = 1; s.ChatLive_Custom_Nick_Color = 0;
    s.FullxmlHttpGet = (url, headers, ok, err, key, check, method, body) => /lookup/.test(url) || http.push({url, headers, ok: ok.name, key, check, method, body});
    s.Main_setTimeout = (fn, d) => { timers.push({fn, d, live: true}); return timers.length - 1; };
    s.Main_clearTimeout = id => { if (timers[id]) timers[id].live = false; };
    s.ChatMulti_DeleteMsg = (p, id) => deleted.push(p + ':' + id);
    s.ChatMulti_DeleteAuthor = (n, p, id) => banned.push(n + ':' + p + ':' + id);
    s.ChatMulti_SetLinked = () => {};
    const pending = () => timers.filter(x => x.live).length;
    const fire = () => { const t = timers.filter(x => x.live).pop(); t.live = false; t.fn(); return t; };
    const start = (target, withHistory) => { s.ChatMulti_Start(0, 7, withHistory); const seq = s.ChatMulti_State[0].seq; s.ChatYouTube_Start(0, seq, target, withHistory); return seq; };
    const reset = () => { lines.length = http.length = timers.length = deleted.length = banned.length = 0; };
    const first = f => acts.filter(a => a.addChatItemAction && a.addChatItemAction.item[f])[0].addChatItemAction.item;
    const LIVE = '"isLiveNow":true,"videoId":"-a9764YAN_8"';

    check(s.ChatYouTube_LiveUrl('UCROnsopSryzM2WaxxeNICOA') === 'https://www.youtube.com/channel/UCROnsopSryzM2WaxxeNICOA/live' && s.ChatYouTube_LiveUrl('@robdiesalot') === 'https://www.youtube.com/@robdiesalot/live', 'live urls');
    check(s.ChatYouTube_ParseLive('..."isLiveNow":true..."videoId":"-a9764YAN_8"...') === '-a9764YAN_8', 'live detected');
    check(s.ChatYouTube_ParseLive('..."isLive":true..."videoId":"-a9764YAN_8"...') === '-a9764YAN_8', 'second live marker works');
    check(s.ChatYouTube_ParseLive('..."videoId":"-a9764YAN_8"...') === null, 'not live without marker');

    // fixtures: history, ms timestamps, every renderer type is handled or ignored
    var msgs = acts.map(a => a.addChatItemAction && s.ChatYouTube_ToMsg(a.addChatItemAction.item, true)).filter(Boolean);
    check(msgs.length > 0 && msgs.every(m => m.history && m.ts > 1.7e12 && typeof m.ts === 'number'), 'initial actions become history with ms timestamps');
    check(msgs.filter(m => m.special).length === 2 && msgs.length === 74, 'text messages and the two gift view models render, banner does not');
    var gift = msgs.filter(m => m.special)[0];
    check(/savetoad521/.test(gift.special) && gift.special.indexOf('<') === -1, 'gift view model: escaped author and text');
    check(s.ChatYouTube_ToMsg({giftMessageViewModel: {id: 'g', text: {content: 'x'}}}, false) === null && s.ChatYouTube_ToMsg({giftMessageViewModel: {id: 'g', authorName: {content: 'a'}, text: {content: ' '}}}, false) === null, 'gift without author or text is ignored');
    check(s.ChatYouTube_ToMsg({liveChatViewerEngagementMessageRenderer: {id: 'x'}}, false) === null && s.ChatYouTube_ToMsg(first('liveChatViewerEngagementMessageRenderer'), true) === null, 'system banner ignored');
    var removed = acts.filter(a => a.removeChatItemAction)[0];
    check(s.ChatYouTube_Moderation(removed).del === removed.removeChatItemAction.targetItemId && s.ChatYouTube_Moderation(acts.filter(a => a.liveChatReportModerationStateCommand)[0]) === null, 'removeChatItemAction deletes, report state command ignored');
    check(s.ChatYouTube_Moderation({markChatItemAsDeletedAction: {targetItemId: 'm1'}}).del === 'm1', 'delete action');
    check(s.ChatYouTube_Moderation({markChatItemsByAuthorAsDeletedAction: {externalChannelId: 'UCx'}}).ban === 'UCx', 'ban action'); // shape not yet seen live
    check(s.ChatYouTube_Moderation({something: 1}) === null, 'unknown action ignored');

    // emoji: the fixture uses fonts.gstatic.com (not whitelisted), the unicode emoji is used instead of an image from there
    var emojiMsg = acts.map(a => a.addChatItemAction && a.addChatItemAction.item.liveChatTextMessageRenderer).filter(r => r && r.message.runs.some(x => x.emoji))[0];
    var tk = s.ChatYouTube_Tokens(emojiMsg.message.runs);
    check(tk.join('').indexOf('fonts.gstatic.com') === -1 && tk.join('').indexOf('🎃') !== -1, 'notoemoji host is not whitelisted, unicode emoji used');
    var tok = s.ChatYouTube_Tokens([{text: 'a'}, {emoji: {image: {thumbnails: [{url: 'https://evil.example/e.png'}]}, shortcuts: [':x:']}}]);
    check(tok.join('').indexOf('evil.example') === -1 && tok.join('').indexOf(':x:') !== -1, 'emoji from foreign host falls back to shortcut');
    tok = s.ChatYouTube_Tokens([{emoji: {image: {thumbnails: [{url: 'https://yt3.ggpht.com/a=w24-h24'}, {url: '//yt3.ggpht.com/b=w48-h48'}]}, shortcuts: [':x:']}}]);
    check(tok.length === 1 && Array.isArray(tok[0]) && tok[0][0].indexOf('src="https://yt3.ggpht.com/b=w48-h48"') !== -1, 'allowed emoji image, protocol relative url made https, largest thumbnail');
    // the word after an emoji survives the real tokenizer
    const IMG = n => ({emoji: {image: {thumbnails: [{url: 'https://yt3.ggpht.com/' + n + '=w24'}]}}});
    var html = s.ChatLive_extraMessageTokenize(s.ChatYouTube_Tokens([IMG('a'), {text: 'hello there friend'}]), 0, 0);
    check(/<img[^>]*>\s+hello there friend/.test(html), 'word after an emoji survives');
    html = s.ChatLive_extraMessageTokenize(s.ChatYouTube_Tokens([{text: 'hi '}, IMG('a'), IMG('b'), {text: 'yelling in texts'}]), 0, 0);
    check(html.indexOf('hi ') === 0 && /<img[^>]*>\s*<img[^>]*>\s+yelling in texts/.test(html), 'text after two emoji and before them survives');
    html = s.ChatLive_extraMessageTokenize(s.ChatYouTube_Tokens([IMG('a'), {text: ' already spaced'}]), 0, 0);
    check(/<img[^>]*>\s+already spaced/.test(html), 'text with its own leading space survives');

    // badges
    var b = s.ChatYouTube_Badges([{liveChatAuthorBadgeRenderer: {icon: {iconType: 'OWNER'}}}, {liveChatAuthorBadgeRenderer: {icon: {iconType: 'VERIFIED'}}}]);
    check(b.role === 'owner' && b.html.indexOf('chat_b_yt_owner') !== -1 && b.html.indexOf('chat_b_yt_verified') !== -1, 'owner and verified badge');
    b = s.ChatYouTube_Badges([{liveChatAuthorBadgeRenderer: {icon: {iconType: 'MODERATOR'}}}, {liveChatAuthorBadgeRenderer: {customThumbnail: {thumbnails: [{url: 'https://yt3.ggpht.com/m=s16-c-k'}]}}}]);
    check(b.role === 'mod' && b.html.indexOf('chat_b_yt_mod') !== -1 && b.html.indexOf('url(https://yt3.ggpht.com/m=s16-c-k)') !== -1, 'moderator and member image badge');
    b = s.ChatYouTube_Badges([{liveChatAuthorBadgeRenderer: {customThumbnail: {thumbnails: [{url: 'https://evil.example/m.png'}]}}}, {liveChatAuthorBadgeRenderer: {icon: {iconType: 'constructor'}}}]);
    check(b.role === '' && b.html === '', 'foreign member badge and unknown icon dropped');
    b = s.ChatYouTube_Badges([{liveChatAuthorBadgeRenderer: {customThumbnail: {thumbnails: [{url: 'https://yt3.ggpht.com/m=s16'}]}}}]);
    check(b.role === 'member', 'member role');

    // special items, shapes not yet seen live (spec 6.3 point 4)
    var paid = s.ChatYouTube_ToMsg({liveChatPaidMessageRenderer: {id: 'p', timestampUsec: '1793476496725195', authorName: {simpleText: 'A'},
        authorExternalChannelId: 'UCx', purchaseAmountText: {simpleText: '100,00 Kč'}, bodyBackgroundColor: 4280150454, message: {runs: [{text: 'hi'}]}}}, false);
    check(paid.special.indexOf('100,00 Kč') !== -1 && /^rgba?\(/.test(paid.highlight), 'super chat amount and color');
    check(paid.ts === 1793476496725 && paid.highlight === 'rgba(29,233,182,0.40)' && paid.tokens.join('') === 'hi' && paid.special.indexOf('A ') === -1, 'super chat: ms timestamp, ARGB to rgba with alpha capped at 0.4, body keeps the nick');
    paid = s.ChatYouTube_ToMsg({liveChatPaidMessageRenderer: {id: 'p', authorName: {simpleText: '"><img src=x onerror=1>'}, purchaseAmountText: {simpleText: '<b>1</b>'}, bodyBackgroundColor: 'red;background:url(x)'}}, false);
    check(paid.special.indexOf('<') === -1 && paid.highlight === null && paid.special.indexOf('&quot;') !== -1, 'super chat: escaped nick and amount, junk color dropped, nick in special without a body');
    var st = s.ChatYouTube_ToMsg({liveChatPaidStickerRenderer: {id: 's', timestampUsec: '1793476496725195', authorName: {simpleText: 'S'}, authorExternalChannelId: 'UCs',
        purchaseAmountText: {simpleText: '$2.00'}, moneyChipBackgroundColor: 4278190335, sticker: {thumbnails: [{url: 'https://lh3.googleusercontent.com/st=s72'}]}}}, false);
    check(st.special.indexOf('Super Sticker $2.00') !== -1 && st.special.indexOf('src="https://lh3.googleusercontent.com/st=s72"') !== -1 && st.highlight === 'rgba(0,0,255,0.40)', 'super sticker: amount, image, color');
    st = s.ChatYouTube_ToMsg({liveChatPaidStickerRenderer: {id: 's', authorName: {simpleText: 'S'}, purchaseAmountText: {simpleText: '$2'}, sticker: {thumbnails: [{url: 'https://evil.example/s.png'}]}}}, false);
    check(st.special.indexOf('evil.example') === -1 && st.special.indexOf('<img') === -1, 'super sticker: foreign host dropped');
    var mem = s.ChatYouTube_ToMsg({liveChatMembershipItemRenderer: {id: 'mm', timestampUsec: '1793476496725195', authorName: {simpleText: 'M'}, authorExternalChannelId: 'UCm',
        headerSubtext: {runs: [{text: 'Welcome to <b>X</b>!'}]}, headerPrimaryText: {runs: [{text: 'Member for 2 months'}]}, message: {runs: [{text: 'thanks'}]},
        authorBadges: [{liveChatAuthorBadgeRenderer: {customThumbnail: {thumbnails: [{url: 'https://yt3.ggpht.com/m=s16'}]}}}]}}, false);
    check(mem.special.indexOf('Member for 2 months Welcome to &lt;b>X&lt;/b>!') !== -1 && mem.special.indexOf('<b') === -1 && mem.tokens.join('') === 'thanks' && mem.role === 'member', 'membership: escaped YouTube texts and message');
    check(s.ChatYouTube_ToMsg({liveChatMembershipItemRenderer: {id: 'mm', authorName: {simpleText: 'M'}}}, false).special === 'M New member', 'membership: fallback label with nick');
    var gp = s.ChatYouTube_ToMsg({liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {id: 'gp', timestampUsec: '1793476496725195', authorExternalChannelId: 'UCg',
        header: {liveChatSponsorshipsHeaderRenderer: {authorName: {simpleText: 'G'}, primaryText: {runs: [{text: 'Sent '}, {text: '5'}, {text: ' gift memberships'}]}}}}}, false);
    check(gp.nick === 'G' && gp.special === 'G Sent 5 gift memberships' && gp.ts === 1793476496725, 'gift purchase announcement');
    check(s.ChatYouTube_ToMsg({liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {id: 'gp'}}, false) === null, 'gift purchase without header ignored');
    var gr = s.ChatYouTube_ToMsg({liveChatSponsorshipsGiftRedemptionAnnouncementRenderer: {id: 'gr', timestampUsec: '1793476496725195', authorName: {simpleText: 'R'}, authorExternalChannelId: 'UCr',
        message: {runs: [{text: 'received a gift membership by '}, {text: 'G'}]}}}, false);
    check(gr.special === 'R received a gift membership by G', 'gift redemption announcement');

    var page = '<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaKey-1","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","x":"a}b"}},"INNERTUBE_CONTEXT_CLIENT_NAME":1});</script>' +
        '<script>window["ytInitialData"] = ' + JSON.stringify({contents: {liveChatRenderer: {continuations: [{invalidationContinuationData: {continuation: 'TOK1'}}], actions: acts}}}) + ';</script>';
    var pr = s.ChatYouTube_ParseChatPage(page);
    check(pr.key === 'AIzaKey-1' && pr.context.client.x === 'a}b' && pr.continuation === 'TOK1' && pr.actions.length === acts.length, 'chat page parsed (braces inside strings ok)');
    pr = s.ChatYouTube_ParseChatPage(page.replace('invalidationContinuationData', 'timedContinuationData').replace('window["ytInitialData"] = ', 'var ytInitialData = '));
    check(pr && pr.continuation === 'TOK1', 'timed continuation and var ytInitialData form');
    check(s.ChatYouTube_ParseChatPage('<html>consent</html>') === null && s.ChatYouTube_ParseChatPage(page.replace('"continuations"', '"x"')) === null, 'unusable page gives null');
    var pp = s.ChatYouTube_ParsePoll(JSON.stringify(polls[1]));
    check(pp.actions.length === 3 && pp.continuation.length > 20 && s.ChatYouTube_ParsePoll('{}') === null && s.ChatYouTube_ParsePoll('<html>') === null, 'poll parsed from the fixture, junk gives null');
    check(s.ChatYouTube_ParsePoll(JSON.stringify(polls[0])).actions.length === 0, 'poll without actions');

    // flow, immediate live: chat page is history, then polling
    reset();
    var seq = start('@robdiesalot', true);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    var hl0 = http.length;
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    check(lines.length === 74 && lines.every(l => l.addToStart === true && l.historyTs > 1.7e12) && lines.filter(l => l.sub).length === 2, 'page actions rendered as history with times, gifts special');
    var poll0 = http[http.length - 1];
    check(http.length === hl0 + 1 && poll0.url === 'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false&key=AIzaKey-1' && poll0.method === 'POST' &&
        poll0.ok === 'ChatYouTube_PollResult' && poll0.check === seq && poll0.key === 0, 'poll: POST with named callback and seq');
    check(JSON.parse(poll0.body).continuation === 'TOK1' && JSON.parse(poll0.body).context.client.clientName === 'WEB', 'poll body carries context and continuation');
    check(poll0.headers.some(h => h[0] === 'Content-Type' && h[1] === 'application/json') && poll0.headers.some(h => h[0] === 'Cookie' && h[1] === 'SOCS=CAI'), 'poll headers: json plus YouTube headers');
    s.ChatMulti_Stop(0);

    // flow, stream goes live later: retries, then the page is NOT history (Spec 6.9)
    reset();
    seq = start('@robdiesalot', true);
    check(http.length === 1 && http[0].url === 'https://www.youtube.com/@robdiesalot/live' && http[0].ok === 'ChatYouTube_LiveResult' && http[0].check === seq && http[0].key === 0, 'live page by named callback with the session seq');
    check(JSON.stringify(http[0].headers) === JSON.stringify(s.ChatYouTube_Headers) && /Chrome\/130/.test(http[0].headers[0][1]) && http[0].headers[1][1] === 'SOCS=CAI', 'YouTube headers on the live request');
    s.ChatYouTube_LiveResult({status: 200, responseText: '"videoId":"-a9764YAN_8"'}, 0, seq);
    check(http.length === 1 && pending() === 1 && timers[0].d === s.ChatYouTube_RetryMs && lines.length === 0, 'not live: one retry timer, no request, nothing in the chat');
    fire();
    check(http.length === 2 && http[1].url === http[0].url, 'retry looks for the live video again');
    s.ChatYouTube_LiveResult({status: 500, responseText: ''}, 0, seq);
    check(http.length === 2 && pending() === 1 && timers[timers.length - 1].d === s.ChatYouTube_RetryMs, 'failed live request: retry timer');
    fire();
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    check(http[3].url === 'https://www.youtube.com/live_chat?is_popout=1&v=-a9764YAN_8' && http[3].ok === 'ChatYouTube_PageResult' && http[3].check === seq, 'live: chat page requested');
    s.ChatYouTube_PageResult({status: 200, responseText: '<html>'}, 0, seq);
    check(http.length === 4 && pending() === 1 && timers[timers.length - 1].d === s.ChatYouTube_RetryMs && lines.length === 0, 'bad chat page: retry timer, silent');
    fire();
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    var hl = http.length;
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq - 1);
    check(lines.length === 0 && http.length === hl, 'stale page result is ignored');
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    check(lines.length === 0 && s.ChatYouTube_State[0].withHistory === false && s.ChatYouTube_State[0].lastTs > 1.7e12, 'after a retry the page is not history (spec 6.9), only the watermark moves');
    var poll = http[http.length - 1];
    check(http.length === hl + 1 && poll.url === 'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false&key=AIzaKey-1' && poll.method === 'POST' &&
        poll.ok === 'ChatYouTube_PollResult' && poll.check === seq && poll.key === 0, 'poll: POST with named callback and seq');
    check(JSON.parse(poll.body).continuation === 'TOK1' && JSON.parse(poll.body).context.client.clientName === 'WEB', 'poll body carries context and continuation');
    check(poll.headers.some(h => h[0] === 'Content-Type' && h[1] === 'application/json') && poll.headers.some(h => h[0] === 'Cookie' && h[1] === 'SOCS=CAI'), 'poll headers: json plus YouTube headers');

    // poll result: ordered, spread by time differences, next poll after it, continuation advances
    reset();
    var A = (id, usec, text) => ({addChatItemAction: {item: {liveChatTextMessageRenderer: {id, timestampUsec: String(usec), authorName: {simpleText: 'n' + id}, authorExternalChannelId: 'UC' + id, message: {runs: [{text}]}}}}});
    var body = {continuationContents: {liveChatContinuation: {continuations: [{timedContinuationData: {continuation: 'TOK2'}}], actions: [
        A('c', 1793000003500000, 'third'), A('a', 1793000001000000, 'first'), A('b', 1793000001400000, 'second'), {markChatItemAsDeletedAction: {targetItemId: 'old1'}},
        {markChatItemsByAuthorAsDeletedAction: {externalChannelId: 'UCbad'}}]}}};
    s.ChatYouTube_PollResult({status: 200, responseText: JSON.stringify(body)}, 0, seq);
    check(lines.length === 1 && /first/.test(lines[0].message), 'first message is shown at once');
    check(deleted.join() === 'yt:old1' && banned.join() === '0:yt:UCbad', 'moderation applied');
    check(timers.map(x => x.d).join() === '1000,400,1000', 'next poll is scheduled first, others are spread by time differences capped at the poll interval');
    timers[1].live = false; timers[1].fn(); timers[2].live = false; timers[2].fn();
    check(lines.length === 3 && /second/.test(lines[1].message) && /third/.test(lines[2].message), 'spread messages arrive in time order');
    check(lines.every(l => !l.addToStart), 'live lines are not history');
    timers[0].live = false; timers[0].fn();
    var req = http[http.length - 1];
    check(req.ok === 'ChatYouTube_PollResult' && JSON.parse(req.body).continuation === 'TOK2', 'next poll uses the returned continuation');

    // broken chain: missing token or error -> chat page again after one timer
    reset();
    s.ChatYouTube_PollResult({status: 200, responseText: '{}'}, 0, seq);
    check(pending() === 1 && timers[0].d === s.ChatYouTube_PollMs && lines.length === 0, 'missing continuation: reload timer, silent');
    fire();
    check(http.length === 1 && http[0].ok === 'ChatYouTube_PageResult' && http[0].url.indexOf('v=-a9764YAN_8') !== -1, 'chat page reloaded');
    s.ChatYouTube_PollResult({status: 0, responseText: ''}, 0, seq);
    check(pending() === 1, 'network error: one reload timer');
    fire();
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    timers.filter(x => x.live).forEach(x => { x.live = false; x.fn(); });
    check(http[http.length - 1].ok === 'ChatYouTube_PollResult' && lines.length === 0, 'reload re-sends the page actions as live lines, ChatMulti drops the ones already shown, polling continues');

    // no history wanted: first page actions are not shown
    reset();
    seq = start('UCROnsopSryzM2WaxxeNICOA', false);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    check(lines.length === 0 && http[http.length - 1].ok === 'ChatYouTube_PollResult', 'withHistory false: page actions skipped, polling starts');

    // history drops deleted items and banned authors
    reset();
    seq = start('UCROnsopSryzM2WaxxeNICOA', true);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    var hp = JSON.stringify({contents: {liveChatRenderer: {continuations: [{invalidationContinuationData: {continuation: 'T'}}], actions: [A('a', 1793000001000000, 'x'), A('b', 1793000002000000, 'y'), A('c', 1793000003000000, 'z'),
        {removeChatItemAction: {targetItemId: 'a'}}, {markChatItemsByAuthorAsDeletedAction: {externalChannelId: 'UCc'}}]}}});
    s.ChatYouTube_PageResult({status: 200, responseText: '"INNERTUBE_API_KEY":"k","INNERTUBE_CONTEXT":{} ytInitialData"] = ' + hp + ';'}, 0, seq);
    check(lines.length === 1 && />y</.test(lines[0].message) && deleted.length === 0, 'history: deleted item and banned author are not shown');

    // persistent poll failure after a page load: one retry timer, no page reload loop
    reset();
    seq = start('@robdiesalot', true);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    reset();
    for (var f = 0; f < 5; f++) {
        s.ChatYouTube_PollResult({status: 400, responseText: ''}, 0, seq);
        if (f === 0) check(pending() === 1 && timers[timers.length - 1].d === s.ChatYouTube_RetryMs, 'poll failure with no good poll since the page load: retry timer');
    }
    check(http.length === 0 && pending() === 5 && timers.every(x => x.d === s.ChatYouTube_RetryMs), 'consecutive poll failures never reload the page, only RetryMs timers');
    // after a good poll, one failure reloads the page once (PollMs), the next failure goes to the retry timer
    reset();
    seq = start('@robdiesalot', true);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    s.ChatYouTube_PollResult({status: 200, responseText: JSON.stringify({continuationContents: {liveChatContinuation: {continuations: [{timedContinuationData: {continuation: 'T3'}}]}}})}, 0, seq);
    s.ChatYouTube_PollResult({status: 400, responseText: ''}, 0, seq);
    check(timers.filter(x => x.live).pop().d === s.ChatYouTube_PollMs, 'failure after a good poll: page reload timer');
    s.ChatYouTube_PollResult({status: 400, responseText: ''}, 0, seq);
    check(timers.filter(x => x.live).pop().d === s.ChatYouTube_RetryMs, 'second failure in a row: retry timer');
    s.ChatMulti_Stop(0);

    // a render exception (null run) does not end polling
    reset();
    seq = start('@robdiesalot', false);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    reset();
    var nullRun = {continuationContents: {liveChatContinuation: {continuations: [{timedContinuationData: {continuation: 'T4'}}], actions: [
        {addChatItemAction: {item: {liveChatMembershipItemRenderer: {id: 'nr', timestampUsec: '1793999000000000', authorName: {simpleText: 'N'}, headerSubtext: {runs: [null]}}}}}]}}};
    s.ChatYouTube_PollResult({status: 200, responseText: JSON.stringify(nullRun)}, 0, seq);
    check(pending() === 1 && lines.length === 1 && lines[0].message.indexOf('New member') !== -1, 'null run: no exception, line rendered, next poll scheduled');
    // schedule-first: even a throwing render keeps the poll timer
    var oldMsg = s.ChatMulti_Line; s.ChatMulti_Line = () => { throw new Error('boom'); };
    reset();
    try { s.ChatYouTube_PollResult({status: 200, responseText: JSON.stringify(nullRun)}, 0, seq); } catch (e) { /* expected */ }
    s.ChatMulti_Line = oldMsg;
    check(pending() >= 1 && timers[0].d === s.ChatYouTube_PollMs, 'throwing render still leaves the next poll scheduled');
    s.ChatMulti_Stop(0);

    // watermark: a reload shows only messages newer than the newest rendered one, also after the seen ids were reset
    reset();
    seq = start('@robdiesalot', false);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    var pg = (list) => '"INNERTUBE_API_KEY":"k","INNERTUBE_CONTEXT":{} ytInitialData"] = ' + JSON.stringify({contents: {liveChatRenderer: {continuations: [{invalidationContinuationData: {continuation: 'T'}}], actions: list}}}) + ';';
    s.ChatYouTube_PageResult({status: 200, responseText: pg([A('o1', 1793000001000000, 'old1'), A('o2', 1793000002000000, 'old2')])}, 0, seq);
    check(lines.length === 0 && s.ChatYouTube_State[0].lastTs === 1793000002000, 'first load without history renders nothing but sets the watermark');
    s.ChatYouTube_PollResult({status: 200, responseText: JSON.stringify({continuationContents: {liveChatContinuation: {continuations: [{timedContinuationData: {continuation: 'T5'}}], actions: [A('l1', 1793000004000000, 'live1')]}}})}, 0, seq);
    check(lines.length === 1 && s.ChatYouTube_State[0].lastTs === 1793000004000, 'live poll moves the watermark');
    s.ChatMulti_Seen[0] = null; // ids forgotten (500 cap)
    s.ChatYouTube_PageResult({status: 200, responseText: pg([A('o2', 1793000002000000, 'old2'), A('l1', 1793000004000000, 'live1'), A('n1', 1793000005000000, 'new1')])}, 0, seq);
    timers.filter(x => x.live).forEach(x => { x.live = false; x.fn(); });
    check(lines.length === 2 && /new1/.test(lines[1].message), 'reload shows only the message newer than the watermark');
    s.ChatMulti_Stop(0);

    // current seq but Chat_Id changed (no Stop): the ChatMulti_IsActive half decides, nothing renders or schedules
    reset();
    seq = start('@robdiesalot', true);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    reset();
    s.Chat_Id[0] = 8;
    check(s.ChatYouTube_State[0].seq === seq, 'session state still has the current seq');
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    s.ChatYouTube_PollResult({status: 200, responseText: JSON.stringify(body)}, 0, seq);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    s.Chat_Id[0] = 7;
    check(lines.length === 0 && pending() === 0 && http.length === 0 && deleted.length === 0, 'Chat_Id changed: current seq alone renders and schedules nothing');
    s.ChatMulti_Stop(0);

    // Review Focus 2: stale / stopped sessions do nothing, every timer is cleared by Stop
    reset();
    s.Chat_Id[0] = 9; s.ChatYouTube_PollResult({status: 200, responseText: '{}'}, 0, 8);
    check(pending() === 0 && http.length === 0, 'stale poll stops');
    s.Chat_Id[0] = 7;
    seq = start('@robdiesalot', true);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    reset();
    s.ChatYouTube_PollResult({status: 200, responseText: JSON.stringify(body)}, 0, seq);
    check(pending() === 3, 'spread timers and next poll pending');
    s.ChatMulti_Stop(0);
    check(pending() === 0, 'Stop clears every timer of the slot');
    var l0 = lines.length;
    s.ChatYouTube_PollResult({status: 200, responseText: JSON.stringify(body)}, 0, seq);
    s.ChatYouTube_PageResult({status: 200, responseText: page}, 0, seq);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seq);
    check(lines.length === l0 && pending() === 0 && http.length === 0, 'results after stop are dropped');
    // a timer that slipped through (Chat_Id changed, no Stop) does nothing
    reset();
    seq = start('@robdiesalot', false);
    s.ChatYouTube_LiveResult({status: 200, responseText: ''}, 0, seq);
    var tt = timers[timers.length - 1];
    s.Chat_Id[0] = 8; http.length = 0; tt.fn(); s.Chat_Id[0] = 7;
    check(http.length === 0, 'stale retry timer does nothing');
    s.ChatMulti_Stop(0);
    // restart (same Chat_Id, new seq) drops the old session
    reset();
    var seqA = start('@a', false);
    start('@b', false);
    s.ChatYouTube_LiveResult({status: 200, responseText: LIVE}, 0, seqA);
    check(http.length === 2 && pending() === 0, 'old session result after restart is ignored');
    // junk targets never request
    reset();
    s.ChatYouTube_Start(0, seqA, '"><img>', false); s.ChatYouTube_Start(0, seqA, 'x y', false);
    check(http.length === 0 && !s.ChatYouTube_State[0], 'invalid target ignored');
    s.ChatMulti_Stop(0);

    // XSS through a rendered line (ChatMulti core): nick, text, ids, badges
    reset();
    seq = start('@robdiesalot', false);
    var evil = s.ChatYouTube_ToMsg({liveChatTextMessageRenderer: {id: 'a"b c', timestampUsec: '1793000001000000', authorName: {simpleText: '"><img src=x onerror=alert(1)>'}, authorExternalChannelId: 'U C"1',
        message: {runs: [{text: '<script>alert(1)</script>'}]}, authorBadges: [{liveChatAuthorBadgeRenderer: {customThumbnail: {thumbnails: [{url: 'https://yt3.ggpht.com/x\');alert(1)//'}]}}}]}}, false);
    s.ChatMulti_Line(0, seq, evil);
    var m0 = lines[lines.length - 1].message;
    check(m0.indexOf('<img src=x') === -1 && m0.indexOf('<script>') === -1 && m0.indexOf("alert(1)'") === -1 && m0.indexOf('id="yt_abc"') !== -1 && m0.indexOf('chat_pi_yt') !== -1, 'rendered YouTube line is escaped');
    s.ChatMulti_Stop(0);
}

// Linked chats dialog: pure rows and apply
{
    const d = sandbox();
    const ds = d.s;
    ds.STR_CHAT_LINK_FROM_DIR = 'from UnityChat'; ds.STR_CHAT_LINK_MANUAL = 'manual'; ds.STR_CHAT_LINK_NONE = 'not found';
    ds.STR_CHAT_LINK_EDIT = 'Edit'; ds.STR_CHAT_LINK_ENABLED = 'Link this streamer'; ds.STR_CHAT_LINK_RESET = 'Back to UnityChat';
    ds.STR_CLOSE = 'Close'; ds.STR_YES = 'Yes'; ds.STR_NO = 'No';
    var rows = ds.ChatLinkDialog_Rows({enabled: true, kick: 'robdiesalot'}, {yt: {value: '@arcadebulls', source: 'dir'}, kick: {value: 'robdiesalot', source: 'manual'}});
    check(rows.map(function (r) { return r.kind; }).join() === 'yt,kick,enabled,reset,close', 'rows with reset when a manual value exists');
    check(rows[0].value === '@arcadebulls' && rows[0].source === 'dir' && rows[1].source === 'manual', 'rows carry value and source');
    check(ds.ChatLinkDialog_Rows({enabled: true}, {yt: null, kick: null}).map(function (r) { return r.kind; }).join() === 'yt,kick,enabled,close', 'no reset without manual values');
    check(ds.ChatLinkDialog_Rows({enabled: true}, {yt: null, kick: null})[0].source === 'none', 'unresolved row has source none');
    check(ds.ChatLinkDialog_Apply('arcadebulls', 'yt', 'https://youtube.com/@ArcadeBulls') && ds.ChatLink_Get('arcadebulls').yt === '@arcadebulls', 'apply normalizes');
    check(ds.ChatLinkDialog_Apply('arcadebulls', 'kick', '') && ds.ChatLink_Get('arcadebulls').kick === '', 'empty input means do not link');
    check(!ds.ChatLinkDialog_Apply('arcadebulls', 'kick', 'a b c') && ds.ChatLink_Get('arcadebulls').kick === '', 'invalid input rejected and not saved');
    check(ds.ChatLink_Get('arcadebulls').yt === '@arcadebulls' && ds.ChatLink_Get('arcadebulls').enabled === true, 'apply keeps other fields');
    check(!ds.ChatLinkDialog_Apply('arcadebulls', 'enabled', 'x'), 'unknown kind rejected');
}

console.log(checks + ' merged chat checks passed');
