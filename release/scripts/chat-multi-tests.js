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

console.log(checks + ' merged chat checks passed');
