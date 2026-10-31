/* Merged YouTube/Kick chat: link resolution and (later) pollers, run against the real app files in a vm sandbox. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
// Append later files (ChatMulti.js, ChatKick.js, ChatYouTube.js) here; missing ones are skipped.
const FILES = ['ChatLink.js', 'ChatMulti.js', 'ChatKick.js', 'ChatYouTube.js'];
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

console.log(checks + ' merged chat checks passed');
