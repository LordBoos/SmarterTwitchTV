/* Kick as a second platform: API module converters, run against the real app files in a vm sandbox with real Kick fixtures. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const UglifyJS = require('uglify-js');
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
const ref = n => JSON.parse(fs.readFileSync('jsonreferences/' + n, 'utf8'));

// Functions of the large files are extracted one by one, as in following-tests.js
function extract(file, names, ctx) {
    UglifyJS.parse(fs.readFileSync(file, 'utf8')).walk(
        new UglifyJS.TreeWalker(node => {
            if (node instanceof UglifyJS.AST_Defun && names.indexOf(node.name.name) !== -1) vm.runInContext(node.print_to_string(), ctx);
        })
    );
}

const calls = [], results = [];
function sandbox() {
    const s = {
        noop_fun: () => {}, Main_Log: () => {},
        Main_formatNumber: n => 'F' + n,
        Main_videoCreatedAt: t => 'D' + t,
        Play_streamLiveAt: t => 'S' + t,
        OSInterface_XmlHttpGetFull: (...a) => calls.push(a),
        DefaultHttpGetTimeout: 20000,
        PlayClip_BaseUrl: 'https://gql.twitch.tv/gql',
        Play_Headers: '[]',
        KickUser_Token: () => '' // KickUser.js is not loaded here (cards ask it for the Twitch icon)
    };
    s.window = s;
    vm.createContext(s);
    ['thirdparty/twemoji.js', 'specific/ChatMulti.js', 'specific/KickApi.js', 'specific/PlayHLS.js'].forEach(f => {
        const p = 'app/' + f;
        vm.runInContext(fs.readFileSync(p, 'utf8'), s, {filename: p});
    });
    s.use_proxy = false;
    // Screens.js is too large to load: extract the escaper only
    extract('app/specific/Screens.js', ['Screens_AriaEscape'], s);
    return s;
}
const s = sandbox();

const live = ref('kick_user_livestreams.json')[0];
let c = s.KickApi_LiveCell(live);
check(c.length === 20 && c[19] === 'kick', 'live row: 20 slots, platform in 19');
check(c[6] === live.channel.slug && c[14] === 'kick:' + live.channel.slug.toLowerCase() && c[7] === 'kick:' + live.id, 'slug in 6, prefixed ids in 7 and 14');
check(c[13] === live.viewer_count && c[4] === 'F' + live.viewer_count && c[0] === live.thumbnail.src.split('?')[0], 'viewers and thumbnail without query');
const browse = {id: '01a19458-57a0-7e14-a3c5-0494d215f8de', title: 'T', viewer_count: 5, start_time: '2026-10-31T23:43:00Z', language: 'pt', is_mature: false,
    thumbnail: {src: 'https://images.kick.com/video_thumbnails/a/b/720.webp'}, category: {name: 'IRL'},
    channel: {id: 1, slug: 'jucacaoepitcao', username: 'JucacaoePitcao', profile_pic: 'https://files.kick.com/x.webp'}};
c = s.KickApi_LiveCell(browse);
check(c[1] === 'JucacaoePitcao' && c[2] === 'T' && c[3] === 'IRL' && c[5] === '[PT]' && c[12] === '2026-10-31T23:43:00Z', 'mobile browse shape');
c = s.KickApi_LiveCell({id: 1, session_title: '<script>x</script>', viewer_count: 1, start_time: '2026-10-31 22:33:21',
    thumbnail: {src: 'https://evil.example/a.png'}, channel: {slug: 'a', user: {username: '"><img src=x onerror=1>', profilepic: "https://files.kick.com/a.png'onerror='x"}}});
check(c[1].indexOf('<img') === -1 && c[2].indexOf('<script') === -1 && c[0] === '' && c[9] === '', 'untrusted text escaped, foreign or quoted urls dropped');
check(s.KickApi_LiveCell({id: 1, channel: {slug: 'a b"', user: {username: 'x'}}})[6] === '', 'unsafe slug dropped');
check(s.KickApi_Iso('2026-10-31 22:33:21') === '2026-10-31T22:33:21Z' && s.KickApi_Iso('2026-10-31T22:33:22.000000Z') === '2026-10-31T22:33:22.000000Z' && s.KickApi_Iso('x') === '', 'dates as UTC ISO');
const chan = ref('kick_channel.json');
check(s.KickApi_ChannelLiveCell(chan)[14] === 'kick:' + chan.slug && s.KickApi_ChannelLiveCell(chan)[7] === 'kick:' + chan.livestream.id, 'channel live row');
check(s.KickApi_ChannelLiveCell(Object.assign({}, chan, {livestream: null})) === null, 'offline channel has no live row'); // test-only Object.assign is fine (Node)
const v = ref('kick_videos.json').filter(x => !x.is_live)[0];
c = s.KickApi_VodCell(v, {slug: 'xqc', name: 'xQc'});
check(c[7] === 'kick:' + v.video.uuid && c[11] === Math.round(v.duration / 1000) && c[14] === 'kick:xqc' && c[19] === 'kick', 'vod row');
const clip = ref('kick_clips.json').clips[0];
c = s.KickApi_ClipCell(clip);
check(c[0] === clip.clip_url && c[7] === 'kick:' + clip.id && c[8] === null && c[6] === clip.channel.slug, 'clip row plays its m3u8, has no vod');
const f = ref('kick_followed.json').channels[0];
c = s.KickApi_ChannelCell(f);
check(c[0] === f.channel_slug && c[1] === 'kick:' + f.channel_slug.toLowerCase() && c[19] === 'kick', 'followed channel row');
check(s.KickApi_Headers('').length === 2 && s.KickApi_Headers('t')[2][1] === 'Bearer t', 'token header only with a token');
check(s.KickApi_IsKickId('kick:xqc') && !s.KickApi_IsKickId('12345') && !s.KickApi_IsKickId(null), 'kick id test');
check(s.KickApi_CardIcon(c).indexOf('chat_pi_kick') !== -1 && s.KickApi_CardIcon(['', 'tw']) === '', 'kick icon only on kick rows');

// Ruling 5: the v2/channels live object carries only thumbnail.url; unsafe ids drop the row
check(s.KickApi_ChannelLiveCell(chan)[0] === chan.livestream.thumbnail.url, 'channel live thumbnail from thumbnail.url');
check(s.KickApi_LiveCell(Object.assign({}, live, {id: '1"><img'})) === null && s.KickApi_VodCell({video: {uuid: '../x'}}, {slug: 'a'}) === null &&
    s.KickApi_ClipCell({id: 'clip 1'}) === null && s.KickApi_Item(null, 'a', 'kick:a') === null, 'unsafe id in [7] drops the row');

// Playlist branch
const chanText = fs.readFileSync('jsonreferences/kick_channel.json', 'utf8');
s.Cb = function Cb(r, x, y) { results.push(JSON.parse(r)); }; // named: the result callback is resolved by name
s.PlayHLS_GetPlayListAsync(true, 'kick:' + chan.slug, 77, null, s.Cb);
check(calls[0][0] === 'https://kick.com/api/v2/channels/' + chan.slug && calls[0][5] === 'PlayHLS_KickResult' && calls[0][8] === 'info', 'live: channel info first');
check(!JSON.parse(calls[0][4]).some(h => h[0] === 'Authorization'), 'playback info is public, no token');
s.PlayHLS_KickResult(JSON.stringify({status: 200, responseText: chanText}), 77, '1', 'info', chan.slug, null, 'null', 'Cb');
check(calls[1][0] === chan.playback_url && calls[1][8] === 'master' && calls[1][10] === chan.playback_url && calls[1][4] === null, 'then the master, its url carried in check_4');
check(s.KickApi_LiveCache[chan.slug][7] === 'kick:' + chan.livestream.id, 'info step caches the fresh row');
s.PlayHLS_KickResult(JSON.stringify({status: 200, responseText: '#EXTM3U\n'}), 77, '1', 'master', chan.slug, chan.playback_url, 'null', 'Cb');
check(results[0].status === 200 && results[0].url === chan.playback_url && results[0].checkResult === 77 && results[0].responseText === '#EXTM3U\n', 'callback gets status, url, playlist, checkResult');
s.PlayHLS_KickResult(JSON.stringify({status: 200, responseText: JSON.stringify(Object.assign({}, chan, {livestream: null}))}), 78, '1', 'info', chan.slug, null, 'null', 'Cb');
check(results[1].status === 404 && calls.length === 2, 'offline: 404, no master request');
s.PlayHLS_KickResult(JSON.stringify({status: 403, responseText: '{"error":"Request blocked by security policy."}'}), 79, '1', 'info', chan.slug, null, 'null', 'Cb');
check(results[2].status === 0, 'WAF block is a generic error, not forbidden');
s.PlayHLS_GetPlayListAsync(false, 'kick:6c2265bd-60c0-4903-9f78-af76c989a41a', 80, null, s.Cb);
check(calls[2][0] === 'https://kick.com/api/v1/video/6c2265bd-60c0-4903-9f78-af76c989a41a', 'vod: video detail first');
const video = ref('kick_video.json');
check(s.PlayHLS_KickPlaylistUrl(false, video) === video.source && s.PlayHLS_KickPlaylistUrl(false, {source: 'https://stream.kick.com/a/b/'}) === 'https://stream.kick.com/a/b/media/hls/master.m3u8', 'vod master url from source');
check(s.PlayHLS_KickPlaylistUrl(false, {source: 'javascript:alert(1)//.m3u8'}) === null, 'foreign playlist url rejected');
s.PlayHLS_KickResult(JSON.stringify({status: 200, responseText: '{"source":"https://evil.example/x.m3u8"}'}), 82, '0', 'info', video.uuid, null, 'null', 'Cb');
check(results[3].status === 410 && calls.length === 3, 'vod without a kick playlist: 410');
s.PlayHLS_GetPlayListAsync(true, 'kick:../x', 83, null, s.Cb);
check(results[4].status === 404 && calls.length === 3, 'unsafe slug never builds a request');
// Java calls smartTwitchTV.<callback>: the release wrapper and the assets map must both expose the Kick result
check(['release/api.js', 'app/specific/Main.js'].every(f => fs.readFileSync(f, 'utf8').indexOf('PlayHLS_KickResult: PlayHLS_KickResult') !== -1), 'kick result exposed to java');
s.PlayHLS_GetPlayListAsync(true, 'robdiesalot', 81, null, s.Cb);
check(calls[3][0] === 'https://gql.twitch.tv/gql', 'twitch path unchanged');
check(s.PlayHLS_Id(['', '', '', '', '', '', 'xqc']) === 'xqc' && s.PlayHLS_Id(Object.assign([], {6: 'xqc', 19: 'kick'})) === 'kick:xqc', 'PlayHLS_Id');
s.OSInterface_mMethodUrlHeaders = url => JSON.stringify(url.indexOf('/api/v2/channels/') !== -1 ? {status: 200, responseText: chanText} : {status: 200, responseText: '#EXTM3U\n'});
const sync = JSON.parse(s.PlayHLS_GetPlayListSync(true, 'kick:' + chan.slug));
check(sync.status === 200 && sync.url === chan.playback_url && sync.responseText === '#EXTM3U\n', 'sync twin, same shape');

// Debug and later entry: open a live channel by slug
const opened = [];
Object.assign(s, {
    FullxmlHttpGet: (...a) => opened.push(a), STR_LIVE: ' live ', STR_IS_OFFLINE: 'offline',
    Main_showWarningDialog: t => opened.push('warn ' + t), Main_isScene2DocVisible: () => false, Main_onNewIntentClearPlay: () => opened.push('clear'),
    Main_values: {Main_Go: 0}, ScreenObj: [{exit_fun: () => opened.push('exit')}], Play_data_base: {data: []}, Main_openStream: () => opened.push('open')
});
s.KickApi_OpenLive(chan.slug);
check(opened[0][0] === 'https://kick.com/api/v2/channels/' + chan.slug && opened[0][2].name === 'KickApi_OpenLiveResult', 'open live: named callback');
s.KickApi_OpenLiveResult({status: 200, responseText: JSON.stringify(Object.assign({}, chan, {livestream: null}))}, 0, opened[0][5]);
check(opened[1] === 'warn ' + chan.slug + '  live offline', 'offline channel: warning');
s.KickApi_OpenLive(chan.slug);
s.KickApi_OpenLiveResult({status: 200, responseText: chanText}, 0, opened[0][5]);
check(opened.length === 3, 'stale open result dropped');
s.KickApi_OpenLiveResult({status: 200, responseText: chanText}, 0, opened[2][5]);
check(opened.slice(3).join() === 'exit,open' && s.Play_data.data[19] === 'kick' && s.Main_values_Play_data === s.Play_data.data, 'live channel opens the player with the kick row');

// Twitch HTTP functions never send a Kick id to Helix
let native = 0;
const m = {Main_IsOn_OSInterface: true, OSInterface_BaseXmlHttpGet: () => native++, AddUser_UserHasToken: () => false, Main_Bearer_Headers: [], DefaultHttpGetTimeout: 1};
vm.createContext(m);
extract('app/specific/Main.js', ['Main_KickHelixBlocked', 'BaseXmlHttpGet', 'FullxmlHttpGet'], m);
let err = null; function ok() {} function bad(k, c, o) { err = o; } let got = null; function cb(o) { got = o; }
m.BaseXmlHttpGet('https://api.twitch.tv/helix/streams?user_id=kick:xqc', ok, bad, 0, 5, true);
check(native === 0 && err.status === 0, 'helix with a kick id never leaves the app, error path');
m.BaseXmlHttpGet('https://api.twitch.tv/helix/users?id=123', ok, bad, 0, 5, true);
check(native === 1, 'twitch id passes');
m.FullxmlHttpGet('https://api.twitch.tv/helix/channels/followed?user_id=1&broadcaster_id=kick:xqc', null, cb, cb, 0, 1, null, null);
check(native === 1 && got.status === 0, 'FullxmlHttpGet: success callback with status 0');
check(m.Main_KickHelixBlocked('https://api.twitch.tv/helix/users?id=1&id=kick%3Axqc') && !m.Main_KickHelixBlocked('https://api.twitch.tv/helix/streams?user_login=kickboxer') &&
    !m.Main_KickHelixBlocked('https://kick.com/api/v2/channels/a?id=kick:a'), 'helix guard pattern');

// History workers skip Kick entries and never delete them
const posted = [];
let deleted = 0;
const tw = a => Object.assign(['', '', '', '', 'x', '', 'a', '1', '', '', '', 'x', '', '', '5', '', 'x'], a);
const w = {
    AddUser_IsUserSet: () => true, AddUser_UserHasToken: () => false, AddUser_UsernameArray: [{id: 'u'}], Main_Bearer_Headers: [],
    BradcastCheckerWorker: {postMessage: o => posted.push(o)}, Screens_deleteFromHistory: () => deleted++, Main_setTimeout: () => {}, Main_isStopped: false,
    ScreenObj: [{histPosX: []}, {histPosX: []}, {histPosX: []}], Main_HistoryLive: 0, Main_HistoryVod: 1, Main_HistoryClip: 2, KickApi_IsKickId: s.KickApi_IsKickId,
    Main_values_History_data: {u: {
        live: [{data: tw()}, {data: tw({14: 'kick:xqc'})}],
        vod: [{data: tw()}, {data: tw({14: 'kick:xqc'})}],
        clip: [{data: tw({2: '5', 14: 'x'})}, {data: tw({2: 'kick:xqc', 14: 'x'})}]
    }}
};
vm.createContext(w);
extract('app/specific/Main.js', ['Main_StartHistoryworker', 'Main_StartHistoryworkerBradcast', 'Main_RunVODWorker', 'Main_RunLiveVODWorker', 'Main_RunClipWorker'], w);
w.Main_StartHistoryworker();
check(posted.length === 1 && posted[0].obj.data[14] === '5' && deleted === 0, 'history worker skips kick entries and never deletes them');
w.Main_RunVODWorker();
check(posted.length === 2 && posted[1].obj.data[14] === '5', 'vod worker skips kick entries');
w.Main_RunClipWorker();
check(posted.length === 3 && posted[2].obj.data[2] === '5', 'clip worker skips kick entries');
w.Main_values_History_data.u.live = [{forceVod: true, vodid: '9', data: tw()}, {forceVod: true, data: tw({14: 'kick:xqc'})}];
w.Main_RunLiveVODWorker();
check(posted.length === 4 && posted[3].obj.data[14] === '5' && deleted === 0, 'live vod worker skips kick entries and never deletes them');

// Blocked channels batch and stream info never carry a Kick id
const urls = [];
let infoCalls = 0;
const b = {
    AddUser_IsUserSet: () => true, AddUser_UsernameArray: [{id: 'u'}], Main_helix_api: 'https://api.twitch.tv/helix/', KickApi_IsKickId: s.KickApi_IsKickId,
    Main_values_History_data: {u: {blocked: {channel: {'1': {}, 'kick:xqc': {}}, game: {}}}}, Screens_BlockUpdateAllIdsObjFor: (i, url) => urls.push(url),
    ScreensObj_getStreamInfoCache: {}, BaseXmlHttpGetFull: () => infoCalls++
};
vm.createContext(b);
extract('app/specific/Screens.js', ['Screens_BlockUpdateAllIdsObj'], b);
extract('app/specific/ScreensObj.js', ['ScreensObj_getStreamInfo'], b);
b.Screens_BlockUpdateAllIdsObj(true);
check(urls.length === 1 && urls[0].indexOf('kick') === -1 && urls[0].indexOf('id=1') !== -1, 'blocked batch without kick ids');
b.ScreensObj_getStreamInfo('kick:xqc');
b.ScreensObj_getStreamInfo('5');
check(infoCalls === 1, 'stream info only for twitch ids');

// Player info: the fresh row of the playlist info step, periodic refresh from the channel
const hist = [], full = [];
const p = {
    Play_data: {data: Object.assign([], {6: chan.slug, 14: 'kick:' + chan.slug, 19: 'kick'})}, KickApi_LiveCache: s.KickApi_LiveCache, KickApi_IsKickRow: s.KickApi_IsKickRow,
    KickApi_ChannelLiveCell: s.KickApi_ChannelLiveCell, KickApi_Headers: s.KickApi_Headers, KickApi_Base: s.KickApi_Base, Main_Slice: a => a.slice(),
    Play_UpdateMainStreamDiv: () => hist.push('div'), Main_Set_history: (t, d) => hist.push(d[7]), FullxmlHttpGet: (...a) => full.push(a), BaseXmlHttpGet: () => full.push('helix'),
    Main_values: {Main_selectedChannelPartner: true}, Play_MultiEnable: false, Play_isOn: true, Play_isPlaying: () => true, Play_StayDialogVisible: () => false, PlayExtra_PicturePicture: false, PlayExtra_data: {data: []}, noop_fun: () => {}
};
vm.createContext(p);
extract('app/specific/Play.js', ['Play_updateStreamInfoStart', 'Play_updateStreamInfo', 'Play_KickInfoGet', 'Play_KickInfoApply', 'Play_KickKeepThumb', 'Play_KickInfoResult', 'Play_KickInfoMultiShow', 'Play_updateStreamInfoGetError'], p);
p.Play_updateStreamInfoStart();
check(p.Play_data.data[7] === 'kick:' + chan.livestream.id && p.Play_data.data !== s.KickApi_LiveCache[chan.slug] && full.length === 0, 'start info: cached row, no helix');
check(p.Main_values.Main_selectedChannelPartner === false, 'ruling 9: kick live start clears the stale partner flag');
p.Play_updateStreamInfo();
check(full[0][0] === 'https://kick.com/api/v2/channels/' + chan.slug && full[0][2].name === 'Play_KickInfoResult' && full[0][3] === p.noop_fun, 'periodic info from the kick channel');
hist.length = 0;
p.Play_KickInfoResult({status: 200, responseText: JSON.stringify(Object.assign({}, chan, {slug: 'other'}))}, -1, full[0][5]);
p.Play_KickInfoResult({status: 200, responseText: chanText}, -1, full[0][5] - 1);
check(hist.length === 0, 'other channel or stale info ignored');
p.Main_values.Main_selectedChannelPartner = true;
p.Play_KickInfoResult({status: 200, responseText: chanText}, -1, full[0][5]);
check(hist.join() === 'div,kick:' + chan.livestream.id, 'fresh info updates the panel and the history');
check(p.Main_values.Main_selectedChannelPartner === false, 'ruling 9: main periodic kick info clears the partner flag');
p.Play_KickInfoResult({status: 0, responseText: ''}, -1, full[0][5]);
check(hist.length === 3, 'failed info still saves the watching time');

// Task 6: picture-in-picture, multistream, info refresh of the extra slots
const chanB = JSON.parse(chanText), chanBText = JSON.stringify(Object.assign(chanB, {slug: 'buddha', livestream: Object.assign({}, chan.livestream, {id: 7001, viewer_count: 1234})}));
const chanX = Object.assign(JSON.parse(chanText), {slug: 'xqc', livestream: Object.assign({}, chan.livestream, {id: 7000, viewer_count: 4321})}), chanXText = JSON.stringify(chanX);
const rowXqc = s.KickApi_ChannelLiveCell(chanX), rowBuddha = s.KickApi_ChannelLiveCell(JSON.parse(chanBText));
const slotX = {data: rowXqc};
check(p.Play_KickInfoApply(slotX, JSON.parse(chanBText)) === false && slotX.data === rowXqc, 'apply: other channel in the slot, slot untouched');
check(p.Play_KickInfoApply({data: rowXqc}, Object.assign({}, chanX, {livestream: null})) === false, 'apply: ended stream');
const slotB = {data: s.KickApi_ChannelLiveCell(Object.assign(JSON.parse(chanBText), {livestream: Object.assign({}, chanB.livestream, {viewer_count: 5})}))};
check(slotB.data[13] === 5 && p.Play_KickInfoApply(slotB, JSON.parse(chanBText)) === true && slotB.data[13] === chanB.livestream.viewer_count && slotB.data[7] === 'kick:7001', 'apply: fresh viewers and id');
check(s.PlayHLS_Id(tw({6: 'robdiesalot'})) === 'robdiesalot' && s.PlayHLS_Id(rowBuddha) === 'kick:buddha', 'mixed multistream ids');
check(s.PlayHLS_Id(rowBuddha) === 'kick:buddha' && s.PlayHLS_Id(rowXqc) === 'kick:xqc', 'kick/kick multistream ids');

const ev = [];
Object.assign(p, {
    PlayExtra_data: {data: rowBuddha.slice()}, Play_MultiArray: [{data: rowXqc.slice()}, {data: tw()}, {data: rowBuddha.slice()}, {data: []}], Play_updateStreamInfoMultiId: [],
    twemoji: {parse: x => 'T' + x}, PlayExtra_UpdatePanel: () => ev.push('panel'), Play_MultiUpdateInfo: (...a) => ev.push(a.join('|')), Play_MultiUpdateStreamLogoEnd: pos => ev.push('logo' + pos),
    Play_updateStreamInfoMultiError: pos => ev.push('merr' + pos), Play_controls: [{setLabel: x => ev.push('ctl')}, {setLabel: x => ev.push('ctl')}], Play_controlsChanelCont: 0, Play_controlsGameCont: 1, Play_Multi_MainBig: false,
    Main_Set_history: (t, d) => ev.push('hist' + d[14]), Play_updateStreamInfoGetError: e => ev.push('err' + e), Play_updateStreamInfoGet: () => full.push('helix'), Main_helix_api: 'h/', Play_updateStreamInfoMultiValues: () => {}
});
extract('app/specific/PlayExtra.js', ['PlayExtra_updateStreamInfo'], p);
extract('app/specific/PlayMulti.js', ['Play_updateStreamInfoMulti'], p);
full.length = 0;
p.PlayExtra_updateStreamInfo();
check(full.length === 1 && full[0][0] === 'https://kick.com/api/v2/channels/buddha' && full[0][2].name === 'Play_KickInfoResult' && full[0][4] === -2 && full[0][5] === p.PlayExtra_updateStreamInfoKickId, 'pip: kick channel request, key -2');
p.Main_values.Main_selectedChannelPartner = true;
const oldBuddha = p.PlayExtra_data.data;
p.KickApi_LiveCache = {};
p.Play_KickInfoResult({status: 200, responseText: chanBText}, -2, full[0][5] - 1);
p.Play_KickInfoResult({status: 200, responseText: chanXText}, -2, full[0][5]);
check(ev.length === 0 && p.PlayExtra_data.data === oldBuddha, 'pip: stale id and other channel ignored');
p.Play_KickInfoResult({status: 200, responseText: chanBText}, -2, full[0][5]);
check(p.PlayExtra_data.data[13] === chanB.livestream.viewer_count && ev.join() === 'histkick:buddha,panel' && p.Main_values.Main_selectedChannelPartner === true, 'pip: fresh row, history and panel, main partner flag untouched');
check(p.KickApi_LiveCache.buddha && p.KickApi_LiveCache.buddha[13] === chanB.livestream.viewer_count && p.KickApi_LiveCache.buddha !== p.PlayExtra_data.data, 'ruling 7: refreshed row also cached (copy)');
ev.length = 0;
p.Play_KickInfoResult({status: 200, responseText: JSON.stringify(Object.assign({}, chanB, {livestream: null}))}, -2, full[0][5]);
check(ev.join() === 'err0', 'pip: ended stream only keeps the watching time');
p.PlayExtra_data.data = tw();
full.length = 0;
p.PlayExtra_updateStreamInfo();
check(full.length === 1 && full[0] === 'helix', 'pip: twitch slot goes the helix way');

ev.length = 0;
full.length = 0;
p.Play_updateStreamInfoMulti(0);
p.Play_updateStreamInfoMulti(2);
check(full.length === 2 && full[0][0].endsWith('/xqc') && full[1][0].endsWith('/buddha') && full[0][4] === 0 && full[1][4] === 2 && full[1][5] === p.Play_updateStreamInfoMultiId[2], 'multi: kick slots request their channel');
p.Main_values.Main_selectedChannelPartner = true;
p.Play_KickInfoResult({status: 200, responseText: chanBText}, '2', full[1][5] - 1);
p.Play_KickInfoResult({status: 200, responseText: chanXText}, '2', full[1][5]);
check(ev.length === 0, 'multi: stale id and other channel ignored');
p.Play_KickInfoResult({status: 200, responseText: chanBText}, '2', full[1][5]);
check(p.Play_MultiArray[2].data[13] === chanB.livestream.viewer_count && ev[0].indexOf(chanB.livestream.viewer_count) !== -1 && ev[1] === 'logo2' && ev[2] === 'histkick:buddha' && p.Main_values.Main_selectedChannelPartner === true, 'multi: fresh row shown in its slot, main partner flag untouched');
ev.length = 0;
p.Play_KickInfoResult({status: 200, responseText: chanXText}, 0, full[0][5]);
check(p.Play_MultiArray[0].data[13] === chanX.livestream.viewer_count && ev[0] === 'ctl' && ev[1] === 'ctl', 'multi: slot 0 also updates the player labels');
ev.length = 0;
p.Play_KickInfoResult({status: 0, responseText: ''}, 2, full[1][5]);
check(ev.join() === 'merr2', 'multi: failed request keeps the watching time');
full.length = 0;
p.Play_updateStreamInfoMulti(1);
check(full.length === 1 && full[0] === 'helix', 'multi: twitch slot goes the helix way');

// Swap of main and PiP: the Java players and the JS data/chat always swap together (a JS only swap showed the
// title and chat of one stream over the video of the other)
const sw = {calls: [], Main_IsOn_OSInterface: true, Main_values: {Main_Go: 0}, Main_aGame: 5, Main_SaveValues: () => {}, Play_isFullScreen: false, Play_volumes: [1, 2],
    Play_data: {data: ['', 'Tw'], playlist: 'a'}, PlayExtra_data: {data: ['', 'Ki'], playlist: 'b'}, PlayExtra_data_old: null,
    OSInterface_mSwitchPlayer: () => sw.calls.push('java'), ChatLive_Switch: () => sw.calls.push('chatSwitch'), Play_UpdateMainStream: (a, b) => sw.calls.push('main' + a),
    PlayExtra_UpdatePanel: () => sw.calls.push('panel'), Main_innerHTML: () => {}, STR_SPACE_HTML: ' ', Play_SetExternalQualities: () => {}, Play_extractQualities: () => [], Play_SetAudioIcon: () => {},
    Play_showWarningMiddleDialog: () => {}, Play_GetErrorCode: () => '', Play_CloseSmall: () => sw.calls.push('close'), STR_LIVE: '', STR_IS_OFFLINE: '', STR_PLAYER_ERROR: '', STR_BR: '', STR_PLAYER_ERROR_MULTI: '', STR_PLAYER_LAG_ERRO: '', Main_Set_history: () => {}};
vm.createContext(sw);
extract('app/specific/PlayExtra.js', ['PlayExtra_SwitchPlayer', 'PlayExtra_SwitchPlayerStoreOld', 'PlayExtra_SwitchPlayerResStoreOld', 'PlayExtra_End_success'], sw);
sw.PlayExtra_SwitchPlayer();
check(sw.calls[0] === 'java' && sw.calls.filter(c => c === 'java').length === 1 && sw.calls.indexOf('chatSwitch') !== -1 && sw.Play_data.data[1] === 'Ki' && sw.PlayExtra_data.data[1] === 'Tw', 'swap: java swap inside PlayExtra_SwitchPlayer, data and chat swapped');
sw.calls.length = 0;
sw.Play_isFullScreen = true;
sw.PlayExtra_SwitchPlayer();
check(sw.calls.filter(c => c === 'java').length === 1 && sw.calls.indexOf('maintrue') !== -1 && sw.calls.indexOf('chatSwitch') === -1, 'swap in the big-small layout: java swap once, main chat restarted');
sw.calls.length = 0;
sw.PlayExtra_End_success(true, 1);
check(sw.calls.filter(c => c === 'java').length === 1 && sw.calls.indexOf('close') !== -1, 'main ended: exactly one java swap before the PiP closes');

// The Java swap is only in PlayExtra_SwitchPlayer (callers must not pair it themselves)
const swapSrc = fs.readdirSync('app/specific').filter(f => /\.js$/.test(f) && f !== 'OSInterface.js').map(f => ({f, n: (fs.readFileSync('app/specific/' + f, 'utf8').match(/OSInterface_mSwitchPlayer\(/g) || []).length})).filter(x => x.n);
check(swapSrc.length === 1 && swapSrc[0].f === 'PlayExtra.js' && swapSrc[0].n === 1, 'OSInterface_mSwitchPlayer( appears once, in PlayExtra.js');

// Ruling 9: a kick vod never shows the partner badge of an earlier twitch channel
const pv = {};
const deep = () => new Proxy(function () {}, {get: (t, k) => (k === Symbol.toPrimitive ? () => '' : deep()), apply: () => deep()});
const vodUndeclared = [];
// every global the big function touches becomes a stub, only the partner flag logic is real
UglifyJS.parse(fs.readFileSync('app/specific/PlayVod.js', 'utf8')).walk(new UglifyJS.TreeWalker(node => {
    if (node instanceof UglifyJS.AST_Defun && node.name.name === 'PlayVod_Start') {
        node.walk(new UglifyJS.TreeWalker(n => { if (n instanceof UglifyJS.AST_SymbolRef) vodUndeclared.push(n.name); }));
    }
}));
vodUndeclared.forEach(n => { pv[n] = deep(); });
const partnerSeen = [];
Object.assign(pv, {Main_values: {Main_selectedChannelPartner: true}, Main_vodOffset: 0, Main_values_Play_data: rowXqc, PlayClip_IsKick: () => pv.Main_values_Play_data[19] === 'kick', Play_partnerIcon: (n, partner) => { partnerSeen.push(partner); return ''; }});
vm.createContext(pv);
extract('app/specific/PlayVod.js', ['PlayVod_Start'], pv);
pv.PlayVod_Start();
check(partnerSeen[0] === false && pv.Main_values.Main_selectedChannelPartner === false, 'kick vod: partner flag cleared before the panel draws');
pv.Main_values.Main_selectedChannelPartner = true;
pv.Main_values_Play_data = tw();
pv.PlayVod_Start();
check(partnerSeen[1] === true, 'twitch vod: partner flag untouched');

// Task 4: channel page and Kick list screens
const t4 = sandbox(), req = [], cnt = {failed: 0, validated: 0, appToken: 0, accepted: 0};
vm.runInContext(fs.readFileSync('app/specific/Navigation.js', 'utf8'), t4);
Object.assign(t4, {
    AddUser_UsernameArray: [{id: 'alex', name: 'alex'}], ScreenObj: {}, FullxmlHttpGet: (...a) => req.push(a),
    Screens_concatenate: () => cnt.accepted++, Screens_loadDataFail: () => cnt.failed++, AddCode_validateToken: () => cnt.validated++,
    AddCode_AppToken: () => cnt.appToken++, AddUser_UserHasToken: () => true, AddUser_UserIsSet: () => true,
    Main_Bearer_User_Headers: [['Client-ID', 'tw']], Main_Bearer_Headers: [['Client-ID', 'tw']], Main_TwitchV5Flag: '',
    Main_ThumbOpenIsNull: () => false, Screens_addFocus: () => {}, Main_showWarningDialog: () => {},
    Main_history_Watched_Obj: {}, Screens_ActionsButtonHtml: () => '', STR_SPACE_HTML: ' ', Search_SessionEnd: () => {}, STR_STARTED: ' ', STR_CREATED_AT: ' ', STR_DURATION: ' ', STR_PLAYING: ' ', STR_STREAM_ON: ' ', STR_WATCHED: ' ', STR_UNTIL: ' ', STR_VIEWS: ' ', STR_SINCE: ' ', Play_timeS: x => 'T' + x, Main_GetViewsStrings: () => '', Main_videoCreatedAtWithHM: () => ''
});
t4.Navigation_SetAccount('alex');
extract('app/specific/Screens.js', ['Screens_loadDataRequest', 'Screens_HttpResultStatus', 'Screens_createCellVod', 'Screens_createCellClip'], t4);
extract('app/specific/ScreensObj.js', ['ScreensObj_KickVodItems', 'ScreensObj_KickClipItems', 'ScreensObj_KickClipsUrl', 'ScreensObj_KickClipPage'], t4);
t4.ScreenObj[9] = {isKick: true, url: 'https://kick.com/api/v2/channels/xqc/videos', set_url() {}, itemsCount: 0, DataObj: {}, posY: 0, posX: 0, thumbclass: 'x', img_404: 'i', screenType: 1};
t4.Screens_loadDataRequest(9);
check(req[0][0] === 'https://kick.com/api/v2/channels/xqc/videos' && req[0][2].name === 'Screens_HttpResultStatus' && !req[0][1].some(h => h[0] === 'Client-ID'), 'kick screen: kick url, no twitch headers');
req[0][2]({status: 401, responseText: ''}, 9, String(req[0][5]));
check(cnt.failed === 1 && cnt.validated === 0 && cnt.appToken === 0, 'kick 401/403: plain failure, twitch token never validated');
t4.Screens_loadDataRequest(9);
req[1][2]({status: 200, responseText: '[]'}, 9, String(req[0][5]));
check(cnt.accepted === 0, 'older kick request discarded');
req[1][2]({status: 200, responseText: '[]'}, 9, String(req[1][5]));
check(cnt.accepted === 1, 'latest kick request accepted');
const vods = ref('kick_videos.json'), items = t4.ScreensObj_KickVodItems(vods, {slug: 'xqc', name: 'xQc'});
check(items.length === vods.filter(x => !x.is_live).length && items.every(i => i.kickCell[19] === 'kick' && i.id.indexOf('kick:') === 0) && !items.some(i => i.kickCell[11] === 0), 'vod items, running stream skipped');
check(t4.ScreensObj_KickClipItems(ref('kick_clips.json')).length === ref('kick_clips.json').clips.length, 'clip items');
const evil = '<img src=x onerror=1><script>x</script>';
const evilVod = t4.ScreensObj_KickVodItems([{video: {uuid: 'a1'}, session_title: evil, duration: 5000, categories: [{name: evil}]}], {slug: 'xqc', name: evil});
const evilClip = t4.ScreensObj_KickClipItems({clips: [{id: 'clip_1', title: evil, clip_url: 'https://clips.kick.com/a.m3u8', category: {name: evil}, channel: {slug: 'xqc', username: evil}}]});
t4.ScreenObj[9].DataObj = {};
const ids10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const html = t4.Screens_createCellVod('0_0', ids10, evilVod[0].kickCell, 9) + t4.Screens_createCellClip('0_1', ids10, evilClip[0].kickCell, 9);
check(html.length > 100 && html.indexOf('<img src=x') === -1 && html.indexOf('<script') === -1, 'malicious kick vod and clip text never reaches the card html raw');
const pg1 = t4.ScreensObj_KickClipPage({clips: ref('kick_clips.json').clips, nextCursor: {view: 0, id: 'clip_9'}}, null);
check(pg1.cursor === '{"view":0,"id":"clip_9"}' && pg1.dataEnded === false && pg1.items.length === 5, 'clip page: object cursor stringified, more pages');
check(t4.ScreensObj_KickClipPage({clips: [], nextCursor: 'c2'}, 'c1').dataEnded === true, 'clip page: empty page ends the list');
check(t4.ScreensObj_KickClipPage({clips: ref('kick_clips.json').clips, nextCursor: 'c1'}, 'c1').dataEnded === true, 'clip page: cursor that did not move ends the list');
check(t4.ScreensObj_KickClipPage({clips: ref('kick_clips.json').clips}, 'c1').dataEnded === true && t4.ScreensObj_KickClipPage({clips: []}, null).cursor === null, 'clip page: no cursor ends the list');
check(t4.ScreensObj_KickClipsUrl('xqc', '{"view":0,"id":"c"}') === 'https://kick.com/api/v2/channels/xqc/clips?cursor=%7B%22view%22%3A0%2C%22id%22%3A%22c%22%7D' && t4.ScreensObj_KickClipsUrl('xqc', null) === 'https://kick.com/api/v2/channels/xqc/clips', 'clip url encodes the cursor');
check(s.KickApi_RowId(null) === null && s.KickApi_RowId(undefined) === null && s.KickApi_RowId('a-1') === 'kick:a-1' && s.KickApi_RowId(5) === 'kick:5', 'null and undefined ids are unsafe');

// Channel page
const u = sandbox(), ureq = [], loaded = [], labels = [];
vm.runInContext(fs.readFileSync('app/specific/ChannelContent.js', 'utf8'), u);
extract('app/specific/AddCode.js', ['AddCode_CheckFollow', 'AddCode_Follow', 'AddCode_UnFollow'], u);
extract('app/specific/Play.js', ['Play_CheckFollow', 'Play_hideFollow'], u);
extract('app/specific/PlayEtc.js', ['Play_FollowUnfollow'], u);
Object.assign(u, {
    Main_values: {Main_selectedChannel_id: 'kick:' + chan.slug, Main_selectedChannel: chan.slug, Main_selectedChannelLogo: '', Main_selectedChannelPartner: true},
    FullxmlHttpGet: (...a) => ureq.push(a), AddUser_UserIsSet: () => true, AddUser_UserHasToken: () => true, AddUser_UsernameArray: [{id: 'alex', access_token: 'x'}],
    Main_helix_api: 'https://api.twitch.tv/helix/', Main_Bearer_User_Headers: [], Main_Bearer_Headers: [], Main_OAuth: 'OAuth ', PlayClip_BaseUrl: 'https://gql.twitch.tv/gql',
    IMG_404_BANNER: 'banner404', IMG_404_LOGO: 'logo404', Play_controlsFollow: 0, Play_controls: [{setLabel: l => labels.push(l)}], STR_NOKEY: 'nokey', Play_isOn: true,
    ChannelContent_loadDataSuccess: () => loaded.push(1), ChannelContent_setFollow: () => {}, Main_showWarningDialog: () => {}, Main_removeEventListener: () => {},
    Main_HideElement: () => {}, ChannelContent_removeFocus: () => {}, Main_ready: () => {}, Screens_init: () => {}, Main_ChannelVod: 1, Main_ChannelClip: 2, AddCode_IsFollowing: false,
    AddCode_RequestCheckFollowSucess: function () {}, AddCode_FollowSucess: function () {}, AddCode_UnFollowSucess: function () {}, clientIdHeader: 'Client-ID', AddCode_backup_client_id: 'c', Bearer_Header: 'Authorization', AddCode_FollowQuery: 'FollowUser %x', AddCode_UnFollowQuery: 'UnfollowUser %x',
    KickFollow_Check: () => false, KickFollow_Set: () => false, AddCode_KickFollowDone: () => {}, Play_showWarningMiddleDialog: () => {}, STR_NOKEY_WARN: 'w'
});
u.ChannelContent_KickRequest();
const kreq = ureq[0];
check(kreq[0] === 'https://kick.com/api/v2/channels/' + chan.slug && kreq[2].name === 'ChannelContent_KickResult' && !kreq[1].some(h => h[0] === 'Client-ID'), 'channel page loads the kick channel, no twitch headers');
const bio = JSON.parse(chanText);
bio.user.bio = '<img src=x onerror=1>';
const bioText = JSON.stringify(bio);
u.ChannelContent_KickResult({status: 200, responseText: bioText}, 0, kreq[5] - 1);
check(loaded.length === 0, 'stale channel result ignored');
u.ChannelContent_KickResult({status: 200, responseText: bioText}, 0, kreq[5]);
check(loaded.length === 1 && u.ChannelContent_responseText[0].kickCell[14] === 'kick:' + chan.slug && u.ChannelContent_responseText[0].kickCell[19] === 'kick', 'live card from the channel');
check(u.ChannelContent_description.indexOf('<img') === -1 && u.Main_values.Main_selectedChannelPartner === false && u.ChannelContent_selectedChannelFollower === (Number(bio.followers_count) || ''), 'bio escaped, kick has no partner badge');
check(u.Main_values.Main_selectedChannelLogo === (u.KickApi_Img(bio.user.profile_pic) || 'logo404'), 'logo from profile_pic or placeholder');
bio.followers_count = '<img src=x>';
u.ChannelContent_KickResult({status: 200, responseText: JSON.stringify(bio)}, 0, kreq[5]);
check(u.ChannelContent_selectedChannelFollower === '', 'string follower count never reaches the page');
bio.followers_count = 1234;
u.ChannelContent_KickResult({status: 200, responseText: JSON.stringify(bio)}, 0, kreq[5]);
check(u.ChannelContent_selectedChannelFollower === 1234, 'numeric follower count kept');
bio.livestream = null;
u.ChannelContent_KickResult({status: 200, responseText: JSON.stringify(bio)}, 0, kreq[5]);
check(u.ChannelContent_responseText === null && loaded.length === 4, 'offline channel: no live card, page still shown');
u.ChannelContent_KickResult({status: 403, responseText: 'blocked'}, 0, kreq[5]);
check(loaded.length === 5 && u.ChannelContent_responseText === null, 'blocked channel request: silent offline page');

// The cached page is keyed by channel id: Twitch xqc and Kick xqc share the login
const starts = [];
Object.assign(u, {
    ChannelContent_StartLoad: () => starts.push(1), Navigation_Render: () => {}, Main_cleanTopLabel: () => {}, Main_CounterDialogRst: () => {}, Main_innerHTML: () => {},
    Main_addEventListener: () => {}, Main_CheckAccessibilityVisible: () => false, Main_A_equals_B: (a, b) => a === b, Main_YRst: () => {}, Main_ShowElement: () => {},
    Main_SaveValuesWithTimeout: () => {}, ChannelContent_addFocus: () => {}, ChannelContent_removeAllFollowFocus: () => {}, ChannelContent_checkUser: () => {},
    Main_UserChannels: -1, Settings_AppLang: 'en', Settings_value: {enable_mature: {defaultValue: 1}}, ChannelContent_Lang: 'en', ChannelContent_enable_mature: 1,
    Main_ChannelContent: 14, ChannelContent_status: true
});
Object.assign(u.Main_values, {Main_selectedChannel: 'xqc', Main_selectedChannel_id: '123', Search_isSearching: false, Main_BeforeChannel: 0, Main_selectedChannelDisplayname: 'x'});
u.ChannelContent_lastselectedChannel = '123';
u.ChannelContent_init();
check(starts.length === 0, 'same twitch channel: cached page reused');
u.Main_values.Main_selectedChannel_id = 'kick:xqc';
u.ChannelContent_init();
check(starts.length === 1, 'kick channel with the same login as the cached twitch page reloads');

// Ruling 7: a kick id never reaches the twitch follow api
ureq.length = 0;
u.AddCode_Channel_id = 'kick:xqc';
u.AddCode_CheckFollow(); u.AddCode_Follow(); u.AddCode_UnFollow();
u.Play_CheckFollow('kick:xqc'); u.Play_FollowUnfollow();
check(labels.length === 1 && labels[0] === 'nokey' && u.AddCode_IsFollowing === false, 'kick id: player follow control hidden');
u.ChannelContent_checkUser();
u.ChannelContent_allowMature = true; u.ChannelContent_cursorY = 0; u.ChannelContent_cursorX = 2;
u.ChannelContent_keyEnter();
check(ureq.length === 0, 'kick id: no twitch follow request from the player, the channel page or the api');
u.AddCode_Channel_id = '123';
u.AddCode_CheckFollow();
check(ureq.length === 1 && ureq[0][0].indexOf('channels/followed') !== -1, 'twitch id: follow check unchanged');
u.Main_values.Main_selectedChannel_id = '123';
u.ChannelContent_keyEnter();
check(ureq.length === 2 && ureq[1][7].indexOf('FollowUser') !== -1, 'twitch channel page follow still posts to gql');

// Task 5: Kick vod and clip playback
const pc = {noop_fun: () => {}, Main_Log: () => {}};
pc.window = pc;
vm.createContext(pc);
['thirdparty/twemoji.js', 'specific/ChatMulti.js', 'specific/KickApi.js'].forEach(f => vm.runInContext(fs.readFileSync('app/' + f, 'utf8'), pc, {filename: f}));
extract('app/specific/Screens.js', ['Screens_AriaEscape'], pc);
extract('app/specific/PlayClip.js', ['PlayClip_IsKick', 'PlayClip_loadDataRequest', 'PlayClip_KickResult', 'PlayClip_onPlayer', 'PlayClip_loadDataError'], pc);
extract('app/specific/PlayVod.js', ['PlayVod_get_vod_info'], pc);
extract('app/specific/ChatVod.js', ['Chat_Init'], pc);
const kclip = Object.assign({}, ref('kick_clips.json').clips[0]);
const vreq = [], vhist = [], vstarted = [], vlines = [], qs = [], verrs = [];
Object.assign(pc, {
    FullxmlHttpGet: (...a) => vreq.push(a), Main_Set_history: (...a) => vhist.push(a), Main_IsOn_OSInterface: true, PlayClip_isOn: true, PlayClip_replayOrNext: false,
    OSInterface_StartAuto: (...a) => vstarted.push(a), OSInterface_gettime: () => 0, BrowserTestStartClip: () => {}, Play_ChatEnable: false, Play_isChatShown: () => true,
    Play_SetFullScreen: () => {}, Play_SetControlsVisibilityPlayer: () => {}, Play_isFullScreen: true, STR_KICK_NO_VOD_CHAT: 'nochat', PlayClip_QualityStart: q => qs.push(q),
    noop_fun: () => {}, Main_values: {ChannelVod_vodId: null, Play_ChatForceDisable: false, Main_selectedChannel_id: 'kick:xqc', Main_selectedChannel: 'xqc'},
    Chat_Clear: () => {}, Chat_SingleLine: l => vlines.push(l), ChatLive_SetOptions: () => vlines.push('SetOptions'), ChatLive_ElementAdd: () => vlines.push('ElementAdd'),
    Chat_StartFakeClock: () => {}, Chat_Id: [0], Chat_JustStarted: false, Chat_Channels: {}, Main_setTimeout: () => {}, Chat_loadChat: () => {},
    Play_HideBufferDialog: () => verrs.push('buffer'), Play_showWarningDialog: () => {}, Play_PlayEndStart: () => {},
    PlayVod_ProgressBarrUpdate: () => {}, Main_vodOffset: 0, Play_DurationSeconds: 100, PlayVod_isOn: true, PlayClip_loadVodOffsetStartVodId: 1, PlayClip_BaseUrl: 'https://gql.twitch.tv/gql',
    STR_410_ERROR: 'e', Play_base_backup_headers_Array: [], PlayVod_get_vod_infoResult: function () {}, fullVodInfoQuery: 'q %x', STR_LOADING_CHAT: '', STR_SPACE_HTML: '', Chat_title: ''
});
pc.PlayClip_QualityStart = q => { qs.push(q); };
pc.ChannelClip_playUrl = kclip.clip_url;
pc.Main_values_Play_data = s.KickApi_ClipCell(kclip);
check(pc.PlayClip_IsKick() === true, 'kick row detected by [19]');
pc.PlayClip_loadDataRequest();
check(vreq.length === 1 && vreq[0][0] === kclip.clip_url && vreq[0][2].name === 'PlayClip_KickResult' && vreq[0][6] === null && vreq[0][7] === null, 'kick clip fetches its playlist, GET');
const playlist = '#EXTM3U\n#EXTINF:2.000,\n521.ts\n';
pc.PlayClip_KickResult({status: 200, responseText: playlist}, 0, pc.PlayClip_loadDataRequestId - 1);
check(qs.length === 0, 'stale kick clip result ignored');
pc.PlayClip_KickResult({status: 200, responseText: playlist}, 0, pc.PlayClip_loadDataRequestId);
check(pc.PlayClip_KickPlaylist.indexOf('521.ts') !== -1 && qs[0][0].url === kclip.clip_url, 'playlist text kept, quality list carries the clip url');
pc.PlayClip_KickResult({status: 403, responseText: 'blocked'}, 0, pc.PlayClip_loadDataRequestId);
check(verrs.length === 1 && qs.length === 1, 'failed or non playlist answer takes the error path');
pc.PlayClip_playingUrl = kclip.clip_url;
pc.PlayClip_onPlayer();
let vsa = vstarted[0];
check(vsa[2] === 2 && vsa[1] === pc.PlayClip_KickPlaylist && vsa[0] === kclip.clip_url && vsa[4] === 0, 'kick clip plays as hls type 2 with the playlist text');
pc.Main_values_Play_data = ['https://clips.twitch.tv/x', 30, '1', '', 'a', '', 'a', 'slug', null, null, 't', '', '', 1, '1', '', '', '', null, undefined];
pc.PlayClip_playingUrl = 'https://x/y.mp4';
pc.PlayClip_onPlayer();
vsa = vstarted[1];
check(pc.PlayClip_IsKick() === false && vsa[2] === 3 && vsa[1] === '' && vsa[0] === 'https://x/y.mp4', 'twitch clip unchanged: mp4 type 3');
pc.Main_values.ChannelVod_vodId = 'kick:6c22';
pc.Chat_Init();
check(vlines.length === 1 && vlines[0] === 'nochat', 'kick vod: only the no replay notice, no chat options');
pc.Main_values.ChannelVod_vodId = '12345';
vlines.length = 0;
pc.Chat_Init();
check(vlines.indexOf('SetOptions') !== -1, 'twitch vod chat still initialised');
vreq.length = 0;
pc.Main_values.ChannelVod_vodId = 'kick:' + v.video.uuid;
pc.Main_values_Play_data = s.KickApi_VodCell(v, {slug: 'xqc', name: 'xQc'});
pc.PlayVod_get_vod_info();
check(vreq.length === 0 && vhist.length === 1 && vhist[0][0] === 'vod' && vhist[0][1] === pc.Main_values_Play_data, 'kick vod: no gql, row goes to history');
pc.Main_values.ChannelVod_vodId = '12345';
pc.Main_values_Play_data = ['x'];
pc.PlayVod_get_vod_info();
check(vreq.length === 1, 'twitch vod still queries gql');

// Task 7: Kick accounts, QR sign in like the Kick TV app, standalone Kick user and Kick account linked to a Twitch user
{
    let clock = 1e12, tid = 0, warnings = 0, saves = 0;
    const timers = new Map(), sockets = [], req = [], dom = {}, android = [], helix = [], routed = [];
    const pendingTimers = () => timers.size;
    function advance(ms) {
        const end = clock + ms;
        for (;;) {
            let next = null;
            timers.forEach((t, id) => { if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t]; });
            if (!next) break;
            timers.delete(next[0]);
            clock = next[1].at;
            next[1].fn();
        }
        clock = end;
    }
    class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
    function FakeWebSocket(url) { this.url = url; this.sent = []; this.closed = false; sockets.push(this); }
    FakeWebSocket.prototype.send = function (x) { this.sent.push(x); };
    FakeWebSocket.prototype.close = function () { this.closed = true; };
    const el = id => dom[id] || (dom[id] = {id, text: '', className: 'hide', cls: {}, getAttribute() { return this.pos; }, getContext: () => ({clearRect: () => {}})});
    const strs = ['STR_KICK_ADD_USER', 'STR_KICK_ADD_USER_HINT', 'STR_KICK_LINK', 'STR_KICK_UNLINK', 'STR_KICK_RELOGIN', 'STR_KICK_LOGIN_TITLE', 'STR_KICK_LOGIN_TEXT',
        'STR_KICK_LOGIN_WAIT', 'STR_KICK_LOGIN_EXPIRED', 'STR_KICK_LOGIN_FAIL', 'STR_KICK_SESSION_EXPIRED'];
    const s = {
        noop_fun: () => {}, Main_Log: () => {}, Date: FakeDate, WebSocket: FakeWebSocket,
        Main_setTimeout: (fn, ms, id) => { timers.delete(id); timers.set(++tid, {fn, at: clock + (ms || 0)}); return tid; },
        Main_clearTimeout: id => timers.delete(id),
        FullxmlHttpGet: (...a) => req.push(a), BaseXmlHttpGet: (...a) => helix.push(a), Main_helix_api: 'https://api.twitch.tv/helix/',
        Main_getElementById: el, Main_textContent: (id, t) => { el(id).text = t; }, Main_innerHTML: (id, t) => { el(id).text = t; },
        Main_ShowElement: id => { el(id).className = ''; }, Main_HideElement: id => { el(id).className = 'hide'; },
        Main_isElementShowing: id => el(id).className.indexOf('hide') === -1,
        Main_AddClass: (id, c) => { el(id).cls[c] = true; }, Main_RemoveClass: (id, c) => { el(id).cls[c] = false; },
        PhoneChat_DrawQr: (c, url) => { c.qr = url; }, Main_showWarningDialog: () => warnings++, AddUser_SaveUserArray: () => saves++,
        AddUser_UsernameArray: [{id: '160028137', name: 'lordboos', display_name: 'LordBoos', access_token: 'tw', date: 1}], AddUser_UsernameArrayRemoved: {},
        Main_values_History_data: {}, Main_values: {Main_Go: 1}, Main_Users: 2, Main_addUser: 3, Users_status: true, IMG_404_LOGO: 'img404',
        Users_init: () => routed.push('users_init'), AddUser_exit: () => routed.push('adduser_exit'), Main_SwitchScreen: () => routed.push('switch'),
        AddUser_UpdateSidePanel: () => {}, Main_IsOn_OSInterface: false, Bearer: 'Bearer ', Android: {UpdateUserId: (...a) => android.push(a)},
        KEY_ENTER: 13, KEY_RETURN: 4, KEY_KEYBOARD_BACKSPACE: 8, KEY_LEFT: 37, KEY_RIGHT: 39, KEY_UP: 38, KEY_DOWN: 40, KEY_PLAY: 126, KEY_PLAYPAUSE: 85, KEY_KEYBOARD_SPACE: 32
    };
    strs.forEach(n => { s[n] = n; });
    s.window = s;
    vm.createContext(s);
    ['thirdparty/twemoji.js', 'specific/ChatMulti.js', 'specific/ChatKick.js', 'specific/KickApi.js', 'specific/KickUser.js'].forEach(f => {
        if (fs.existsSync('app/' + f)) vm.runInContext(fs.readFileSync('app/' + f, 'utf8'), s, {filename: f});
    });
    extract('app/specific/Screens.js', ['Screens_AriaEscape'], s);
    extract('app/specific/AddUser.js', ['AddUser_UserFindPos', 'AddUser_IsInUserScreen', 'AddUser_UpdateUser', 'AddUser_UpdateUsersSuccess'], s);
    extract('app/specific/OSInterface.js', ['OSInterface_UpdateUserId'], s);
    extract('app/specific/BackupSync.js', ['GDriveSyncBackupsByArray', 'GDriveBackupObject'], s);

    let i = 0; const vals = [0.1, 0.9, 0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.05];
    const code = s.KickLogin_NewCode(() => vals[i++ % vals.length]);
    check(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(code.uuid) && /^\d{6}$/.test(code.key), 'uppercase v4 uuid, 6 digit key');
    check(s.KickLogin_QrUrl({uuid: 'ABC', key: '123456'}) === 'https://kick.com/tv/login?uuid=ABC&code=123456', 'qr text');
    s.KickLogin_Show({link: -1});
    const ses = s.KickLogin_Session, ws = sockets[0];
    check(ws.url === 'wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.3.0&flash=false', 'pusher url');
    check(dom.kick_login_qr.qr === s.KickLogin_QrUrl(ses) && dom.kick_login_status.text === 'STR_KICK_LOGIN_WAIT' && s.KickLogin_IsVisible() && req.length === 0, 'dialog shows the qr, waits, no request yet');
    ws.onmessage({data: JSON.stringify({event: 'pusher:connection_established', data: '{"socket_id":"1.2"}'})});
    check(JSON.parse(ws.sent[0]).data.channel === 'tv-setup-' + ses.uuid, 'subscribes to tv-setup channel');
    ws.onmessage({data: JSON.stringify({event: 'App\\Events\\SetupTvEvent', channel: 'tv-setup-other', data: '[]'})});
    check(req.length === 0, 'event of another setup channel ignored');
    ws.onmessage({data: JSON.stringify({event: 'App\\Events\\SetupTvEvent', channel: 'tv-setup-' + ses.uuid, data: '[]'})});
    let post = req[req.length - 1];
    check(post[0] === 'https://kick.com/api/tv/link/authenticate/' + ses.uuid && post[6] === 'POST' && post[7] === '{"key":"' + ses.key + '"}' &&
        post[1].some(h => h[0] === 'Content-Type' && h[1] === 'application/json') && !post[1].some(h => h[0] === 'Authorization') && post[2].name === 'KickLogin_AuthResult', 'confirmation posts authenticate');
    s.KickLogin_AuthResult({status: 403, responseText: '{"message":"Invalid setup UUID and Key"}'}, 0, ses.seq);
    check(req.length === 1 && pendingTimers() === 1, '403 keeps waiting with one poll timer');
    advance(3000);
    check(req.length === 2 && req[1][0] === post[0] && pendingTimers() === 0, 'poll posts again after 3 s, next poll after the answer');
    s.KickLogin_AuthResult({status: 200, responseText: '{"token":"1|abc\\r\\nX-Evil: 1"}'}, 0, ses.seq);
    check(req.length === 2 && pendingTimers() === 1, 'token with header breaking characters rejected, keeps waiting');
    s.KickLogin_AuthResult({status: 200, responseText: '{"token":"1|abc"}'}, 0, ses.seq);
    const me = req[req.length - 1];
    check(me[0] === 'https://kick.com/api/v1/user' && me[1].some(h => h[1] === 'Bearer 1|abc') && me[6] === null && me[2].name === 'KickLogin_UserResult' && pendingTimers() === 0, 'token fetches the kick user');
    s.KickLogin_AuthResult({status: 200, responseText: '{"token":"1|abc"}'}, 0, ses.seq);
    check(req.length === 3, 'second token answer (poll and event raced) fetches the user once');
    s.KickLogin_UserResult({status: 200, responseText: JSON.stringify({id: 42, username: 'Tester', email: 'a@b.c', profilepic: 'https://files.kick.com/images/user/42/p.webp'})}, 0, ses.seq);
    const u = s.AddUser_UsernameArray[1];
    check(u.platform === 'kick' && u.id === 'kick:42' && u.access_token === '' && u.kick.token === '1|abc' && u.kick.slug === 'tester' && JSON.stringify(u).indexOf('a@b.c') === -1, 'standalone kick user, no email stored');
    check(u.name === 'tester' && u.display_name === 'Tester' && u.logo === 'https://files.kick.com/images/user/42/p.webp' && u.refresh_token === 0 && u.timeout_id === null && u.kick.id === 42, 'standalone user fields');
    check(ws.closed && s.KickLogin_Session === null && s.Main_values_History_data['kick:42'], 'socket closed, session cleared, history slot created');
    check(!s.KickLogin_IsVisible() && s.Users_status === false && saves === 1 && s.KickUser_IsKickOnly(u) && !s.KickUser_IsKickOnly(), 'dialog hidden, users reload, saved once; main user is not kick only');
    s.KickLogin_Show({link: 0}); const ses2 = s.KickLogin_Session; s.KickLogin_Hide();
    const reqClosed = req.length;
    s.KickLogin_AuthResult({status: 200, responseText: '{"token":"2|x"}'}, 0, ses2.seq);
    check(!s.AddUser_UsernameArray[0].kick && pendingTimers() === 0 && req.length === reqClosed, 'closed dialog: late answers ignored, no request, no timers left');
    const seq3 = s.KickLogin_Accept('3|y', {link: 0}); s.KickLogin_UserResult({status: 200, responseText: '{"id":7,"username":"LordBoos"}'}, 0, seq3);
    check(s.AddUser_UsernameArray[0].kick.username === 'LordBoos' && s.AddUser_UsernameArray[0].date > 1, 'link to twitch user bumps date');
    check(s.AddUser_UsernameArray.length === 2 && s.AddUser_UsernameArray[0].id === '160028137' && s.AddUser_UsernameArray[0].access_token === 'tw', 'linking keeps the twitch user');
    check(s.KickUser_Token() === '3|y', 'token of main user');
    s.KickUser_Expired(); s.KickUser_Expired();
    check(s.KickUser_Token() === '' && warnings === 1, 'expired once warned, token unusable');

    // Relogin of the standalone user updates it in place, a stranger never lands on it
    const seq4 = s.KickLogin_Accept('4|z', {link: 1});
    s.KickLogin_UserResult({status: 200, responseText: JSON.stringify({id: 42, username: 'Tester2', profilepic: 'https://evil.example/p.png'})}, 0, seq4);
    check(s.AddUser_UsernameArray.length === 2 && s.AddUser_UsernameArray[1].kick.token === '4|z' && !s.AddUser_UsernameArray[1].kick.expired &&
        s.AddUser_UsernameArray[1].display_name === 'Tester2' && s.AddUser_UsernameArray[1].logo === 'img404', 'standalone relogin in place, foreign logo dropped');
    const seq5 = s.KickLogin_Accept('5|w', {link: 1});
    s.KickLogin_UserResult({status: 200, responseText: JSON.stringify({id: 9, username: '"><img src=x>', streamer_channel: {slug: 'ok-slug'}})}, 0, seq5);
    const stranger = s.AddUser_UsernameArray[2];
    check(s.AddUser_UsernameArray[1].kick.token === '4|z' && stranger.id === 'kick:9' && stranger.name === 'ok-slug' && stranger.display_name.indexOf('<') === -1, 'other kick account becomes a new user, name escaped');
    const seq6 = s.KickLogin_Accept('6|v', {link: -1});
    s.KickLogin_UserResult({status: 401, responseText: '{}'}, 0, seq6);
    check(s.AddUser_UsernameArray.length === 3, 'failed user request adds nobody');
    const sent = req.length;
    s.KickLogin_Accept('a\nb', {link: -1});
    check(req.length === sent, 'unsafe injected token never sent');
    s.KickLogin_Hide();

    // QR code expires after 5 minutes of polls; OK then makes a new code, Back closes
    s.KickLogin_Show({link: -1});
    const ses7 = s.KickLogin_Session, ws7 = sockets[sockets.length - 1];
    for (let n = 0; n < 100; n++) {
        const before = req.length;
        advance(3000);
        if (req.length > before) s.KickLogin_AuthResult({status: 403, responseText: '{}'}, 0, ses7.seq);
    }
    check(dom.kick_login_status.text === 'STR_KICK_LOGIN_EXPIRED' && ws7.closed && pendingTimers() === 0 && s.KickLogin_IsVisible(), 'code expires after 100 polls: expired text, socket closed');
    s.KickLogin_AuthResult({status: 403, responseText: '{}'}, 0, ses7.seq);
    check(pendingTimers() === 0, 'late 403 after expiry schedules nothing');
    s.KickLogin_HandleKeyDown({keyCode: 13});
    check(s.KickLogin_Session && s.KickLogin_Session.uuid !== ses7.uuid && dom.kick_login_status.text === 'STR_KICK_LOGIN_WAIT' && sockets.length === 4 && !sockets[sockets.length - 1].closed, 'OK after expiry: new code');
    const ses8 = s.KickLogin_Session;
    s.KickLogin_HandleKeyDown({keyCode: 13});
    check(s.KickLogin_Session === ses8, 'OK while waiting keeps the code');
    s.KickLogin_HandleKeyDown({keyCode: 4});
    check(s.KickLogin_Session === null && !s.KickLogin_IsVisible() && sockets[sockets.length - 1].closed && pendingTimers() === 0, 'Back closes');

    // Users: the add kick cell, the third user dialog button and its cursor bounds; Twitch users keep select and remove
    Object.assign(s, {
        Main_FirstLoad: false, Main_CantClick: () => false, Main_keyClickDelayStart: () => {}, Users_setUserDialog: () => {}, Users_clearUserDialog: () => {},
        Users_ids: ['t_', 'i_', 'd_', 'n_', 'c_', 's', 'r_', 'h_', 'ti_'], Main_DataAttribute: 'data-pos', STR_USER_OPTION: 'opt', Users_RemoveCursor: 0,
        Users_isRemoveDialogShown: () => false, Users_showRemoveDialog: () => routed.push('remove_dialog'), AddUser_UserMakeOne: p => routed.push('make ' + p),
        AddUser_init: () => routed.push('add_twitch'), Users_handleKeyBack: () => {}, Main_removeEventListener: () => {}, Users_exit: () => {}
    });
    extract('app/specific/Users.js', ['Users_keyEnter', 'Users_handleKeyEnter', 'Users_handleKeyDown', 'Users_showUserDialog', 'Users_HideUserDialog', 'Users_isUserDialogShown', 'Users_UserCursorSet'], s);
    s.Users_cursorX = 1; s.Users_cursorY = 0;
    s.Users_keyEnter();
    check(s.KickLogin_Session && s.KickLogin_Session.mode.link === -1 && s.KickLogin_IsVisible() && routed.indexOf('add_twitch') === -1, 'second fixed cell opens the kick qr for a new user');
    s.Users_handleKeyDown({keyCode: 4});
    check(!s.KickLogin_IsVisible(), 'users screen hands keys to the visible kick dialog');
    s.Users_cursorX = 0;
    s.Users_keyEnter();
    check(routed.indexOf('add_twitch') !== -1 && !s.KickLogin_IsVisible(), 'first fixed cell still adds a twitch user');
    delete s.AddUser_UsernameArray[0].kick;
    el('c_0_2').pos = 0; el('c_0_3').pos = 1;
    s.Users_cursorX = 2;
    s.Users_showUserDialog();
    check(dom.main_dialog_user_kick.text === 'STR_KICK_LINK' && s.Users_RemoveCursor === 0 && s.Users_isUserDialogShown(), 'twitch user without kick: link button, cursor on the first');
    const right = () => s.Users_handleKeyDown({keyCode: 39}), left = () => s.Users_handleKeyDown({keyCode: 37});
    right(); right();
    check(s.Users_RemoveCursor === 2 && dom.main_dialog_user_kick.cls.button_dialog_focused && !dom.main_dialog_user_remove.cls.button_dialog_focused, 'cursor reaches the kick button');
    right();
    check(s.Users_RemoveCursor === 0, 'right wraps to the first button');
    left();
    check(s.Users_RemoveCursor === 2, 'left wraps to the kick button');
    s.Users_handleKeyEnter();
    check(s.KickLogin_Session.mode.link === 0 && s.KickLogin_Session.mode.id === '160028137' && !s.Users_isUserDialogShown(), 'link opens the qr for this user');
    s.KickLogin_Hide();
    s.Users_showUserDialog(); right();
    s.Users_handleKeyEnter();
    check(routed[routed.length - 1] === 'remove_dialog', 'cursor 1 still removes');
    s.Users_showUserDialog();
    s.Users_handleKeyEnter();
    check(routed[routed.length - 1] === 'make 0', 'cursor 0 still switches user');
    s.AddUser_UsernameArray[0].kick = {id: 7, username: 'LordBoos', slug: 'lordboos', logo: '', token: '3|y', date: 1};
    saves = 0;
    s.Users_showUserDialog(); left();
    check(dom.main_dialog_user_kick.text === 'STR_KICK_UNLINK', 'linked: unlink button');
    s.Users_handleKeyEnter();
    check(!s.AddUser_UsernameArray[0].kick && saves === 1 && s.AddUser_UsernameArray[0].date === clock && routed[routed.length - 1] === 'users_init' && !s.KickLogin_Session, 'unlink drops the kick account, bumps date, reloads');
    s.Users_cursorX = 3;
    s.Users_showUserDialog();
    check(dom.main_dialog_user_kick.text === 'STR_KICK_RELOGIN', 'kick only user: sign in again');
    s.AddUser_UsernameArray[0].kick = {id: 7, token: 't', expired: true};
    s.Users_cursorX = 2;
    s.Users_showUserDialog();
    check(dom.main_dialog_user_kick.text === 'STR_KICK_RELOGIN', 'expired link: sign in again');
    s.Users_HideUserDialog();

    // Backup merge, Twitch bridge and Twitch refresh never get a Kick only user
    const local = [{id: '1', date: 1}];
    s.GDriveSyncBackupsByArray([{id: '1', date: 2, kick: {token: 't'}}, {id: 'kick:42', platform: 'kick', date: 2, kick: {token: 'k'}}], local, {}, {}, true);
    check(local[0].kick.token === 't' && local[1].id === 'kick:42', 'newer backup brings the kick link, standalone kick user added');
    s.Main_IsOn_OSInterface = true;
    s.OSInterface_UpdateUserId(s.AddUser_UsernameArray[1]);
    s.OSInterface_UpdateUserId(s.AddUser_UsernameArray[0]);
    check(android[0].join() === ',,' && android[0][0] === null && android[1][0] === '160028137' && android[1][2] === 'Bearer tw', 'kick only user: no twitch notifications or channels');
    s.AddUser_UpdateUser(1);
    check(helix.length === 0, 'kick only user never asks helix');
    s.AddUser_UpdateUser(0);
    check(helix.length === 1, 'twitch user still refreshed');

    // A Kick only main user drops the Twitch headers of the previous main user (anonymous, as a start without user)
    Object.assign(s, {clientIdHeader: 'Client-ID', Chat_token: 'anon', AddCode_backup_client_id: 'tv', Bearer_Header: 'Authorization', Main_OAuth: 'OAuth ', Main_OAuth_User_Headers: [], Main_Bearer_User_Headers: []});
    extract('app/specific/AddUser.js', ['AddUser_SetUserHeaders', 'AddUser_UserHasToken', 'AddUser_UserIsSet'], s);
    extract('app/specific/Main.js', ['HttpGetSetUserHeader'], s);
    s.AddUser_SetUserHeaders();
    check(s.Play_Headers.indexOf('OAuth tw') !== -1 && s.Main_Bearer_User_Headers[1][1] === 'Bearer tw', 'twitch main user: its token in the headers');
    const twitchMain = s.AddUser_UsernameArray[0];
    s.AddUser_UsernameArray[0] = s.AddUser_UsernameArray[1];
    s.AddUser_SetUserHeaders();
    check(s.Play_Headers === '[["Client-ID","anon"]]' && s.Main_OAuth_User_Headers.length === 0 && s.Main_Bearer_User_Headers.length === 0, 'kick only main user: no twitch token left in the headers');
    s.AddUser_UsernameArray[0] = twitchMain;
    s.AddUser_SetUserHeaders();

    // Switch, removal and token validation removal of the main user, run through the real functions
    Object.assign(s, {
        Main_CheckResumeFeedId: null, Main_history_SetVod_Watched: () => {}, Main_UpdateBlockedHomeScreen: () => {}, Main_RunVODWorker: () => {}, Main_RunClipWorker: () => {},
        Users_init: () => {}, AddUser_UpdateSidePanelDefault: () => {}, OSInterface_mCheckRefresh: () => {}, Settings_notification_check_any_enable: () => false,
        Main_SaveValues: () => {}, STR_NO_TOKEN_WARNING: 'w', STR_USER_TOKEN_ERROR: 'e'
    });
    extract('app/specific/AddUser.js', ['AddUser_UserMakeOne', 'AddUser_removeUser', 'AddUser_SaveNewUserRefreshTokens'], s);
    extract('app/specific/AddCode.js', ['AddCode_validateTokenSuccess'], s);
    const anon = '[["Client-ID","anon"]]', authorized = h => JSON.parse(h).some(x => x[0] === 'Authorization');
    const warnBefore = warnings;
    s.AddUser_UserMakeOne(1);
    check(s.AddUser_UsernameArray[0].id === 'kick:42' && s.Play_Headers === anon && !s.Main_OAuth_User_Headers.length && !s.Main_Bearer_User_Headers.length && warnings === warnBefore,
        'switch to a kick only user: anonymous twitch headers, no token warning');
    s.AddUser_UserMakeOne(1);
    check(s.AddUser_UsernameArray[0].id === '160028137' && s.Play_Headers.indexOf('OAuth tw') !== -1 && s.Main_Bearer_User_Headers[1][1] === 'Bearer tw', 'switch back to the twitch user: its token again');
    // Twitch refuses the main user token (401): the user is removed, the next main user is Kick only
    s.AddCode_validateTokenSuccess({status: 401, responseText: ''}, 0);
    const removedTw = s.AddUser_UsernameArrayRemoved['160028137'];
    check(s.KickUser_IsKickOnly() && !authorized(s.Play_Headers) && s.Play_Headers === anon && !s.Main_OAuth_User_Headers.length && !s.Main_Bearer_User_Headers.length,
        'token validation removal: a kick only new main user gets no empty twitch authorization');
    check(removedTw.access_token === 'tw' && removedTw.name === 'lordboos' && !('kick' in removedTw) && removedTw.date === clock, 'removed copy keeps the twitch fields, never the kick session');
    s.AddUser_removeUser(0, true);
    check(s.AddUser_UsernameArrayRemoved['kick:42'] && !('kick' in s.AddUser_UsernameArrayRemoved['kick:42']) && JSON.stringify(s.AddUser_UsernameArrayRemoved).indexOf('4|z') === -1, 'removed kick only user: no kick token kept or uploaded');
    // Twitch only: the same path still installs the token of the new Twitch main user
    s.AddUser_UsernameArray = [{id: '1', name: 'a', display_name: 'A', access_token: 'ta', date: 1}, {id: '2', name: 'b', display_name: 'B', access_token: 'tb', date: 1}];
    s.AddCode_validateTokenSuccess({status: 401, responseText: ''}, 0);
    check(s.AddUser_UsernameArray[0].id === '2' && s.Play_Headers.indexOf('OAuth tb') !== -1 && s.Main_Bearer_User_Headers[1][1] === 'Bearer tb', 'twitch only: new main user token, unchanged');
    // The last Twitch user removed in this run, then a Kick only user is the first user: its token must not stay in the headers
    s.AddUser_removeUser(0, true);
    check(s.AddUser_UsernameArray.length === 0 && s.Play_Headers.indexOf('OAuth tb') !== -1, 'no user left (upstream keeps the last headers)');
    check(s.KickUser_Store({id: 50, username: 'Solo'}, '7|q', {link: -1}) && s.KickUser_IsKickOnly() && s.Play_Headers === anon && !s.Main_OAuth_User_Headers.length,
        'first user is kick only: no twitch token of a removed user left');
    check(!s.KickUser_IsKickOnly(undefined) && !s.KickUser_IsKickOnly(s.AddUser_UsernameArray[3]) && !s.KickUser_IsKickOnly(null), 'explicit undefined or stale user is not kick only, only the no argument call means the main user');

    const en = fs.readFileSync('app/languages/en_US.js', 'utf8'), decl = fs.readFileSync('app/languages/0_Strings.js', 'utf8');
    const values = {STR_KICK_ADD_USER_HINT: 'Press OK to sign in with Kick instead', STR_KICK_LINK: 'Link Kick account', STR_KICK_UNLINK: 'Unlink Kick account',
        STR_KICK_RELOGIN: 'Sign in to Kick again', STR_KICK_LOGIN_TITLE: 'Sign in with Kick', STR_KICK_LOGIN_TEXT: 'Scan the code with your phone and confirm in the Kick app',
        STR_KICK_LOGIN_WAIT: 'Waiting for confirmation', STR_KICK_LOGIN_EXPIRED: 'The code expired, press OK for a new one', STR_KICK_LOGIN_FAIL: 'Kick sign in failed',
        STR_KICK_SESSION_EXPIRED: 'Kick sign in expired, sign in again in Users'};
    check(strs.every(n => decl.indexOf('    ' + n + ',') !== -1 && en.indexOf(n + ' = ') !== -1) && Object.keys(values).every(n => en.indexOf(n + " = '" + values[n] + "';") !== -1), 'strings declared with the exact values');
    const html = fs.readFileSync('app/index.html', 'utf8');
    check(html.indexOf('src="specific/KickApi.js"') < html.indexOf('src="specific/KickUser.js"') && html.indexOf('src="specific/KickApi.js"') > -1 && ['dialog_kick_login', 'kick_login_qr', 'kick_login_text', 'kick_login_status', 'main_dialog_user_kick'].every(id => html.indexOf('id="' + id + '"') !== -1), 'script tag and dialog markup');
}

// Task 8: followed Kick live streams merged into Following Live, the player feed and the side panel
{
    const s = sandbox(), req = [], out = [];
    let expired = 0;
    vm.runInContext(fs.readFileSync('app/specific/Navigation.js', 'utf8'), s);
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), s);
    Object.assign(s, {FullxmlHttpGet: (...a) => req.push(a), AddUser_UsernameArray: [{id: 'u', name: 'u', access_token: 'tw'}], AddUser_SaveUserArray: () => {}});

    // Ruling 6: Kick sends full language names, Kick cards keep the [EN] tag the Twitch cards show
    const names = ['English', 'Spanish', 'German', 'Portuguese', 'French', 'Russian', 'Czech', 'Polish', 'Turkish', 'Arabic', 'Japanese', 'Korean', 'Chinese', 'Italian'];
    check(names.map(n => s.KickApi_Lang(n)).join() === 'en,es,de,pt,fr,ru,cs,pl,tr,ar,ja,ko,zh,it', 'full language names mapped to iso codes');
    check(s.KickApi_Lang('Klingon') === '' && s.KickApi_Lang('constructor') === '' && s.KickApi_Lang('toString') === '' && s.KickApi_Lang(null) === '' && s.KickApi_Lang('PT') === 'pt', 'unknown names give no tag, iso codes as before');
    check(s.KickApi_LiveCell(live)[5] === '[EN]' && s.KickApi_LiveCell(live)[15] === 'en', 'following card of the fixture shows [EN]');

    // Decision: the Twitch icon on Twitch cards only while the main user has a working Kick account
    const twRow = ['', 'tw'], kickRow = s.KickApi_LiveCell(live);
    check(s.KickApi_CardIcon(twRow) === '' && s.KickApi_CardIcon(kickRow).indexOf('chat_pi_kick card_pi') !== -1, 'no kick account: no icon on twitch cards (Review Focus 5)');
    s.AddUser_UsernameArray[0].kick = {token: 'K'};
    check(s.KickApi_CardIcon(twRow).indexOf('chat_pi_tw card_pi') !== -1 && s.KickApi_CardIcon(kickRow).indexOf('chat_pi_kick card_pi') !== -1, 'kick linked: twitch icon on twitch cards, kick icon on kick cards');
    s.AddUser_UsernameArray[0].kick.expired = true;
    check(s.KickApi_CardIcon(twRow) === '', 'expired kick session: twitch icons gone');
    delete s.AddUser_UsernameArray[0].kick;

    // Brief block
    const tw = [{viewer_count: 900, user_id: '1'}, {viewer_count: 100, user_id: '2'}];
    const kick = [s.KickApi_Item(s.KickApi_LiveCell(Object.assign({}, live, {viewer_count: 500})), 'a', 'kick:a', false),
                  s.KickApi_Item(s.KickApi_LiveCell(Object.assign({}, live, {viewer_count: 50})), 'b', 'kick:b', false)];
    kick.forEach(k => { k.viewer_count = k.kickCell[13]; });
    check(s.KickFollow_MergeHelix(tw, kick).map(v => v.viewer_count).join() === '900,500,100,50', 'kick inserted by viewers, twitch order kept');
    check(s.KickFollow_MergeHelix([{viewer_count: 5}, {viewer_count: 9}], kick.slice().reverse()).map(v => v.viewer_count).join() === '500,50,5,9', 'twitch order never resorted, kick sorted');
    s.KickUser_Token = () => '';
    s.KickUser_Expired = () => expired++;
    check(!s.KickFollow_Start(5, {data: tw}) && req.length === 0, 'twitch-only user: no kick request (Review Focus 5)');
    s.KickUser_Token = () => 'T';
    s.ScreenObj = {5: {data: null, navigationRequest: {id: 9, account: 'u'}, concatenateAfter: r => out.push(r)}}; s.Navigation_Account = () => 'u';
    check(s.KickFollow_Start(5, {data: tw.slice(), pagination: {}}) && req[0][0] === 'https://kick.com/api/v1/user/livestreams' && req[0][1].some(h => h[1] === 'Bearer T'), 'first page asks kick with the token');
    check(req[0][2].name === 'KickFollow_LiveResult' && req[0][4] === 5 && req[0][5] === 9 && req[0][6] === null && req[0][7] === null, 'named callback, ticket id as checkResult, GET');
    s.Navigation_Account = () => 'other';
    s.KickFollow_LiveResult({status: 200, responseText: JSON.stringify([live])}, 5, 9);
    check(out.length === 0, 'account switched: kick result dropped (Review Focus 4)');
    s.Navigation_Account = () => 'u';
    s.KickFollow_LiveResult({status: 200, responseText: JSON.stringify([live])}, 5, 8);
    check(out.length === 0, 'refreshed screen (older ticket): kick result dropped');
    s.KickFollow_LiveResult({status: 200, responseText: JSON.stringify(ref('kick_user_livestreams.json'))}, 5, 9);
    check(out[0].data.length === 2 + ref('kick_user_livestreams.json').length && out[0].data.some(d => d.kickCell), 'merged first page delivered');
    check(out[0].data[0].kickCell[6] === live.channel.slug && out[0].data[0].user_id === 'kick:' + live.channel.slug && out[0].data[0].id === 'kick:' + live.id && out[0].data[1].user_id === '1', 'kick row by viewers before the twitch rows, ids from the row');
    s.ScreenObj[5].kickPending = {data: tw.slice()}; s.KickFollow_LiveResult({status: 401, responseText: ''}, 5, 9);
    check(out[1].data.length === 2 && expired === 1, 'kick 401: twitch data alone, session expired');
    s.ScreenObj[5].kickPending = {data: tw.slice(), pagination: {cursor: 'c'}};
    s.KickFollow_LiveResult({status: 0, responseText: ''}, 5, 9);
    check(out[2].data.length === 2 && out[2].pagination.cursor === 'c' && expired === 1, 'network error or waf: twitch data and cursor unchanged, silent');
    s.ScreenObj[5].kickPending = {data: tw.slice()};
    s.KickFollow_LiveResult({status: 200, responseText: '<html>blocked</html>'}, 5, 9);
    check(out[3].data.length === 2 && out[3].pagination && expired === 1, 'non json answer: twitch data alone');
    s.KickFollow_LiveResult({status: 200, responseText: '[]'}, 5, 9);
    check(out.length === 4, 'one kick result per twitch page');
    s.ScreenObj[5].kickPending = {data: []};
    s.KickFollow_LiveResult({status: 200, responseText: JSON.stringify([Object.assign({}, live, {id: '1"><img'}), Object.assign({}, live, {channel: Object.assign({}, live.channel, {slug: 'a b'})}),
        Object.assign({}, live, {is_mature: true}), null, 5])}, 5, 9);
    check(out[4].data.length === 1 && out[4].data[0].is_mature === true && out[4].data[0].kickCell[0] === live.thumbnail.src.split('?')[0], 'unsafe kick rows skipped, mature flag and thumbnail kept');
    s.ScreenObj[5].data = [1];
    check(!s.KickFollow_Start(5, {data: tw}) && req.length === 1, 'next page: twitch only');
    const nodes = s.KickFollow_FeedNodes(ref('kick_user_livestreams.json'));
    check(nodes[0].kickCell[19] === 'kick' && nodes[0].stream.viewersCount === ref('kick_user_livestreams.json')[0].viewer_count, 'feed nodes sortable like gql nodes');
    check(nodes[0].stream.broadcaster.id === 'kick:' + live.channel.slug && nodes[0].stream.broadcaster.login === live.channel.slug && nodes[0].stream.game.displayName === nodes[0].kickCell[3] &&
        nodes[0].stream.createdAt === nodes[0].kickCell[12] && nodes[0].stream.is_mature === false, 'feed node: id, login, game, start for the existing sorting');
}

// Task 8: Following Live screen with the real screen object and request path
{
    const s = sandbox(), req = [], got = [];
    vm.runInContext(fs.readFileSync('app/specific/Navigation.js', 'utf8'), s);
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), s);
    let hasToken = true;
    Object.assign(s, {
        FullxmlHttpGet: (...a) => req.push(a), AddUser_UserHasToken: () => hasToken, AddUser_SaveUserArray: () => {}, Main_showWarningDialog: () => {},
        Main_Bearer_User_Headers: [['Client-ID', 'tw'], ['Authorization', 'Bearer tw']], Main_Bearer_Headers: [['Client-ID', 'tw']], Main_OAuth_User_Headers: [], Play_base_backup_headers_Array: [], Main_TwitchV5Flag: '',
        Main_ThumbOpenIsNull: () => false, Screens_addFocus: () => {}, Screens_loadDataFail: () => got.push('fail'), AddCode_validateToken: () => {}, AddCode_AppToken: () => {},
        ScreenObj: {}, Main_UserLive: 1, Main_usergames: 2, Main_Blocked: 3, Main_helix_api: 'https://api.twitch.tv/helix/', Main_ItemsLimitMax: 100,
        Screens_assign: (...o) => Object.assign({}, ...o), Screens_ScreenIds: () => [], Base_Live_obj: {},
        Base_obj: {concatenate(r) { this.concatenateAfter(r); }, concatenateAfter(r) { got.push(r); this.data = r.data || []; }, Set_Scroll() {}}
    });
    extract('app/specific/Screens.js', ['Screens_loadDataRequest', 'Screens_HttpResultStatus', 'Screens_concatenate'], s);
    extract('app/specific/ScreensObj.js', ['ScreensObj_InitUserLive'], s);
    s.ScreensObj_InitUserLive();
    const obj = s.ScreenObj[1], helix = {data: [{viewer_count: 900, user_id: '1'}, {viewer_count: 10, user_id: '2'}], pagination: {cursor: 'c'}};
    // Twitch only user: unchanged request, unchanged data, no kick.com
    s.AddUser_UsernameArray = [{id: '160028137', name: 'lordboos', access_token: 'tw'}];
    s.Screens_loadDataRequest(1);
    check(req.length === 1 && req[0][0].indexOf('https://api.twitch.tv/helix/streams/followed?user_id=160028137') === 0 && req[0][1] === s.Main_Bearer_User_Headers && req[0][2].name === 'Screens_HttpResultStatus', 'twitch user: the existing helix request');
    req[0][2]({status: 200, responseText: JSON.stringify(helix)}, 1, String(req[0][5]));
    check(req.length === 1 && got.length === 1 && JSON.stringify(got[0]) === JSON.stringify(helix), 'twitch only: same data and order, no kick request (Review Focus 5)');
    // Twitch user with a linked Kick account: merged first page, plain next page
    s.AddUser_UsernameArray[0].kick = {token: 'K', slug: 'lordboos'};
    obj.data = null;
    s.Screens_loadDataRequest(1);
    req[1][2]({status: 200, responseText: JSON.stringify(helix)}, 1, String(req[1][5]));
    check(req.length === 3 && req[2][0] === 'https://kick.com/api/v1/user/livestreams' && req[2][1].some(h => h[1] === 'Bearer K') && got.length === 1, 'linked kick: the kick request waits before the page is shown');
    check(!req[1][1].some(h => /K$/.test(h[1])) && !req[2][1].some(h => h[1] === 'Bearer tw'), 'twitch token never to kick, kick token never to twitch');
    req[2][2]({status: 200, responseText: JSON.stringify(ref('kick_user_livestreams.json'))}, 1, req[2][5]);
    check(got.length === 2 && got[1].data.map(d => d.viewer_count).join() === [live.viewer_count, 900, 10].join() && got[1].pagination.cursor === 'c', 'merged by viewers, cursor of the twitch page kept');
    s.Screens_loadDataRequest(1);
    req[3][2]({status: 200, responseText: JSON.stringify(helix)}, 1, String(req[3][5]));
    check(req.length === 4 && got.length === 3, 'next page: no second kick request');
    // Kick only main user: no Twitch request, the Kick part only
    hasToken = false;
    s.AddUser_UsernameArray = [{id: 'kick:42', name: 'solo', platform: 'kick', access_token: '', kick: {token: 'K', slug: 'solo'}}];
    obj.data = null;
    s.Screens_loadDataRequest(1);
    check(req.length === 5 && req[4][0] === 'https://kick.com/api/v1/user/livestreams' && JSON.stringify(obj.kickPending) === '{"data":[],"pagination":{}}', 'kick only: no twitch request, concatenate got the empty twitch page');
    req[4][2]({status: 200, responseText: JSON.stringify(ref('kick_user_livestreams.json'))}, 1, req[4][5]);
    check(got.length === 4 && got[3].data.length === ref('kick_user_livestreams.json').length && got[3].data.every(d => d.kickCell), 'kick only: following live shows only kick');
    s.AddUser_UsernameArray[0].kick.expired = true;
    obj.data = null;
    s.Screens_loadDataRequest(1);
    check(req.length === 5 && got.length === 5 && got[4].data.length === 0, 'kick only, expired: empty page, nothing sent');
}

// Task 8: player feed and side panel
{
    const s = sandbox(), req = [], rows = [], timers = [], holder = [], ends = [];
    vm.runInContext(fs.readFileSync('app/specific/Navigation.js', 'utf8'), s);
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), s);
    Object.assign(s, {
        FullxmlHttpGet: (...a) => req.push(a), AddUser_SaveUserArray: () => {}, Main_showWarningDialog: () => {}, STR_NOKUSER_WARNING: 'NOUSER', STR_REFRESH_PROBLEM: 'REFRESH',
        UserLiveFeedobj_UserLivePos: 5, UserLiveFeed_obj: {5: {}}, UserLiveFeed_itemsCount: {5: 0}, UserLiveFeed_idObject: {5: {}}, UserLiveFeed_cell: {5: []}, UserLiveFeed_PreloadImgs: [], Sidepannel_Html: '',
        UserLiveFeedobj_CreatFeed: (pos, n, id, arr) => { rows.push(arr); return {}; }, UserLiveFeedobj_CreateSideFeed: () => '', Main_innerHTMLWithEle: () => {}, Main_setTimeout: fn => timers.push(fn),
        Settings_Obj_default: () => 0, UserLiveFeedobj_FeedSort: [[null, 'viewersCount', 0]], ScreensObj_CheckIsMature: c => !c.is_mature, ScreensObj_LiveQueryCellArray: c => ['tw:' + c.stream.broadcaster.id],
        Main_OAuth_User_Headers: [['Authorization', 'OAuth tw']], userLiveQuery: '{%y}', UserLiveFeedobj_AddBanner: () => {}, UserLiveFeedobj_Empty: () => holder.push('empty'), UserLiveFeedobj_HolderDiv: (p, t) => holder.push(t),
        UserLiveFeedobj_SetLastPosition: () => {}, Main_values: {}, Sidepannel_FindClosest: () => {}, Sidepannel_PreloadImgs: () => {}, UserLiveFeed_loadDataSuccessFinish: () => {}, Settings_notification_check_any_enable: () => false,
        UserLiveFeed_loadingData: {}, UserLiveFeed_Showloading: () => {}, Main_HideElementWithEle: () => {}, UserLiveFeed_isPreviewShowing: () => true, UserLiveFeed_FeedPosX: 5, Sidepannel_isShowingUserLive: () => false,
        AddUser_UserIsSet: () => s.AddUser_UsernameArray.length > 0, AddUser_UserHasToken: () => !!(s.AddUser_UsernameArray[0] && s.AddUser_UsernameArray[0].access_token),
        Sidepannel_SidepannelLoadingDialog: {}, Sidepannel_handleKeyDownMain: () => {}, Sidepannel_ScroolDoc: {}
    });
    // a new feed load starts empty (UserLiveFeedobj_StartDefault)
    const reset = () => { rows.length = 0; timers.length = 0; holder.length = 0; s.UserLiveFeed_idObject[5] = {}; s.UserLiveFeed_itemsCount[5] = 0; };
    extract('app/specific/UserLiveFeedobj.js', ['UserLiveFeedobj_loadChannelUserLive', 'UserLiveFeedobj_loadChannelUserLiveGetEnd', 'UserLiveFeedobj_loadDataSuccess', 'UserLiveFeed_loadDataSuccessEnd', 'UserLiveFeedobj_loadDataError'], s);
    const gql = {data: {currentUser: {followedLiveUsers: {pageInfo: {hasNextPage: false}, edges: [
        {cursor: 'a', node: {stream: {viewersCount: 900, broadcaster: {id: '1', login: 'a'}}}}, {cursor: 'b', node: {stream: {viewersCount: 3, broadcaster: {id: '2', login: 'b'}}}}]}}}};
    // Twitch only user: one GQL request, rows as before
    s.AddUser_UsernameArray = [{id: '1', name: 'a', access_token: 'tw'}];
    s.UserLiveFeedobj_loadChannelUserLive();
    check(req.length === 1 && req[0][0] === 'https://gql.twitch.tv/gql' && req[0][6] === 'POST', 'feed: twitch only sends the gql request');
    req[0][2]({status: 200, responseText: JSON.stringify(gql)}, 5, String(req[0][5]));
    check(req.length === 1 && rows.map(r => r[0]).join() === 'tw:1,tw:2', 'feed: twitch only rows, no kick request (Review Focus 5)');
    // Linked Kick account: Kick nodes join the first load and the existing live_feed_sort orders all of them
    s.AddUser_UsernameArray[0].kick = {token: 'K'};
    reset();
    s.UserLiveFeedobj_loadChannelUserLive();
    req[1][2]({status: 200, responseText: JSON.stringify(gql)}, 5, String(req[1][5]));
    check(req.length === 3 && req[2][0] === 'https://kick.com/api/v1/user/livestreams' && req[2][1].some(h => h[1] === 'Bearer K') && req[2][2].name === 'Navigation_FeedFullResult' && rows.length === 0, 'feed: kick asked through a feed ticket before drawing');
    req[2][2]({status: 200, responseText: JSON.stringify(ref('kick_user_livestreams.json'))}, 5, String(req[2][5]));
    check(rows.length === 3 && rows[0][19] === 'kick' && rows[0][14] === 'kick:' + live.channel.slug && rows[1][0] === 'tw:1' && rows[2][0] === 'tw:2', 'feed: kick row sorted by viewers among twitch rows');
    check(s.UserLiveFeed_idObject[5]['kick:' + live.channel.slug] === 0, 'feed: kick row position by its kick id (side panel restore)');
    reset();
    s.UserLiveFeedobj_loadChannelUserLive();
    req[3][2]({status: 200, responseText: JSON.stringify(gql)}, 5, String(req[3][5]));
    s.Navigation_FeedGenerations[5] = (s.Navigation_FeedGenerations[5] || 0) + 1;
    req[4][2]({status: 200, responseText: JSON.stringify(ref('kick_user_livestreams.json'))}, 5, String(req[4][5]));
    check(rows.length === 0, 'feed: kick answer of an older feed load dropped');
    reset();
    s.UserLiveFeedobj_loadChannelUserLive();
    req[5][2]({status: 200, responseText: JSON.stringify(gql)}, 5, String(req[5][5]));
    req[6][2]({status: 0, responseText: ''}, 5, String(req[6][5]));
    check(rows.map(r => r[0]).join() === 'tw:1,tw:2', 'feed: kick failure leaves the twitch rows');
    // Kick only main user: no Twitch request, only the Kick part, no "add a user" text
    s.AddUser_UsernameArray = [{id: 'kick:42', name: 'solo', platform: 'kick', access_token: '', kick: {token: 'K'}}];
    reset();
    s.UserLiveFeedobj_loadChannelUserLive();
    check(req.length === 8 && req[7][0] === 'https://kick.com/api/v1/user/livestreams', 'feed kick only: no gql request with an empty token');
    req[7][2]({status: 200, responseText: JSON.stringify(ref('kick_user_livestreams.json'))}, 5, String(req[7][5]));
    check(rows.length === 1 && rows[0][19] === 'kick', 'feed kick only: kick rows only');
    s.AddUser_UsernameArray[0].kick.expired = true;
    reset();
    s.UserLiveFeedobj_loadChannelUserLive();
    timers.forEach(fn => fn());
    check(req.length === 8 && rows.length === 0 && holder.join() === 'empty', 'feed kick only, expired: nothing sent, empty text, not the add user warning');
    holder.length = 0;
    s.UserLiveFeed_obj[5].loadingMore = false;
    s.UserLiveFeedobj_loadDataError(5);
    check(holder.join() === 'REFRESH', 'feed error kick only: no add user warning');
    s.AddUser_UsernameArray = [{id: '1', name: 'a', access_token: ''}];
    holder.length = 0;
    s.UserLiveFeedobj_loadDataError(5);
    check(holder.join() === 'NOUSER', 'feed error, twitch user without token: warning as before');

    // Side panel and feed refresh open for a Kick only main user
    const side = [];
    Object.assign(s, {Sidepannel_StartFeed: () => side.push('feed'), Sidepannel_ShowNoUserWarning: () => side.push('warn'), Sidepannel_StartMain: () => side.push('main'), Main_removeEventListener: () => {},
        Sidepannel_IsMain: true, UserLiveFeedobj_loadDataPrepare: () => side.push('prepare'), UserLiveFeedobj_CheckToken: () => side.push('load')});
    extract('app/specific/Sidepannel.js', ['Sidepannel_MainKeyLeft', 'Sidepannel_Start'], s);
    extract('app/specific/UserLiveFeed.js', ['UserLiveFeed_RefreshLive'], s);
    s.AddUser_UsernameArray = [{id: 'kick:42', name: 'solo', platform: 'kick', access_token: '', kick: {token: 'K'}}];
    s.Sidepannel_MainKeyLeft(); s.Sidepannel_Start(null, true); s.UserLiveFeed_RefreshLive();
    check(side.join() === 'feed,feed,prepare,load', 'kick only: side panel feed opens and loads');
    side.length = 0;
    s.AddUser_UsernameArray = [{id: '1', name: 'a', access_token: ''}];
    s.Sidepannel_MainKeyLeft(); s.Sidepannel_Start(null, true); s.UserLiveFeed_RefreshLive();
    check(side.join() === 'warn,warn,main', 'twitch user without token: warning as before');
}

// Ruling 12: a Kick only main user sends no empty-token Twitch game follow, and "My channel" opens its Kick channel
{
    const g = {req: [], warn: 0, hasToken: false};
    Object.assign(g, {
        FullxmlHttpGet: (...a) => g.req.push(a), AddUser_UserIsSet: () => true, AddUser_UserHasToken: () => g.hasToken, AddUser_UsernameArray: [{id: 'kick:42', name: 'solo', access_token: ''}],
        Main_showWarningDialog: () => g.warn++, Main_setTimeout: () => {}, Main_values: {Main_Go: 0, Main_gameSelected_id: '33214'}, Main_aGame: 7, Main_innerHTML: (id, h) => { g.label = h; },
        ScreenObj: {7: {ids: ['', '', 'x']}}, clientIdHeader: 'Client-ID', AddCode_backup_client_id: 'c', Bearer_Header: 'Authorization', Main_OAuth: 'OAuth ', PlayClip_BaseUrl: 'https://gql.twitch.tv/gql',
        AGame_CheckFollowGameQuery: '{%x}', Screens_FollowGameQuery: '{%x}', Screens_UnFollowGameQuery: '{%x}', Screens_FollowGameRequestReady: function Screens_FollowGameRequestReady() {},
        Screens_UnFollowGmaeRequestReady: function Screens_UnFollowGmaeRequestReady() {},
        noop_fun: () => {}, KickApi_IsKickId: id => /^kick:/.test(String(id)), STR_FOLLOW: 'FOLLOW', STR_NOKEY: 'SIGNIN', STR_FOLLOWING: 'FOLLOWING', STR_SPACE_HTML: ' ', STR_SPACE: ' ', STR_NOKEY_WARN: 'w', STR_NO: '', STR_LIVE_GAMES: ''
    });
    vm.createContext(g);
    extract('app/specific/Screens.js', ['AGame_follow', 'AGame_CheckFollow', 'AGame_CheckFollowGame', 'AGame_CheckFollowGameReady', 'AGame_setFollow', 'Screens_FollowUnfollowGame'], g);
    vm.runInContext('var AGame_following = true;', g);
    g.AGame_CheckFollow();
    g.AGame_follow(7);
    check(g.req.length === 0 && g.AGame_following === false && g.warn === 1, 'kick only: no empty-token game follow request, warning instead');
    g.Main_values.Main_Go = 7;
    g.AGame_setFollow();
    check(g.label.indexOf('SIGNIN') !== -1, 'kick only: game follow label asks for a twitch sign in');
    g.hasToken = true;
    g.AddUser_UsernameArray[0] = {id: '1', name: 'a', access_token: 'tw'};
    g.AGame_CheckFollow();
    g.AGame_follow(7);
    check(g.req.length === 2 && g.req[0][1][1][1] === 'OAuth tw' && g.req[1][1][1][1] === 'OAuth tw' && g.warn === 1, 'twitch user with token: check and follow requests unchanged');
    g.AGame_setFollow();
    check(g.label.indexOf('FOLLOW') !== -1 && g.label.indexOf('SIGNIN') === -1, 'twitch user: follow label unchanged');

    const m = {calls: []};
    Object.assign(m, {Sidepannel_Sidepannel_Pos: 7, Sidepannel_Hide: () => {}, Main_values: {Main_Go: 1}, Main_ChannelContent: 9, Main_ExitCurrent: () => {}, Main_SwitchScreen: () => m.calls.push('switch'),
        AddUser_UsernameArray: [{id: 'kick:42', name: 'solo', display_name: 'Solo', platform: 'kick', access_token: '', kick: {id: 42, slug: 'solo', token: 'K'}}], KickApi_Id: s.KickApi_Id});
    vm.createContext(m);
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), m);
    extract('app/specific/Sidepannel.js', ['Sidepannel_KeyEnterUser'], m);
    m.Sidepannel_KeyEnterUser();
    check(m.Main_values.Main_selectedChannel_id === 'kick:solo' && m.Main_values.Main_selectedChannel === 'solo' && m.Main_values.My_channel === true, 'kick only: my channel is kick:<slug>, not the numeric user id');
    m.AddUser_UsernameArray[0] = {id: '160028137', name: 'lordboos', display_name: 'LordBoos', access_token: 'tw', kick: {id: 42, slug: 'solo', token: 'K'}};
    m.Sidepannel_KeyEnterUser();
    check(m.Main_values.Main_selectedChannel_id === '160028137' && m.Main_values.Main_selectedChannel === 'lordboos', 'twitch user with linked kick: my channel unchanged');
}

// Thumbnail: v2/channels only has a stream.kick.com thumbnail that answers 403, a refresh keeps the working list thumbnail
{
    const listRow = s.KickApi_LiveCell(Object.assign({}, chan.livestream, {thumbnail: {src: 'https://images.kick.com/video_thumbnails/a/b/720.webp?versionId=1'}}), {slug: chan.slug, username: 'x'});
    const t = {Play_data: {data: listRow.slice()}, KickApi_LiveCache: {}, KickApi_IsKickRow: s.KickApi_IsKickRow, KickApi_ChannelLiveCell: s.KickApi_ChannelLiveCell, Main_Slice: a => a.slice(),
        Play_UpdateMainStreamDiv: () => {}, Main_values: {}};
    vm.createContext(t);
    extract('app/specific/Play.js', ['Play_updateStreamInfoStart', 'Play_KickInfoApply', 'Play_KickKeepThumb'], t);
    t.KickApi_LiveCache[chan.slug] = s.KickApi_ChannelLiveCell(chan);
    t.Play_updateStreamInfoStart();
    check(t.Play_data.data[7] === 'kick:' + chan.livestream.id && t.Play_data.data[0] === 'https://images.kick.com/video_thumbnails/a/b/720.webp', 'start info: fresh row, list thumbnail kept (history shows it)');
    const slot = {data: listRow.slice()};
    check(t.Play_KickInfoApply(slot, chan) && slot.data[13] === chan.livestream.viewer_count && slot.data[0] === listRow[0], 'periodic refresh: fresh viewers, list thumbnail kept');
    const fromChannel = {data: s.KickApi_ChannelLiveCell(chan)};
    check(t.Play_KickInfoApply(fromChannel, chan) && fromChannel.data[0] === chan.livestream.thumbnail.url, 'row from the channel page keeps the only thumbnail kick gives');
}

// Task 9: followed Kick channels in Following Channels, plus the Ruling 13 carry-overs
{
    const s = sandbox(), req = [], shown = [];
    let expired = 0, token = 'K';
    vm.runInContext(fs.readFileSync('app/specific/Navigation.js', 'utf8'), s);
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), s);
    Object.assign(s, {FullxmlHttpGet: (...a) => req.push(a), AddUser_UsernameArray: [{id: 'u', name: 'u', access_token: 'tw'}], AddUser_SaveUserArray: () => {},
        Screens_assign: (...o) => Object.assign({}, ...o), Screens_ScreenIds: () => [], Base_Channel_obj: {}, Screens_addrowChannel: () => {}, Base_obj: {Set_Scroll() {}},
        ScreenObj: {}, Main_UserChannels: 7, userChannelQuery: '', Main_History: [], Main_values: {HistoryPos: 0}, Main_UserVod: 8, STR_USER: '', STR_USER_CHANNEL: '', KickUser_Expired: () => expired++, Navigation_Account: () => 'u',
        Screens_loadDataRequest: k => req.push(['twitch-next', k]), ScreensObj_TopLableUserInit: () => {}, ScreensObj_SetTopLable: () => {}});
    s.KickUser_Token = () => token;
    extract('app/specific/ScreensObj.js', ['ScreensObj_InitUserChannels'], s);
    s.ScreensObj_InitUserChannels();
    const scr = s.ScreenObj[7];
    scr.loadDataSuccess = function () { shown.push(this.data.slice()); };
    scr.navigationRequest = {id: 4, account: 'u'};
    const edge = login => ({cursor: login, node: {login: login, id: login + '1'}});
    const page = (edges, more) => ({data: {currentUser: {follows: {edges: edges, pageInfo: {hasNextPage: more}}}}});
    const kc = slug => ({channel_slug: slug, user_username: slug.toUpperCase(), profile_picture: 'https://files.kick.com/images/user/1/profile_image/conversion/a-thumb.webp', is_live: false});
    const logins = () => shown[shown.length - 1].map(d => d.login).join();

    // Fixture shape: the real v2/channels/followed row builds a Kick channel cell
    const fx = ref('kick_followed.json'), fxNodes = s.KickFollow_ChannelNodes(fx.channels);
    check(fxNodes.length === fx.channels.length && fxNodes[0].node.login === 'samplechannel1' && fxNodes[0].node.id === 'kick:samplechannel1' && fxNodes[0].node.kickCell[19] === 'kick' &&
        fxNodes[0].node.kickCell[2].indexOf('https://files.kick.com/') === 0, 'followed fixture rows become channel nodes');
    check(s.KickFollow_ChannelNodes([null, 5, kc('a b'), kc('<img>'), kc('ok')]).map(n => n.node.login).join() === 'ok', 'unsafe slugs and junk rows skipped');

    // Twitch only user: nothing sent, the old sort and result
    token = '';
    check(!s.KickFollow_ChannelsStart(7) && req.length === 0, 'no token: ChannelsStart false, nothing sent');
    scr.concatenate(page([edge('charlie'), edge('alpha')], false));
    check(req.length === 0 && logins() === 'alpha,charlie' && !scr.loadingData, 'twitch only: same sorted list, no kick request (Review Focus 5)');
    scr.data = null;
    scr.concatenate(page([], false));
    check(req.length === 0 && shown[shown.length - 1].length === 0, 'twitch only, no follows: empty list as before');

    // Linked Kick: merged once after the last Twitch page, paged with the cursor
    token = 'K'; scr.data = null; shown.length = 0;
    scr.concatenate(page([edge('charlie')], true));
    check(req.length === 1 && req[0][0] === 'twitch-next' && !scr.kickChannels, 'more twitch pages: no kick request yet');
    scr.concatenate(page([edge('alpha')], false));
    check(shown.length === 0 && req.length === 2 && req[1][0] === 'https://kick.com/api/v2/channels/followed' && req[1][1].some(h => h[1] === 'Bearer K'), 'after the last twitch page the first kick page is asked with the token');
    check(req[1][2].name === 'KickFollow_ChannelsResult' && req[1][4] === 7 && req[1][5] === 4 && req[1][6] === null && req[1][7] === null, 'named callback, ticket id, GET');
    check(req[1][8] === 8000, 'Ruling 13a: the kick request gating the twitch list has the short 8000 ms timeout');
    s.KickFollow_ChannelsResult({status: 200, responseText: JSON.stringify({nextCursor: 5, channels: [kc('bravo')]})}, 7, 4);
    check(req.length === 3 && /\/v2\/channels\/followed\?cursor=5$/.test(req[2][0]) && req[2][8] === 8000 && shown.length === 0, 'second page asked with ?cursor=5 and the short timeout');
    s.KickFollow_ChannelsResult({status: 200, responseText: JSON.stringify({channels: [kc('delta')]})}, 7, 4); // the last real page has no nextCursor at all
    check(logins() === 'alpha,bravo,charlie,delta' && shown.length === 1 && !scr.loadingData && scr.kickChannels === null, 'sorted among the twitch channels, shown once');
    check(shown[0][1].kickCell[19] === 'kick' && shown[0][1].id === 'kick:bravo' && !shown[0][0].kickCell, 'bravo is a kick cell, twitch nodes untouched');

    // Ruling 14: a string numeric cursor continues paging
    scr.data = [edge('alpha')]; req.length = 0; shown.length = 0;
    s.KickFollow_ChannelsStart(7);
    req.length = 0;
    s.KickFollow_ChannelsResult({status: 200, responseText: JSON.stringify({nextCursor: '5', channels: [kc('bravo')]})}, 7, 4);
    check(req.length === 1 && /\/v2\/channels\/followed\?cursor=5$/.test(req[0][0]), 'Ruling 14: string cursor "5" continues to the second page');

    // Stale ticket, other account, 401, failures
    scr.data = [edge('alpha')]; scr.navigationRequest = {id: 5, account: 'u'}; shown.length = 0; req.length = 0;
    s.KickFollow_ChannelsStart(7);
    s.KickFollow_ChannelsResult({status: 200, responseText: JSON.stringify({nextCursor: null, channels: [kc('bravo')]})}, 7, 4);
    check(shown.length === 0 && req.length === 1, 'stale ticket: nothing');
    s.Navigation_Account = () => 'other';
    s.KickFollow_ChannelsResult({status: 200, responseText: JSON.stringify({nextCursor: null, channels: [kc('bravo')]})}, 7, 5);
    check(shown.length === 0 && req.length === 1, 'account switched: nothing');
    s.Navigation_Account = () => 'u';
    s.KickFollow_ChannelsResult({status: 401, responseText: ''}, 7, 5);
    check(logins() === 'alpha' && expired === 1, '401: twitch nodes alone, session expired');
    scr.data = [edge('alpha')]; s.KickFollow_ChannelsStart(7);
    s.KickFollow_ChannelsResult({status: 200, responseText: JSON.stringify({nextCursor: 1, channels: [kc('bravo')]})}, 7, 5);
    s.KickFollow_ChannelsResult({status: 0, responseText: ''}, 7, 5);
    check(logins() === 'alpha' && expired === 1, 'error on a later page: twitch nodes unchanged, nothing half merged, silent');
    scr.data = [edge('alpha')]; s.KickFollow_ChannelsStart(7);
    s.KickFollow_ChannelsResult({status: 200, responseText: '<html>'}, 7, 5);
    check(logins() === 'alpha', 'non json answer: twitch nodes alone');
    // Page cap
    scr.data = [edge('alpha')]; req.length = 0; s.KickFollow_ChannelsStart(7);
    for (let i = 0; i < 25; i++) s.KickFollow_ChannelsResult({status: 200, responseText: JSON.stringify({nextCursor: i + 1, channels: [kc('c' + i)]})}, 7, 5);
    check(req.length === 20 && shown[shown.length - 1].length === 21, 'safety cap of 20 pages, then the list is shown');

    // Kick only user: empty twitch page, Kick channels alone
    scr.data = null; scr.navigationRequest = {id: 6, account: 'u'}; shown.length = 0; req.length = 0;
    check(JSON.parse(scr.kickOnlyResponse).data.currentUser.follows.pageInfo.hasNextPage === false, 'kickOnlyResponse is an empty last page');
    scr.concatenate(JSON.parse(scr.kickOnlyResponse));
    check(req.length === 1 && shown.length === 0, 'empty twitch list still asks kick');
    s.KickFollow_ChannelsResult({status: 200, responseText: JSON.stringify({nextCursor: null, channels: [kc('solo')]})}, 7, 6);
    check(logins() === 'solo', 'kick only: only kick channels');

    // Feed path of Task 8 also has the short timeout
    s.Navigation_FeedTicket = (...a) => a; s.UserLiveFeedobj_UserLivePos = 1; s.UserLiveFeed_loadDataSuccessEnd = () => {}; req.length = 0;
    s.KickFollow_FeedStart([]);
    check(req[0][8] === 8000, 'Ruling 13a: feed Kick request has the short timeout');
}

// Ruling 13a: FullxmlHttpGet passes the optional timeout, default unchanged
{
    const args = [], mm = {Main_IsOn_OSInterface: true, OSInterface_BaseXmlHttpGet: (...a) => args.push(a), Main_KickHelixBlocked: () => false, DefaultHttpGetTimeout: 20000};
    vm.createContext(mm);
    extract('app/specific/Main.js', ['FullxmlHttpGet'], mm);
    function a() {} function b() {}
    mm.FullxmlHttpGet('https://kick.com/x', null, a, b, 0, 1, null, null);
    mm.FullxmlHttpGet('https://kick.com/x', null, a, b, 0, 1, null, null, 8000);
    check(args[0][1] === 20000 && args[1][1] === 8000, 'FullxmlHttpGet: default 20 s, explicit timeout honored');
}

// Ruling 13b: a restream does not inherit the previous stream's thumbnail
{
    const t = {};
    vm.createContext(t);
    extract('app/specific/Play.js', ['Play_KickKeepThumb'], t);
    const old = []; old[0] = 'old.webp'; old[7] = 'kick:1';
    const same = []; same[0] = 'new.webp'; same[7] = 'kick:1';
    const other = []; other[0] = 'new2.webp'; other[7] = 'kick:2';
    check(t.Play_KickKeepThumb(same, old)[0] === 'old.webp' && t.Play_KickKeepThumb(other, old)[0] === 'new2.webp', 'thumbnail kept only for the same livestream');
}

// Ruling 13c: the Users card icon depends on that card's own user only
{
    const s = sandbox();
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), s);
    s.AddUser_UsernameArray = [{id: 'main', access_token: 'x', kick: {token: 'K'}}];
    s.KickUser_Token = () => 'K';
    const tw = {id: 'tw', access_token: 'x'}, linked = {id: 'l', access_token: 'x', kick: {token: 'Q'}}, solo = {id: 'kick:1', platform: 'kick', kick: {token: 'Q'}};
    check(s.KickApi_UserIcon(tw) === '', 'plain twitch user card: no icon even if the main user has Kick');
    check(s.KickApi_UserIcon(linked).indexOf('chat_pi_tw card_pi') !== -1 && s.KickApi_UserIcon(solo).indexOf('chat_pi_kick card_pi') !== -1, 'linked user: twitch icon, kick only user: kick icon');
    s.KickUser_Token = () => '';
    check(s.KickApi_UserIcon(linked).indexOf('chat_pi_tw') !== -1 && s.KickApi_UserIcon(tw) === '', 'main user token state does not matter');
    check(fs.readFileSync('app/specific/Users.js', 'utf8').indexOf('KickApi_UserIcon(AddUser_UsernameArray[pos])') !== -1, 'Users card uses it');
}

// Task 10: browsing Kick, platform switch, Live, Games and the streams of a category
{
    const s = sandbox(), req = [], store = {}, started = [];
    const catJson = ref('kick_categories.json');

    // Builders
    const bp = s.KickBrowse_Items(ref('kick_browse_livestreams.json'));
    check(bp.data.length === 5 && bp.data.every(d => d.kickCell[19] === 'kick' && d.id === d.kickCell[7] && typeof d.viewer_count === 'number'), 'browse fixture: every row is a kick item');
    check(bp.pagination.cursor === 'Y3Vyc29yLTU', 'cursor from pagination.next_cursor');
    check(s.KickBrowse_Items({}).data.length === 0 && s.KickBrowse_Items({}).pagination.cursor === '' && s.KickBrowse_Items(null).pagination.cursor === '', 'junk gives an empty page without a cursor');
    check(s.KickBrowse_Items({data: {livestreams: [], pagination: {next_cursor: 'a b"'}}}).pagination.cursor === '', 'unsafe cursor dropped');
    check(s.KickBrowse_Items({data: {livestreams: [null, 5, {id: 'x', channel: {slug: 'a b'}}], pagination: {}}}).data.length === 0, 'junk and unsafe rows skipped');
    check(s.KickBrowse_Items(ref('kick_category_livestreams.json')).data.length === 5, 'category fixture has the same shape');

    const cat = catJson.data[0];
    Object.assign(s, {STR_FOR: 'for', STR_SPACE_HTML: '_', Main_GetViewerStrings: v => (v === 1 ? 'viewer' : 'viewers')});
    const gc = s.KickApi_GameCell(cat);
    check(gc.length === 4 && gc[3] === 'kick:' + cat.slug && gc[1] === 'IRL' && gc[0] === cat.banner.url.split('?')[0] && gc[2].indexOf('F' + cat.viewers) !== -1, 'game cell: image, name, viewers text, kick:slug');
    const evil = s.KickApi_GameCell({id: 7, slug: 'x', name: '"><img src=x onerror=1>', viewers: 1, banner: {src: 'https://evil.example/a.png'}});
    check(evil[1].indexOf('<img') === -1 && evil[0] === '', 'category name escaped, foreign image dropped');
    check(s.KickApi_GameCell({id: 7, slug: 'a b', name: 'x'}) === null && s.KickApi_GameCell(null) === null && s.KickApi_GameCell({id: 'x', slug: 'ok', name: 'x'}) === null, 'unsafe slug or id gives null');
    check(s.KickBrowse_CatId('irl') === cat.id && s.KickBrowse_CatId('unknown') === 0, 'slug to numeric id (livestreams filters by id)');
    const gp = s.KickBrowse_Games(catJson);
    check(gp.data.length === 5 && gp.data[0].kickCell[3] === 'kick:irl' && gp.pagination.cursor === '2', 'games page: cells and the next page number');
    check(s.KickBrowse_Games({current_page: 3, last_page: 3, data: catJson.data}).pagination.cursor === '' && s.KickBrowse_Games(null).data.length === 0, 'last page has no cursor, junk is empty');

    // URLs
    check(s.KickBrowse_LiveUrl(24, '', '', 0) === 'https://mobile.kick.com/api/v1/livestreams?limit=24&sort=viewer_count_desc', 'live url');
    check(s.KickBrowse_LiveUrl(24, 'cs', 'Y3Vyc29yLTU', 8549) === 'https://mobile.kick.com/api/v1/livestreams?limit=24&sort=viewer_count_desc&category_id=8549&language=cs&after=Y3Vyc29yLTU', 'category, language and cursor');
    check(s.KickBrowse_LiveUrl(24, 'zh-hk', 'a b', 'x') === 'https://mobile.kick.com/api/v1/livestreams?limit=24&sort=viewer_count_desc', 'unknown language, unsafe cursor and id are left out');
    check(s.KickBrowse_GamesUrl('') === 'https://kick.com/api/v1/subcategories?limit=24&page=1' && s.KickBrowse_GamesUrl('3') === 'https://kick.com/api/v1/subcategories?limit=24&page=3' && s.KickBrowse_GamesUrl('x') === 'https://kick.com/api/v1/subcategories?limit=24&page=1', 'games url');

    // Switch
    Object.assign(s, {Main_getItemBool: (k, d) => (k in store ? store[k] : d), Main_setItem: (k, v) => { store[k] = v; }, STR_PLATFORM: 'Platform', STR_TWITCH: 'Twitch', STR_KICK: 'Kick',
        Main_Live: 1, Main_games: 4, Main_SearchLive: 12, Main_SearchGames: 11, Main_SearchChannels: 10, Main_SearchVod: 26, Screens_StartLoad: k => started.push(k)});
    s.ScreenObj = {1: {status: true}, 4: {status: true}, 12: {status: true}, 11: {status: true}, 10: {status: true}, 26: {status: true}, 3: {status: true}};
    check(s.KickBrowse_On() === false && s.KickBrowse_SwitchLabel() === 'Platform: Twitch', 'default is Twitch');
    s.KickBrowse_Toggle(1);
    check(store.kick_browse === true && s.KickBrowse_SwitchLabel() === 'Platform: Kick' && started.join() === '1', 'toggle saves and reloads the screen');
    check([1, 4, 12, 11, 10, 26].every(k => s.ScreenObj[k].status === false) && s.ScreenObj[3].status === true, 'Live, Games and all four search results (channels, live, games, videos) are marked stale, others untouched');
    s.KickBrowse_Toggle(4);
    check(store.kick_browse === false && started.join() === '1,4', 'toggle back');

    // Screens: Twitch mode set_url results are golden values taken once from the code before this task
    const mkScreens = text => {
        const t = sandbox(), shown = [];
        Object.assign(t, {Main_getItemBool: (k, d) => (k in store ? store[k] : d), Main_setItem: (k, v) => { store[k] = v; }, Main_Live: 1, Main_games: 4, Main_aGame: 5, Main_AGameVod: 7, Main_AGameClip: 8,
            Main_SearchLive: 12, Main_SearchGames: 11, STR_LIVE: '', STR_GAMES: '', Main_ItemsLimitMax: 100, Main_ItemsLimitVideo: 12, Main_helix_api: 'https://api.twitch.tv/helix/', Main_Bearer_Headers: [],
            Main_base_array_header: [], Main_ContentLang: '', Languages_Selected: 'en', AddUser_UserHasToken: () => true, Screens_assign: (...o) => Object.assign({}, ...o), Screens_ScreenIds: () => [],
            Base_obj: {Set_Scroll() {}, url: 'https://gql.twitch.tv/gql'}, Base_Live_obj: {}, Base_Game_obj: {}, liveQuery: 'LQ%l%c', gamesQuery: 'GQ%y', Sidepannel_SetDefaultLabels() {}, Sidepannel_SetTopOpacity() {},
            ScreensObj_SetTopLable() {}, ScreensObj_addSwitches: (a, k) => shown.push(a.join('|')), ScreensObj_TopLableAgameInit() {}, ScreensObj_TopLableAgameExit() {}, ScreensObj_UpdateGameInfo() {},
            Main_cleanTopLabel() {}, STR_VIDEOS: 'V', STR_CLIPS: 'C', STR_FOLLOW: 'F', STR_SPACE_HTML: '_', STR_PLATFORM: 'Platform', STR_TWITCH: 'Twitch', STR_KICK: 'Kick', STR_FOR: 'for', Main_GetViewerStrings: v => 'viewers', Main_Vod: 6, Main_Featured: 3, Main_Clip: 9,
            Main_values: {Search_isSearching: false, Main_gameSelected: 'IRL'}, ScreenObj: {1: {}, 4: {}, 5: {}, 7: {}, 8: {}, 11: {}, 12: {}}, Screens_StartLoad() {}});
        t.ScreenObj = {};
        UglifyJS.parse(text).walk(new UglifyJS.TreeWalker(n => { if (n instanceof UglifyJS.AST_Defun && ['ScreensObj_InitLive', 'ScreensObj_InitAGame', 'ScreensObj_InitGame'].indexOf(n.name.name) !== -1) vm.runInContext(n.print_to_string(), t); }));
        t.ScreensObj_InitLive();
        t.ScreensObj_InitAGame();
        t.ScreensObj_InitGame();
        return {t, shown};
    };
    const newS = mkScreens(fs.readFileSync('app/specific/ScreensObj.js', 'utf8'));

    const snap = (x, key, prep) => { const o = x.t.ScreenObj[key]; Object.assign(o, prep); o.set_url(); return {url: o.url, post: o.post, isQuery: o.isQuery, useHelix: o.useHelix, object: o.object, skip: o.skipSetMax, lim: o.ItemsLimitMax, lim2: o.ItemsLimit}; };
    store.kick_browse = false;
    const Q = (post) => ({url: 'https://gql.twitch.tv/gql', post: post, isQuery: true, useHelix: false, object: 'edges', skip: true, lim: 30, lim2: 15});
    const H = url => ({url: url, isQuery: false, useHelix: true, object: 'data', skip: false, lim: 100, lim2: 12});
    const liveGold = [
        // [cursor, data, token, lang] -> golden
        [[null, null, true, ''], H('https://api.twitch.tv/helix/streams?first=100')],
        [[null, null, true, 'cs'], H('https://api.twitch.tv/helix/streams?first=100&language=cs')],
        [[null, null, false, ''], Q('LQ')],
        [[null, null, false, 'cs'], Q('LQ,languages:en')],
        [['c1', null, true, ''], H('https://api.twitch.tv/helix/streams?first=100&after=c1')],
        [['c1', null, true, 'cs'], H('https://api.twitch.tv/helix/streams?first=100&after=c1&language=cs')],
        [['c1', null, false, ''], Q('LQ, after: \\"c1\\"')],
        [['c1', null, false, 'cs'], Q('LQ,languages:en, after: \\"c1\\"')],
        [['c2', [1], true, ''], Q('LQ, after: \\"c2\\"')], // data present: the last mode is kept (query), as before
        [['c2', [1], false, 'cs'], Q('LQ,languages:en, after: \\"c2\\"')]
    ];
    liveGold.forEach((g, i) => {
        const o = newS.t.ScreenObj[1];
        Object.assign(o, {url: 'https://gql.twitch.tv/gql', cursor: g[0][0], data: g[0][1]});
        newS.t.AddUser_UserHasToken = () => g[0][2];
        newS.t.Main_ContentLang = g[0][3];
        if (g[0][1]) { o.isQuery = true; o.useHelix = false; }
        o.set_url();
        const got = {url: o.url, post: o.post, isQuery: o.isQuery, useHelix: o.useHelix, object: o.object, skip: o.skipSetMax, lim: o.ItemsLimitMax, lim2: o.ItemsLimit};
        if (!g[1].isQuery) delete got.post;
        check(JSON.stringify(got) === JSON.stringify(g[1]), 'Live Twitch set_url golden ' + i + ' ' + JSON.stringify(got));
    });
    check(!!newS.t.ScreenObj[1].isKick === false, 'Twitch mode Live is not a kick screen');
    // Games in Twitch mode: url (the GQL endpoint) and post as before
    [[null, 'GQ'], ['g1', 'GQ, after: \\"g1\\"']].forEach((g, i) => {
        const o = newS.t.ScreenObj[4];
        Object.assign(o, {url: 'https://gql.twitch.tv/gql', cursor: g[0]});
        o.set_url();
        check(o.url === 'https://gql.twitch.tv/gql' && o.post === g[1] && o.isQuery === true && o.object === 'edges' && o.useHelix === undefined, 'Games Twitch set_url golden ' + i);
    });
    // AGame in Twitch mode: the only one of the three with switches, they stay
    newS.t.Main_ContentLang = 'cs';
    [[{gameSelected_Id: '509658', cursor: null}, 'https://api.twitch.tv/helix/streams?game_id=509658&first=100&language=cs'],
        [{gameSelected_Id: '509658', cursor: 'q', LoadAllLangForced: true}, 'https://api.twitch.tv/helix/streams?game_id=509658&first=100&after=q']].forEach((g, i) => {
        const o = newS.t.ScreenObj[5];
        Object.assign(o, g[0]);
        o.set_url();
        check(o.url === g[1] && o.HasSwitches === true && JSON.stringify(o.SwitchesIcons) === '["movie-play","movie","heart-o"]' && !o.isKick, 'AGame Twitch set_url golden ' + i);
    });

    // Live in Kick mode
    store.kick_browse = true;
    const live = newS.t.ScreenObj[1];
    newS.t.Main_ContentLang = '';
    live.data = null; live.cursor = null; live.set_url();
    check(live.isKick === true && live.useHelix === true && live.isQuery === false && live.object === 'data' && live.url === 'https://mobile.kick.com/api/v1/livestreams?limit=100&sort=viewer_count_desc', 'Live kick: kick screen, helix style data, public mobile url');
    newS.t.Main_ContentLang = 'cs'; live.cursor = 'Y3Vyc29yLTU'; live.set_url();
    check(/&language=cs&after=Y3Vyc29yLTU$/.test(live.url), 'Live kick: language and cursor');
    live.data = [1]; live.isQuery = true; live.set_url();
    check(live.isKick === true && live.isQuery === false, 'Live kick: later pages keep kick mode');
    check(live.HasSwitches === true && live.SwitchesIcons.length === 1, 'Live has the platform switch in the top row');
    live.addSwitches();
    check(newS.shown.length === 1 && newS.shown[0].indexOf('Platform: Kick') !== -1, 'Live switch label shows the platform');
    let added = null;
    live.concatenateAfter = r => { added = r; };
    live.concatenate(ref('kick_browse_livestreams.json'));
    check(added && added.data.length === 5 && added.pagination.cursor === 'Y3Vyc29yLTU' && live.isKick, 'Live kick concatenate converts the response');
    store.kick_browse = false; live.data = null; newS.t.AddUser_UserHasToken = () => true; live.set_url();
    check(live.isKick === false && live.useHelix === true && live.object === 'data' && live.url.indexOf('https://api.twitch.tv/helix/streams?first=100') === 0, 'switch off again: Twitch url and no kick flag');
    added = null; live.isQuery = false; live.concatenate({data: [{a: 1}], pagination: {}});
    check(added && added.data[0].a === 1, 'Twitch concatenate untouched');

    // Kick and back: the query screens post to the GQL url again, never to a Kick url
    {
        const g = newS.t.ScreenObj[4];
        store.kick_browse = true; g.cursor = null; g.set_url();
        check(g.isKick === true && g.url === 'https://kick.com/api/v1/subcategories?limit=24&page=1' && g.object === 'data' && g.useHelix === true && g.isQuery === false, 'Games kick: public categories url');
        g.cursor = '2'; g.set_url();
        check(/page=2$/.test(g.url), 'Games kick: next page');
        let got = null; g.concatenateAfter = r => { got = r; };
        g.concatenate(ref('kick_categories.json'));
        check(got && got.data.length === 5 && got.pagination.cursor === '2', 'Games kick concatenate converts the response');
        store.kick_browse = false; g.cursor = null; g.set_url();
        check(g.isKick === false && g.url === 'https://gql.twitch.tv/gql' && g.isQuery === true && g.object === 'edges' && !g.useHelix && g.post.indexOf('GQ') === 0, 'Games: back on Twitch the GQL url, query and edges again');
        store.kick_browse = true; live.data = null; newS.t.AddUser_UserHasToken = () => false; live.set_url();
        store.kick_browse = false; live.data = null; live.set_url();
        check(live.isQuery === true && live.url === 'https://gql.twitch.tv/gql' && live.object === 'edges' && live.isKick === false, 'Live without a user token: back on Twitch the GQL url and the query');
    }

    // AGame with a Kick category (the saved platform does not matter, the id does)
    const agk = newS.t.ScreenObj[5];
    newS.t.KickBrowse_CatIds.irl = 8549;
    newS.t.Main_ContentLang = 'cs';
    Object.assign(agk, {gameSelected_Id: 'kick:irl', cursor: null, LoadAllLangForced: false});
    agk.set_url();
    check(agk.isKick === true && agk.HasSwitches === false && agk.url === 'https://mobile.kick.com/api/v1/livestreams?limit=100&sort=viewer_count_desc&category_id=8549&language=cs', 'AGame kick:irl: category url, no switches');
    // Cache miss: the category is asked first, then the streams with the id
    Object.assign(agk, {gameSelected_Id: 'kick:Nope-Cat', cursor: null, kickResolve: ''});
    agk.set_url();
    check(agk.url === 'https://kick.com/api/v1/subcategories/Nope-Cat' && agk.kickResolve === 'Nope-Cat' && agk.isKick === true && agk.HasSwitches === false, 'cache miss: the subcategory url comes first');
    const reqs = [];
    newS.t.Screens_loadDataRequest = k => { reqs.push(k); agk.set_url(); reqs.push(agk.url); };
    newS.t.Screens_loadDataFail = k => reqs.push('fail' + k);
    agk.concatenate({id: 4242, slug: 'nope-cat', name: 'N'});
    check(reqs.length === 2 && reqs[0] === 5 && /category_id=4242&language=cs$/.test(reqs[1]) && agk.kickResolve === '', 'resolved id: the streams are asked through the normal path with category_id');
    check(newS.t.KickBrowse_CatId('nope-cat') === 4242 && newS.t.KickBrowse_CatId('NOPE-CAT') === 4242, 'id cached by the lowercase slug');
    reqs.length = 0; agk.kickResolve = 'zzz'; agk.concatenate({message: 'No query results'});
    check(reqs.length === 1 && reqs[0] === 'fail5', 'unusable lookup answer: silent fail');
    reqs.length = 0; agk.kickResolve = 'zzz'; agk.concatenate(null);
    check(reqs.join() === 'fail5', 'null answer: silent fail');
    // A stale ticket is dropped by Screens_HttpResultStatus before concatenate runs
    {
        const h = sandbox(), seen = [];
        Object.assign(h, {ScreenObj: {5: {navigationRequest: {id: 9, account: 'u', kick: true}, concatenate: () => seen.push('concat')}}, Navigation_Account: () => 'u', Screens_loadDataFail: () => seen.push('fail')});
        extract('app/specific/Screens.js', ['Screens_HttpResultStatus', 'Screens_concatenate'], h);
        h.Screens_HttpResultStatus({status: 200, responseText: '{"id":1}'}, 5, 8);
        check(seen.length === 0, 'stale ticket: the lookup answer is dropped');
        h.Main_ThumbOpenIsNull = () => true;
        h.Screens_HttpResultStatus({status: 200, responseText: '{"id":1}'}, 5, 9);
        check(seen.join() === 'concat', 'current ticket reaches concatenate');
    }

    // Blocking a Kick category sends nothing to Twitch, hold OK on the switch row opens no options
    {
        const b = sandbox(), sent = [];
        Object.assign(b, {BaseXmlHttpGet: (...a) => sent.push(a), AddUser_IsUserSet: () => true, AddUser_UsernameArray: [{id: 'u'}], Main_ChannelVod: 99, Main_AGameVod: 98, Main_AGameClip: 97,
            Main_values_History_data: {u: {blocked: {game: {}, deleted: {game: {}}}}}, Screens_values_Play_data: ['', 'IRL', '', 'kick:irl'], Main_helix_api: 'https://api.twitch.tv/helix/',
            Screens_BlockGameUpdateInfoEnd: function Screens_BlockGameUpdateInfoEnd() {}, noop_fun: () => {}, Screens_BlockGameGetId: () => 'kick:irl', Screens_BlockSetDefaultObj: () => {}, Main_Blocked: 55, Screens_BlockGameGetName: () => 'IRL', Screens_BlockCheckDeleteGame: () => {}, Main_HideLoadDialog: () => {}, Main_showWarningDialog: () => {},
            ScreenObj: {4: {screen: 4}}, Main_getItemJson: () => ({}), Main_setItem: () => {}, Screens_getGameIsBlocked: () => false, Main_setHistoryItem: () => {}});
        b.Main_values_History_data = {u: {blocked: {game: {}, deleted: {game: {}}}}};
        extract('app/specific/Screens.js', ['Screens_BlockGame', 'Screens_BlockGameUpdateInfo'], b);
        b.Screens_BlockGame(4);
        check(sent.length === 0, 'blocking a kick: category sends no Helix games request');
        b.Screens_BlockGameGetId = () => '509658';
        delete b.Main_values_History_data.u.blocked.game['509658']; b.Screens_BlockGame(4);
        check(sent.length === 1 && sent[0][0] === 'https://api.twitch.tv/helix/games?id=509658', 'blocking a Twitch game still asks Helix');
        const o = sandbox(), calls = [];
        Object.assign(o, {Main_Live: 1, Main_games: 4, Main_SearchLive: 12, Main_SearchGames: 11, Main_SearchChannels: 10, ScreenObj: {1: {posY: -1}, 4: {posY: -1}, 6: {posY: -1, histPosXName: 'x', DataObj: {'-1_0': {}}}}, Screens_LoadPreviewSTop: () => calls.push('preview')});
        extract('app/specific/Screens.js', ['Screens_ThumbOptionStart'], o);
        o.Screens_ThumbOptionStart(1); o.Screens_ThumbOptionStart(4);
        check(calls.length === 0, 'hold OK on the Live and Games switch row opens no options');
        try { o.Screens_ThumbOptionStart(6); } catch (e) { /* the other screens go on as before */ }
        check(calls.length === 1, 'other screens with a top row keep their option dialog');
    }
    Object.assign(agk, {gameSelected_Id: '509658'});
    agk.set_url();
    check(!agk.isKick && agk.HasSwitches === true && agk.url.indexOf('https://api.twitch.tv/helix/streams?game_id=509658') === 0, 'back to a Twitch game: switches and Twitch url');

    // No Twitch follow or game info request for a kick: game id
    const t2 = sandbox();
    Object.assign(t2, {FullxmlHttpGet: (...a) => req.push(a), BaseXmlHttpGet: (...a) => req.push(a), AddUser_UserHasToken: () => true, Main_values: {Main_gameSelected_id: 'kick:irl', Main_Go: 5}, Main_aGame: 5,
        Main_helix_api: 'h', STR_NOKEY_WARN: '', Main_showWarningDialog: () => {}, Main_innerHTML: () => {}, STR_FOLLOW: '', STR_FOLLOWING: '', STR_SPACE_HTML: '', STR_SPACE: '', STR_NOKEY: '',
        AddUser_UsernameArray: [{access_token: 'tw'}], Main_OAuth: '', PlayClip_BaseUrl: 'g', AGame_CheckFollowGameQuery: '%x', AGame_following: false, noop_fun: () => {}, clientIdHeader: 'c', AddCode_backup_client_id: 'i', Bearer_Header: 'b'});
    extract('app/specific/Screens.js', ['AGame_follow', 'AGame_CheckFollow', 'AGame_CheckFollowGame', 'AGame_CheckFollowGameReady', 'Screens_FollowUnfollowGame', 'AGame_setFollow'], t2);
    extract('app/specific/ScreensObj.js', ['ScreensObj_UpdateGameInfo', 'ScreensObj_UpdateGameInfoSuccess'], t2);
    t2.ScreenObj = {5: {ids: ['', '', ''], emptyContent: false}};
    req.length = 0;
    t2.AGame_CheckFollow(); t2.AGame_follow(5); t2.ScreensObj_UpdateGameInfo(1, 5);
    check(req.length === 0, 'kick: game id never reaches Twitch GQL follow or Helix games');
    t2.Main_values.Main_gameSelected_id = '509658';
    t2.AGame_CheckFollow(); t2.ScreensObj_UpdateGameInfo(1, 5);
    check(req.length === 2, 'Twitch game id still asks follow state and game info');
}

// Task 11: searching Kick, URLs, converters and the three result screens behind the platform switch
{
    const s = sandbox(), store = {};
    Object.assign(s, {STR_FOR: 'for', STR_SPACE_HTML: '_', Main_GetViewerStrings: v => 'viewers'});
    const se = ref('kick_search.json'), sc = ref('kick_search_categories.json');

    // Ruling 15: id 0 and empty or invalid slugs never loop the category lookup
    check(s.KickBrowse_CatResolve({id: 0}, 'irl') === false && s.KickBrowse_CatResolve({id: '0'}, 'irl') === false && s.KickBrowse_CatResolve({id: -3}, 'irl') === false, 'Ruling 15: id 0 or negative is not a category');
    check(s.KickBrowse_CatResolve({id: 77}, 'ok-cat') === true && s.KickBrowse_CatId('ok-cat') === 77, 'Ruling 15: a positive id is stored');
    check(s.KickBrowse_CatUrl('') === '' && s.KickBrowse_CatUrl('a b') === '' && s.KickBrowse_CatUrl(undefined) === '' && s.KickBrowse_CatUrl('x/../y') === '', 'Ruling 15: no subcategories url for an empty or invalid slug');
    check(s.KickBrowse_CatUrl('ok-cat') === 'https://kick.com/api/v1/subcategories/ok-cat', 'Ruling 15: a valid slug still gets its url');
    {
        const h = sandbox(), sent = [], fails = [];
        Object.assign(h, {ScreenObj: {5: {url: '', isKick: true, set_url() {}}}, FullxmlHttpGet: (...a) => sent.push(a), Screens_loadDataFail: k => fails.push(k), Navigation_Account: () => 'u', Navigation_RequestSerial: 0, Screens_HttpResultStatus: () => {}});
        extract('app/specific/Screens.js', ['Screens_loadDataRequest'], h);
        h.Screens_loadDataRequest(5);
        check(sent.length === 0 && fails.join() === '5', 'Ruling 15: an empty kick url sends nothing and fails silently');
        h.ScreenObj[5].url = 'https://kick.com/api/v1/subcategories/irl';
        h.Screens_loadDataRequest(5);
        check(sent.length === 1, 'a kick url is still requested');
    }

    // URLs
    check(s.KickSearch_Url('channels', 'xqc') === 'https://search.kick.com/api/v1/search/enriched?query=xqc&limit=20', 'channels url');
    check(s.KickSearch_Url('live', 'a b&c') === 'https://search.kick.com/api/v1/search/enriched?query=a%20b%26c&limit=20', 'live url encodes the term');
    check(s.KickSearch_Url('categories', 'gta') === 'https://search.kick.com/api/v1/categories/search?query=gta&limit=20', 'categories url');
    check(s.KickSearch_Url('categories', '"><img src=x>').indexOf('"') === -1 && s.KickSearch_Url('categories', '"><img src=x>').indexOf('<') === -1, 'url never carries raw markup');
    check(s.KickSearch_Url('channels', null) === 'https://search.kick.com/api/v1/search/enriched?query=&limit=20', 'null term is empty');

    // Channels
    const ch = s.KickSearch_Channels(se);
    check(ch.length === 5 && ch.every(i => i.kickCell[19] === 'kick' && i.id === i.kickCell[1]), 'channels: every row is a kick channel item');
    check(ch[0].kickCell[1] === 'kick:' + se.data.channels[0].slug.toLowerCase() && ch[0].kickCell[0] === se.data.channels[0].slug && ch[0].kickCell[3] === se.data.channels[0].username, 'channel row: slug, kick:slug id, name');
    check(ch[0].kickCell[5] === true && ch[1].kickCell[5] === null, 'a live channel carries the live mark, an offline one not');
    check(ch[0].kickCell[2] === se.data.channels[0].profile_picture.split('?')[0] && ch[1].kickCell[2] === '', 'avatar through the host whitelist, empty one stays empty');
    const evilCh = s.KickSearch_Channels({data: {channels: [{slug: 'ok', username: '"><img src=x onerror=1>', profile_picture: 'https://evil.example/a.png', is_live: false}, {slug: 'a b', username: 'x'}, null, 5]}});
    check(evilCh.length === 1 && evilCh[0].kickCell[3].indexOf('<img') === -1 && evilCh[0].kickCell[2] === '', 'channels: name escaped, foreign avatar dropped, unsafe slug and junk skipped');
    check(s.KickSearch_Channels({}).length === 0 && s.KickSearch_Channels(null).length === 0 && s.KickSearch_Channels({data: {channels: 'x'}}).length === 0, 'channels: junk is empty');

    // Live
    const lv = s.KickSearch_Live(se);
    check(lv.length === 2 && lv.every(i => i.kickCell[19] === 'kick' && i.id === i.kickCell[7] && typeof i.viewer_count === 'number'), 'live: the livestreams of the answer become kick live items');
    check(lv[1].kickCell[6] === 'xqc' && lv[1].kickCell[13] === se.data.livestreams[1].viewer_count && lv[1].user_id === 'kick:xqc', 'live row: slug, viewers, channel id');
    check(s.KickSearch_Live({data: {channels: se.data.channels}}).length === 0 && s.KickSearch_Live({}).length === 0 && s.KickSearch_Live(null).length === 0, 'live: an answer without livestreams is empty');
    check(s.KickSearch_Live({data: {livestreams: [null, {id: 'x"y', channel: {slug: 'a'}}, {id: 'ok', channel: {slug: 'a b'}}]}}).length === 0, 'live: unsafe ids and slugs skipped');

    // Categories
    const cg = s.KickSearch_Categories(sc);
    check(cg.length === 5 && cg.every(i => i.kickCell.length === 4 && i.id === i.kickCell[3]), 'categories: every row is a kick category item');
    check(cg[0].kickCell[3] === 'kick:grand-theft-auto-v' && cg[0].kickCell[1] === 'Grand Theft Auto V (GTA)' && cg[0].kickCell[0] === sc.data[0].thumbnail.src, 'category row: kick:slug, name, thumbnail.src');
    check(cg[0].kickCell[2].indexOf('F' + sc.data[0].viewer_count) !== -1, 'category row: viewer_count text');
    check(s.KickBrowse_CatId('grand-theft-auto-v') === sc.data[0].id, 'search categories fill the numeric id cache, so entering one is no cache miss');
    check(s.KickSearch_Categories({data: {categories: sc.data}}).length === 5, 'categories also from the enriched answer');
    check(s.KickSearch_Categories({}).length === 0 && s.KickSearch_Categories({data: [null, {id: 'x', slug: 'ok'}, {id: 3, slug: 'a b'}]}).length === 0, 'categories: junk and unsafe rows skipped');

    // Screens
    const mkS = text => {
        const t = sandbox(), shown = [];
        Object.assign(t, {Main_getItemBool: (k, d) => (k in store ? store[k] : d), Main_setItem: (k, v) => { store[k] = v; }, Main_SearchLive: 12, Main_SearchGames: 11, Main_SearchChannels: 10, Main_SearchVod: 13,
            Main_base_array_header: [], Screens_assign: (...o) => Object.assign({}, ...o), Screens_ScreenIds: () => [], Base_obj: {Set_Scroll() {}, url: 'https://gql.twitch.tv/gql'}, Base_Live_obj: {key_play() { this.viaBase = 'live'; }}, Base_Game_obj: {key_play() { this.viaBase = 'game'; }}, Base_Channel_obj: {}, Base_Vod_obj: {HasSwitches: true},
            searchLiveQuery: 'SL%x|%y', searchGamesQuery: 'SG%x|%y', searchCannelQuery: 'SC%x|%y', searchVodQuery: 'SV%x|%y', Sidepannel_SetTopOpacity() {}, ScreensObj_SetTopLable() {}, Main_cleanTopLabel() {},
            ScreensObj_addSwitches: (a, k) => shown.push(a.join('|')), STR_SPACE_HTML: '_', STR_PLATFORM: 'Platform', STR_TWITCH: 'Twitch', STR_KICK: 'Kick', STR_SEARCH_RESULT_EMPTY: 'EMPTY', STR_KICK_NOT_SUPPORTED: 'NOKICK', STR_FOR: 'for', Main_GetViewerStrings: v => 'viewers',
            STR_SEARCH: '', STR_LIVE: '', STR_GAMES: '', STR_CHANNELS: '', STR_VIDEOS: '', Main_values: {Search_data: 'xqc a&b', Search_isSearching: false}, Main_Live: 1, Main_games: 4, Screens_StartLoad() {},
            Screens_addrowChannel() {}, Screens_Cells: [], ScreenObj: {}});
        UglifyJS.parse(text).walk(new UglifyJS.TreeWalker(n => { if (n instanceof UglifyJS.AST_Defun && ['ScreensObj_InitSearchLive', 'ScreensObj_InitSearchGames', 'ScreensObj_InitSearchChannels', 'ScreensObj_InitSearchVod'].indexOf(n.name.name) !== -1) vm.runInContext(n.print_to_string(), t); }));
        t.ScreensObj_InitSearchLive(); t.ScreensObj_InitSearchGames(); t.ScreensObj_InitSearchChannels(); t.ScreensObj_InitSearchVod();
        return {t, shown};
    };
    const x = mkS(fs.readFileSync('app/specific/ScreensObj.js', 'utf8'));
    const names = {12: 'Live', 11: 'Games', 10: 'Channels'};
    const snap = o => ({url: o.url, post: o.post, isQuery: o.isQuery, useHelix: o.useHelix, object: o.object, isKick: !!o.isKick});

    // Twitch mode: golden values taken once from the code before this task
    store.kick_browse = false;
    const pre = {12: 'SL', 11: 'SG', 10: 'SC'};
    [12, 11, 10].forEach(k => {
        const o = x.t.ScreenObj[k];
        Object.assign(o, {cursor: null}); o.set_url();
        check(JSON.stringify(snap(o)) === JSON.stringify({url: 'https://gql.twitch.tv/gql', post: pre[k] + 'xqc a&b|', isQuery: true, object: 'items', isKick: false}), names[k] + ' Twitch set_url golden ' + JSON.stringify(snap(o)));
        o.cursor = 'c1'; o.set_url();
        check(o.post === pre[k] + 'xqc a&b|cursor: \\"c1\\"' && o.url === 'https://gql.twitch.tv/gql' && o.useHelix === undefined, names[k] + ' Twitch set_url golden with cursor');
    });
    let got = null;
    x.t.ScreenObj[12].concatenateAfter = r => { got = r; };
    x.t.ScreenObj[12].concatenate({data: {searchFor: {liveChannels: {items: [1, 2], cursor: 'q', pageInfo: {hasNextPage: true}}}}});
    check(got && got.items.length === 2 && x.t.ScreenObj[12].cursor === 'q' && x.t.ScreenObj[12].dataEnded === false, 'SearchLive Twitch concatenate untouched');
    x.t.ScreenObj[11].concatenateAfter = r => { got = r; };
    x.t.ScreenObj[11].concatenate({data: {searchFor: {games: {items: [1], cursor: 'g', pageInfo: {hasNextPage: false}}}}});
    check(got.items.length === 1 && x.t.ScreenObj[11].cursor === 'g' && x.t.ScreenObj[11].dataEnded === true, 'SearchGames Twitch concatenate untouched');
    x.t.ScreenObj[10].concatenateAfter = r => { got = r; };
    x.t.ScreenObj[10].concatenate({data: {searchFor: {users: {items: [{followers: {totalCount: 1}}, {followers: {totalCount: 9}}], cursor: 'u', pageInfo: {hasNextPage: true}}}}});
    check(got.items[0].followers.totalCount === 9 && x.t.ScreenObj[10].cursor === 'u', 'SearchChannels Twitch concatenate untouched (sorted by followers)');
    check(x.t.ScreenObj[13].emptyContent_STR() === 'EMPTY' && x.t.ScreenObj[13].HasSwitches === false, 'SearchVod Twitch: normal empty text, no switches');

    // Switch row and keys. Before this task none of the three had a top row (HasSwitches and SwitchesIcons undefined, no own key_play except
    // SearchChannels which only handled banners). The row is new and intended: pin the current values so a later Twitch-mode change is caught.
    [12, 11, 10].forEach(k => {
        const o = x.t.ScreenObj[k];
        check(o.HasSwitches === true && JSON.stringify(o.SwitchesIcons) === '["play"]' && typeof o.addSwitches === 'function' && typeof o.key_play === 'function', names[k] + ' Twitch mode: new switch row, icons and key_play pinned');
        o.viaBase = ''; o.posY = 0; o.is_a_Banner = () => false; o.base_key_play = (key, following) => { o.viaBase = 'channels' + key + following; };
        o.key_play();
        check(o.viaBase === ({12: 'live', 11: 'game', 10: 'channels10false'})[k], names[k] + ' Twitch mode: OK on a card behaves as before (base key_play)');
        store.kick_browse = false; o.viaBase = ''; o.posY = -1; o.key_play();
        check(o.viaBase === '' && store.kick_browse === true, names[k] + ' OK on the switch row toggles the platform and opens nothing');
        store.kick_browse = false;
    });

    // All three have the platform switch in the top row
    [12, 11, 10].forEach(k => {
        const o = x.t.ScreenObj[k];
        check(o.HasSwitches === true && o.SwitchesIcons.length === 1, names[k] + ' has the platform switch row');
    });
    x.shown.length = 0;
    x.t.ScreenObj[12].addSwitches();
    check(x.shown.length === 1 && x.shown[0].indexOf('Platform: Twitch') !== -1, 'switch label shows the platform');

    // Kick mode
    store.kick_browse = true;
    const urls = {12: 'https://search.kick.com/api/v1/search/enriched?query=xqc%20a%26b&limit=20', 10: 'https://search.kick.com/api/v1/search/enriched?query=xqc%20a%26b&limit=20', 11: 'https://search.kick.com/api/v1/categories/search?query=xqc%20a%26b&limit=20'};
    [12, 11, 10].forEach(k => {
        const o = x.t.ScreenObj[k];
        o.cursor = null; o.set_url();
        check(o.isKick === true && o.useHelix === true && o.isQuery === false && o.object === 'data' && o.url === urls[k], names[k] + ' kick: kick screen, helix style data, search url');
    });
    got = null;
    x.t.ScreenObj[10].concatenateAfter = r => { got = r; };
    x.t.ScreenObj[10].concatenate(se);
    check(got && got.data.length === 5 && got.pagination.cursor === '' && got.data[0].kickCell[19] === 'kick', 'SearchChannels kick concatenate converts the answer, one page only');
    x.t.ScreenObj[12].concatenateAfter = r => { got = r; };
    x.t.ScreenObj[12].concatenate(se);
    check(got.data.length === 2 && got.pagination.cursor === '', 'SearchLive kick concatenate takes the livestreams');
    x.t.ScreenObj[11].concatenateAfter = r => { got = r; };
    x.t.ScreenObj[11].concatenate(sc);
    check(got.data.length === 5 && got.pagination.cursor === '', 'SearchGames kick concatenate takes the categories');
    x.t.ScreenObj[12].concatenate({});
    check(got.data.length === 0, 'an answer without data is an empty page');
    x.t.ScreenObj[12].addSwitches();
    check(x.shown[x.shown.length - 1].indexOf('Platform: Kick') !== -1, 'switch label shows Kick');

    // SearchVod: Kick has no video search, the screen shows its own banner text and sends nothing
    check(x.t.ScreenObj[13].emptyContent_STR() === 'NOKICK' && x.t.ScreenObj[13].kickBrowseResponse.indexOf('"items":[]') !== -1, 'SearchVod kick: not supported text and an empty answer');

    // The empty video answer goes through Screens_HttpResultStatus: an old ticket id is dropped, the current one reaches concatenate
    {
        const h = sandbox(), seen = [];
        const v = x.t.ScreenObj[13];
        Object.assign(h, {KickBrowse_On: () => true, Navigation_Account: () => 'u', Navigation_RequestSerial: 4, AddUser_UserHasToken: () => true, KickUser_IsKickOnly: () => false,
            Main_ThumbOpenIsNull: () => true, Screens_loadDataFail: () => seen.push('fail'), Main_Bearer_User_Headers: [], Main_Bearer_Headers: [], FullxmlHttpGet: () => seen.push('sent'),
            ScreenObj: {13: {kickBrowseResponse: v.kickBrowseResponse, set_url() {}, concatenate: () => seen.push('concat'), navigationRequest: null}}});
        extract('app/specific/Screens.js', ['Screens_loadDataRequest', 'Screens_HttpResultStatus', 'Screens_concatenate'], h);
        // a newer request replaces the ticket before the answer is handled: the first answer must be dropped
        const first = h.ScreenObj[13];
        let answer = null;
        h.Screens_HttpResultStatus = ((orig) => (r, key, id) => { if (answer === null) answer = [r, key, id]; else orig(r, key, id); })(h.Screens_HttpResultStatus);
        h.Screens_loadDataRequest(13);
        check(answer && answer[2] === first.navigationRequest.id && seen.join() === '', 'video search kick: answered from memory with the ticket of the request');
        first.navigationRequest = {account: 'u', id: first.navigationRequest.id + 1};
        h.Screens_HttpResultStatus.call(null, answer[0], 13, answer[2]);
        check(seen.length === 0, 'video search kick: an answer with an old ticket id is dropped');
        h.Screens_HttpResultStatus(answer[0], 13, first.navigationRequest.id);
        check(seen.join() === 'concat', 'video search kick: the current ticket reaches concatenate');
    }

    // Back to Twitch: every property restored exactly
    store.kick_browse = false;
    [12, 11, 10].forEach(k => {
        const o = x.t.ScreenObj[k];
        o.cursor = null; o.set_url();
        check(JSON.stringify(snap(o)) === JSON.stringify({url: 'https://gql.twitch.tv/gql', post: pre[k] + 'xqc a&b|', isQuery: true, object: 'items', isKick: false}) && o.useHelix === undefined, names[k] + ' kick and back: Twitch properties restored exactly');
    });
    check(x.t.ScreenObj[13].emptyContent_STR() === 'EMPTY', 'SearchVod back on Twitch: normal text');

    // The switch also resets the channels search, hold OK on the switch rows opens no options
    {
        const y = sandbox(), started = [];
        Object.assign(y, {Main_getItemBool: (k, d) => (k in store ? store[k] : d), Main_setItem: (k, v) => { store[k] = v; }, Main_Live: 1, Main_games: 4, Main_SearchLive: 12, Main_SearchGames: 11, Main_SearchChannels: 10, Main_SearchVod: 26,
            Screens_StartLoad: k => started.push(k), STR_PLATFORM: 'P', STR_TWITCH: 'T', STR_KICK: 'K'});
        y.ScreenObj = {1: {status: true}, 4: {status: true}, 12: {status: true}, 11: {status: true}, 10: {status: true}, 26: {status: true}, 6: {status: true}};
        y.KickBrowse_Toggle(10);
        check([1, 4, 12, 11, 10, 26].every(k => y.ScreenObj[k].status === false) && y.ScreenObj[6].status === true && started.join() === '10', 'toggle marks the channels and videos search stale too (no cached Twitch videos under Kick, no cached Kick banner under Twitch)');
        const o = sandbox(), calls = [];
        Object.assign(o, {Main_Live: 1, Main_games: 4, Main_SearchLive: 12, Main_SearchGames: 11, Main_SearchChannels: 10, ScreenObj: {12: {posY: -1}, 11: {posY: -1}, 10: {posY: -1}}, Screens_LoadPreviewSTop: () => calls.push('preview')});
        extract('app/specific/Screens.js', ['Screens_ThumbOptionStart'], o);
        o.Screens_ThumbOptionStart(12); o.Screens_ThumbOptionStart(11); o.Screens_ThumbOptionStart(10);
        check(calls.length === 0, 'hold OK on the search switch rows opens no options');
    }
}

// Task 12: follow and unfollow of a Kick channel from the player, the channel page and the thumbnail options
{
    const s = sandbox(), req = [], labels = [], warns = [], expired = [];
    let token = 'KT', chanSet = 0, playSet = 0;
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), s);
    extract('app/specific/AddCode.js', ['AddCode_CheckFollow', 'AddCode_Follow', 'AddCode_UnFollow', 'AddCode_KickFollowDone', 'AddCode_RequestCheckFollowSucess', 'AddCode_RequestCheckFollowOK', 'AddCode_RequestCheckFollowError', 'AddCode_RequestCheckFollowEnd', 'AddCode_FollowSucess', 'AddCode_UnFollowSucess'], s);
    extract('app/specific/Play.js', ['Play_CheckFollow', 'Play_hideFollow'], s);
    extract('app/specific/PlayEtc.js', ['Play_FollowUnfollow'], s);
    vm.runInContext(fs.readFileSync('app/specific/ChannelContent.js', 'utf8'), s);
    Object.assign(s, {FullxmlHttpGet: (...a) => req.push(a), AddUser_UserIsSet: () => true, AddUser_UserHasToken: () => true, AddUser_UsernameArray: [{id: 'u', access_token: 'tw'}],
        Main_helix_api: 'https://api.twitch.tv/helix/', Main_Bearer_User_Headers: [], Main_Bearer_Headers: [], Main_OAuth: 'OAuth ', clientIdHeader: 'Client-ID', AddCode_backup_client_id: 'c', Bearer_Header: 'Authorization',
        AddCode_FollowQuery: 'FollowUser %x', AddCode_UnFollowQuery: 'UnfollowUser %x', Play_controlsFollow: 0, Play_controls: [{setLabel: l => labels.push(l)}], STR_NOKEY: 'nokey', STR_FOLLOW: 'follow', STR_FOLLOWING: 'following',
        Play_isOn: true, Play_data: {data: []}, Main_values: {Main_selectedChannel_id: 'kick:xqc', Main_selectedChannelDisplayname: 'x'}, STR_NOKEY_WARN: 'nokeywarn', AddUser_SaveUserArray: () => {},
        Main_showWarningDialog: m => warns.push(m), Play_showWarningMiddleDialog: m => warns.push(m), Play_IsWarning: false,
        Play_setFollow: () => playSet++, ChannelContent_setFollow: () => chanSet++, AddCode_IsFollowing: false, AddCode_PlayRequest: true, STR_KICK_SESSION_EXPIRED: 'exp', STR_KICK_FOLLOW_FAIL: 'Kick follow failed',
        Main_removeEventListener: () => {}, Main_HideElement: () => {}, ChannelContent_removeFocus: () => {}, Main_ready: () => {}, Screens_init: () => {}, ChannelContent_allowMature: true});
    s.KickUser_Token = () => token;
    s.KickUser_Expired = () => expired.push(1);
    const me = ref('kick_channel_me.json');
    const unf = Object.assign({}, me, {is_following: false});

    // Check: the state endpoint, Kick token only, no Twitch headers
    s.AddCode_Channel_id = 'kick:xqc';
    s.AddCode_CheckFollow();
    check(req.length === 1 && req[0][0] === 'https://kick.com/api/v2/channels/xqc/me' && req[0][2].name === 'KickFollow_CheckResult' && req[0][6] === null && req[0][7] === null, 'check: GET v2/channels/<slug>/me, named callback');
    check(req[0][1].some(h => h[0] === 'Authorization' && h[1] === 'Bearer KT') && !req[0][1].some(h => h[0] === 'Client-ID'), 'check: Kick bearer, no Client-ID');
    s.KickFollow_CheckResult({status: 200, responseText: JSON.stringify(me)}, 0, req[0][5]);
    check(s.AddCode_IsFollowing === true && playSet === 1 && chanSet === 0, 'followed channel: player shows Following');
    s.AddCode_CheckFollow();
    s.KickFollow_CheckResult({status: 200, responseText: JSON.stringify(unf)}, 0, req[1][5]);
    check(s.AddCode_IsFollowing === false && playSet === 2, 'unfollowed channel: Follow');
    s.AddCode_CheckFollow();
    s.KickFollow_CheckResult({status: 200, responseText: JSON.stringify(me)}, 0, req[2][5] - 1);
    check(playSet === 2 && s.AddCode_IsFollowing === false, 'stale check answer dropped');
    s.AddCode_PlayRequest = false;
    s.AddCode_CheckFollow();
    s.AddCode_Channel_id = 'kick:other';
    s.KickFollow_CheckResult({status: 200, responseText: JSON.stringify(me)}, 0, req[3][5]);
    check(chanSet === 0 && s.AddCode_IsFollowing === false, 'answer for another channel dropped');
    s.AddCode_Channel_id = 'kick:xqc';
    s.AddCode_CheckFollow();
    s.KickFollow_CheckResult({status: 200, responseText: JSON.stringify(me)}, 0, req[4][5]);
    check(chanSet === 1 && s.AddCode_IsFollowing === true, 'channel page: result reaches ChannelContent_setFollow');
    s.AddCode_CheckFollow();
    s.KickFollow_CheckResult({status: 401, responseText: ''}, 0, req[5][5]);
    check(expired.length === 1 && s.AddCode_IsFollowing === false, '401 on the check: KickUser_Expired, not following');
    s.AddCode_CheckFollow();
    s.KickFollow_CheckResult({status: 200, responseText: '<html>blocked</html>'}, 0, req[6][5]);
    s.AddCode_CheckFollow();
    s.KickFollow_CheckResult({status: 0, responseText: ''}, 0, req[7][5]);
    check(s.AddCode_IsFollowing === false && expired.length === 1, 'blocked or failed check: silent, not following');
    // Final review M5: a check answer that arrives after the main user changed is ignored, its 401 never expires the new user's Kick session
    const setsBefore = chanSet + playSet;
    s.AddCode_CheckFollow();
    token = 'NEW';
    s.KickFollow_CheckResult({status: 401, responseText: ''}, 0, req[8][5]);
    check(expired.length === 1 && chanSet + playSet === setsBefore && s.KickFollow_Pending === null, 'check answer for the previous main user: ignored, no expiry, no follow state');
    s.AddCode_CheckFollow();
    s.KickFollow_CheckResult({status: 401, responseText: ''}, 0, req[9][5]);
    check(expired.length === 2 && chanSet + playSet === setsBefore + 1, 'check of the new main user: its own 401 still expires');
    token = 'KT'; expired.pop(); // the follow checks below count from one expiry

    // Follow and unfollow: POST / DELETE with the Kick bearer
    req.length = 0; s.AddCode_PlayRequest = true; playSet = 0;
    s.AddCode_Follow();
    const f = req[0];
    check(f[0] === 'https://kick.com/api/v2/channels/xqc/follow' && f[6] === 'POST' && f[7] === '{}' && f[2].name === 'KickFollow_SetResult', 'follow: POST v2/channels/xqc/follow');
    check(f[1].some(h => h[0] === 'Authorization' && h[1] === 'Bearer KT') && !f[1].some(h => h[0] === 'Client-ID') && !JSON.stringify(f[1]).includes('OAuth') && !JSON.stringify(f[1]).includes('"tw'), 'follow: Kick bearer only, no Client-ID, no Twitch token');
    s.KickFollow_SetResult({status: 200, responseText: '{}'}, 1, f[5]);
    check(s.AddCode_IsFollowing === true && playSet === 1, 'follow 200: following, Play_setFollow called');
    s.AddCode_UnFollow();
    const d = req[1];
    check(d[0] === 'https://kick.com/api/v2/channels/xqc/follow' && d[6] === 'DELETE' && d[7] === null && d[1].some(h => h[1] === 'Bearer KT'), 'unfollow: DELETE v2/channels/xqc/follow');
    s.KickFollow_SetResult({status: 204, responseText: ''}, 0, d[5]);
    check(s.AddCode_IsFollowing === false && playSet === 2, 'unfollow 2xx: not following');
    s.AddCode_Follow();
    s.KickFollow_SetResult({status: 401, responseText: ''}, 1, req[2][5]);
    check(expired.length === 1 && s.AddCode_IsFollowing === false && playSet === 3, 'Ruling 17: follow 401 does not expire the Kick token (unconfirmed wire format), state unchanged');
    check(warns.slice(-1)[0] === 'Kick follow failed', 'follow failure shows the short warning (player)');
    warns.length = 0;
    s.AddCode_Follow();
    s.KickFollow_SetResult({status: 500, responseText: ''}, 1, req[3][5]);
    check(warns.join() === 'Kick follow failed', 'follow 500: warning');
    s.AddCode_Follow();
    s.KickFollow_SetResult({status: 200, responseText: ''}, 1, req[4][5] - 1);
    check(s.AddCode_IsFollowing === false && playSet === 4 && warns.length === 1, 'failed or stale change leaves the state, a stale answer is silent');
    s.AddCode_Follow();
    s.KickFollow_SetResult({status: 200, responseText: '{}'}, 1, req[5][5]);
    check(warns.length === 1, 'follow success: no warning');
    s.AddCode_UnFollow(); s.AddCode_IsFollowing = false;
    s.Play_isOn = false; s.AddCode_Follow();
    s.KickFollow_SetResult({status: 0, responseText: ''}, 1, req[7][5]);
    check(warns.length === 2 && warns[1] === 'Kick follow failed', 'follow network failure: warning outside the player too');
    s.Play_isOn = true; s.AddCode_IsFollowing = false;
    s.AddCode_Channel_id = 'kick:bad slug';
    req.length = 0;
    s.AddCode_Follow();
    check(req.length === 0, 'unsafe slug: nothing sent');
    s.AddCode_Channel_id = 'kick:xqc';

    // Callers: player control and channel page need the Kick token, never the Twitch one
    token = ''; req.length = 0; warns.length = 0; labels.length = 0;
    s.Play_CheckFollow('kick:xqc');
    check(labels.length === 1 && labels[0] === 'nokey' && req.length === 0, 'player, no Kick token: control hidden, nothing sent');
    s.Play_FollowUnfollow();
    check(warns.join() === 'nokeywarn' && req.length === 0, 'player, no Kick token: warning, nothing sent');
    s.Main_values.Main_selectedChannel_id = 'kick:xqc'; s.ChannelContent_cursorY = 0; s.ChannelContent_cursorX = 2;
    s.ChannelContent_keyEnter();
    check(warns.length === 2 && req.length === 0, 'channel page, no Kick token: warning, nothing sent');
    token = 'KT';
    s.Play_CheckFollow('kick:xqc');
    check(req.length === 1 && req[0][0] === 'https://kick.com/api/v2/channels/xqc/me' && s.AddCode_PlayRequest === true, 'player with the Kick token asks the Kick state');
    s.AddCode_IsFollowing = false;
    s.Play_FollowUnfollow();
    check(req[1][6] === 'POST' && req[1][0].endsWith('/follow'), 'player control follows');
    s.AddCode_IsFollowing = true;
    s.Play_FollowUnfollow();
    check(req[2][6] === 'DELETE', 'player control unfollows when following');
    s.ChannelContent_keyEnter();
    check(req[3][6] === 'DELETE' && s.AddCode_PlayRequest === false, 'channel page unfollows a followed channel with the Kick token');
    check(s.ChannelContent_canFollow('kick:xqc') && s.ChannelContent_canFollow('123'), 'canFollow: Kick token or Twitch user');
    token = '';
    check(!s.ChannelContent_canFollow('kick:xqc') && s.ChannelContent_canFollow('123'), 'canFollow: Kick channel without Kick token cannot follow');

    // Twitch ids keep the GQL path byte for byte, a Kick token does not matter
    token = 'KT'; req.length = 0;
    s.AddCode_Channel_id = '123'; s.AddCode_IsFollowing = false;
    s.AddCode_CheckFollow(); s.AddCode_Follow(); s.AddCode_UnFollow();
    check(req.length === 3 && req[0][0] === 'https://api.twitch.tv/helix/channels/followed?user_id=u&broadcaster_id=123' && req[0][6] === 'GET', 'twitch check unchanged');
    check(req[1][0] === 'https://gql.twitch.tv/gql' && req[1][6] === 'POST' && req[1][7] === 'FollowUser 123' && JSON.stringify(req[1][1]) === '[["Client-ID","c"],["Authorization","OAuth tw"]]', 'twitch follow unchanged');
    check(req[2][0] === 'https://gql.twitch.tv/gql' && req[2][6] === 'POST' && req[2][7] === 'UnfollowUser 123', 'twitch unfollow unchanged');
    s.Play_FollowUnfollow();
    check(req.length === 4 && req[3][7] === 'FollowUser 123', 'twitch player control unchanged');

    // Thumbnail options
    const t = sandbox(), treq = [], upd = [];
    let ttoken = 'KT';
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), t);
    extract('app/specific/Screens.js', ['Screens_ThumbOption_RequestCheckFollow', 'Screens_ThumbOption_RequestCheckFollowEnd', 'Screens_ThumbOption_CheckFollow', 'Screens_FollowUnfollow', 'Screens_FollowChannelId', 'Screens_FollowRequestEnd', 'Screens_FollowRequestReady', 'Screens_UnFollowRequestReady', 'Screens_ThumbOption_RequestCheckFollowSuccess', 'Screens_ThumbOption_RequestCheckFollowFail'], t);
    Object.assign(t, {FullxmlHttpGet: (...a) => treq.push(a), BaseXmlHttpGet: (...a) => treq.push(['base'].concat(a)), AddUser_UserHasToken: () => true, AddUser_UsernameArray: [{id: 'u', access_token: 'tw'}],
        Main_helix_api: 'https://api.twitch.tv/helix/', Main_OAuth: 'OAuth ', clientIdHeader: 'Client-ID', AddCode_backup_client_id: 'c', Bearer_Header: 'Authorization', PlayClip_BaseUrl: 'https://gql.twitch.tv/gql',
        AddCode_FollowQuery: 'FollowUser %x', AddCode_UnFollowQuery: 'UnfollowUser %x', Main_showWarningDialog: m => upd.push('warn:' + m), STR_NOKEY_WARN: 'nokeywarn', STR_KICK_SESSION_EXPIRED: 'exp', STR_KICK_FOLLOW_FAIL: 'Kick follow failed', Play_isOn: false, STR_NOKEY: 'nokey', STR_CANT_FOLLOW: '!', Screens_ThumbFollowCheckName: 'nm', Main_textContent: (i, v) => upd.push('txt:' + i + ':' + v),
        ScreenObj: {1: {screenType: 0}, 2: {screenType: 2}}, Screens_canFollow: false, Screens_isFollowing: false, Screens_ThumbOption_CheckFollow_ID: 0, Screens_ThumbOption_Follow_ID: 0,
        Screens_ThumbOption_UpdateFollow: (k, st) => { t.Screens_isFollowing = st; upd.push(k + ',' + st); }, AddUser_SaveUserArray: () => {}});
    t.KickUser_Token = () => ttoken;
    const row = o => Object.assign(new Array(20).fill(''), o);
    t.Screens_ThumbOption_CheckFollow(row({14: 'kick:xqc'}), 1);
    check(treq.length === 1 && treq[0][0] === 'https://kick.com/api/v2/channels/xqc/me' && t.Screens_canFollow === false, 'thumb check of a Kick card asks Kick, no Helix request');
    t.KickFollow_CheckResult({status: 200, responseText: JSON.stringify(me)}, 0, treq[0][5]);
    check(t.Screens_canFollow === true && upd.join('|') === '1,true', 'thumb check: Following state shown');
    t.Screens_values_Play_data = row({14: 'kick:xqc'});
    t.Screens_FollowUnfollow(1);
    check(treq[1][0] === 'https://kick.com/api/v2/channels/xqc/follow' && treq[1][6] === 'DELETE' && treq[1][1].some(h => h[1] === 'Bearer KT'), 'thumb option unfollows a followed Kick channel with DELETE');
    t.KickFollow_SetResult({status: 200, responseText: ''}, 0, treq[1][5]);
    check(upd[upd.length - 1] === '1,false' && t.Screens_isFollowing === false, 'thumb unfollow result updates the dialog');
    t.Screens_FollowUnfollow(1);
    check(treq[2][6] === 'POST' && treq[2][7] === '{}', 'thumb option follows an unfollowed Kick channel with POST');
    t.KickFollow_SetResult({status: 500, responseText: ''}, 1, treq[2][5]);
    check(upd[upd.length - 1] === 'warn:Kick follow failed' && upd[upd.length - 2] === '1,false' && upd.length === 3 && t.Screens_isFollowing === false, 'thumb failed follow leaves the dialog and warns');
    t.Screens_values_Play_data = row({2: 'kick:xqc'});
    t.Screens_FollowUnfollow(2);
    check(treq[3][0] === 'https://kick.com/api/v2/channels/xqc/follow' && treq[3][6] === 'POST', 'thumb option of a Kick vod row follows its channel');
    ttoken = ''; treq.length = 0; upd.length = 0;
    t.Screens_FollowUnfollow(2);
    check(treq.length === 0 && upd[0] === 'warn:nokeywarn', 'thumb option without Kick token: warning, nothing sent');
    t.Screens_ThumbOption_CheckFollow(row({14: 'kick:xqc'}), 1);
    check(treq.length === 0 && t.Screens_canFollow === false && upd.slice(-1)[0] === 'txt:nm:nokey!', 'Ruling 17: thumb check without Kick token: nothing sent, the sign in label instead of Not Following');
    ttoken = 'KT'; upd.length = 0; t.Screens_canFollow = true;
    t.Screens_ThumbOption_CheckFollow(row({14: 'kick:bad slug'}), 1);
    check(treq.length === 0 && t.Screens_canFollow === false && upd.slice(-1)[0] === 'txt:nm:nokey!', 'thumb check with an unsafe slug: the sign in label');
    t.Screens_FollowUnfollow(1);
    check(treq.length === 0, 'unsafe slug: no follow request');
    ttoken = '';
    ttoken = 'KT'; t.Screens_canFollow = true; t.Screens_isFollowing = false; treq.length = 0;
    t.Screens_values_Play_data = row({14: '123'});
    t.Screens_FollowUnfollow(1);
    check(treq.length === 1 && treq[0][0] === 'https://gql.twitch.tv/gql' && treq[0][6] === 'POST' && treq[0][7] === 'FollowUser 123', 'thumb option of a Twitch card unchanged');
    t.Screens_ThumbOption_CheckFollow(row({14: '123'}), 1);
    check(treq[1][0] === 'base' && treq[1][1] === 'https://api.twitch.tv/helix/channels/followed?user_id=u&broadcaster_id=123', 'thumb check of a Twitch card unchanged');
}

// Task 13: writing to a Kick chat
{
    const s = sandbox(), req = [], warns = [], irc = [], expired = [], shown = [];
    let token = 'KT', clears = 0, blocks = 0;
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), s);
    extract('app/specific/ChatKick.js', ['ChatKick_PositiveInt'], s);
    extract('app/specific/ChatLive.js', ['ChatLive_SendMessage'], s);
    extract('app/specific/ChatLiveControls.js', ['ChatLiveControls_CanSend'], s);
    Object.assign(s, {FullxmlHttpGet: (...a) => req.push(a), ChatLive_selectedChannel_id: [], ChatLive_selectedChannel: ['twitchlogin'], ChatKick_State: [], Play_ChatDelayPosition: 0,
        ChatLive_socketSendJoin: true, ChatLive_socketSend: {readyState: 1, send: m => irc.push(m)}, ChatLiveControls_showWarningDialog: m => warns.push(m),
        ChatLiveControls_Channel: 0, ChatLive_Banned: [], ChatLive_RoomState: [{'subs-only': true}], ChatLive_SubState: [{state: false}], ChatLive_FollowState: [],
        Play_data: {data: ['', 'xQc']}, PlayExtra_data: {data: ['', 'x']}, ChatLiveControls_PreventInput: () => blocks++, ChatLiveControls_PreventInputClear: () => clears++,
        STR_CHAT_BANNED: 'banned ', STR_IS_SUB_NOT_SUB: 'notsub', STR_CHAT_NOT_READY: 'notready', STR_KICK_CHAT_NEEDS_USER: 'needuser', STR_KICK_CHAT_SEND_FAIL: 'Message not sent to Kick chat',
        STR_KICK_FOLLOW_FAIL: 'Kick follow failed', STR_KICK_SESSION_EXPIRED: 'exp', AddUser_SaveUserArray: () => {}, Main_showWarningDialog: m => shown.push(m), Play_isOn: true,
        Play_showWarningMiddleDialog: m => shown.push(m), AddUser_UsernameArray: [{kick: {token: 'KT'}}]});
    s.KickUser_Token = () => token;
    s.KickUser_Expired = () => expired.push(1);

    // Kick chat: POST to the chatroom, Kick bearer only, the message is not added locally
    s.ChatLive_selectedChannel_id[0] = 'kick:xqc';
    s.ChatKick_State[0] = {chatroom: 32806, seq: 7};
    check(s.ChatLive_SendMessage('hi', 0) === true, 'kick chat send returns true');
    const sr = req[0];
    check(sr[0] === 'https://kick.com/api/v2/messages/send/32806' && sr[6] === 'POST' && sr[7] === '{"content":"hi","type":"message"}', 'kick send: POST v2/messages/send/<chatroom>, body {content, type: message}');
    check(sr[1].some(h => h[0] === 'Authorization' && h[1] === 'Bearer KT') && sr[1].some(h => h[0] === 'Content-Type' && h[1] === 'application/json') && sr[1].some(h => h[0] === 'User-Agent'), 'kick send: Kick bearer, json content type, desktop UA');
    check(sr[2].name === 'KickChat_SendResult' && sr[4] === 0 && sr[5] === 7 && irc.length === 0, 'kick send: named callback with chat number and chat seq, nothing to Twitch IRC');
    check(s.ChatLive_SendMessage('say "x" \\ y', 0) && req[1][7] === '{"content":"say \\"x\\" \\\\ y","type":"message"}', 'kick send: text is json escaped');
    check(!s.KickChat_Send(0, '') && req.length === 2, 'empty text: nothing sent');

    // Result: success silent, failure warns, 401 does not expire (Ruling 17), a closed or restarted chat is silent
    s.KickChat_SendResult({status: 200, responseText: '{}'}, 0, 7);
    check(warns.length === 0, 'send 200: no warning');
    s.KickChat_SendResult({status: 500, responseText: ''}, 0, 7);
    s.KickChat_SendResult({status: 0, responseText: ''}, 0, 7);
    check(warns.join('|') === 'Message not sent to Kick chat|Message not sent to Kick chat', 'send failure and network error: warning');
    warns.length = 0;
    s.KickChat_SendResult({status: 401, responseText: ''}, 0, 7);
    check(warns.length === 1 && expired.length === 0, 'Ruling 17: send 401 warns but does not call KickUser_Expired');
    s.KickChat_SendResult({status: 500, responseText: ''}, 0, 6);
    s.ChatKick_State[0] = null;
    s.KickChat_SendResult({status: 500, responseText: ''}, 0, 7);
    check(warns.length === 1, 'stale chat seq or closed chat: silent');
    s.ChatKick_State[0] = {chatroom: 32806, seq: 7};
    // Read endpoints keep expiring on 401 (the follow check)
    s.KickFollow_Check('xqc', () => {});
    s.KickFollow_CheckResult({status: 401, responseText: ''}, 0, req[req.length - 1][5]);
    check(expired.length === 1, 'read endpoint 401 still calls KickUser_Expired');
    // The unconfirmed mutating follow does not
    s.KickFollow_Set('xqc', true, () => {});
    s.KickFollow_SetResult({status: 401, responseText: ''}, 1, req[req.length - 1][5]);
    check(expired.length === 1 && shown.slice(-1)[0] === 'Kick follow failed', 'follow 401: warning, no expiry');

    // Not sendable: no chatroom, no token, unsafe chatroom
    req.length = 0;
    s.ChatKick_State[0] = {seq: 1};
    check(s.ChatLive_SendMessage('hi', 0) === false && req.length === 0 && irc.length === 0, 'kick chat without chatroom: false, nothing sent (not even to Twitch)');
    s.ChatKick_State[0] = null;
    check(s.ChatLive_SendMessage('hi', 0) === false && req.length === 0, 'kick chat without state: false');
    s.ChatKick_State[0] = {chatroom: 32806, seq: 7}; token = '';
    check(s.ChatLive_SendMessage('hi', 0) === false && req.length === 0 && irc.length === 0, 'kick chat without Kick token: false, nothing sent');
    token = 'KT'; s.ChatKick_State[0] = {chatroom: '1/../x', seq: 7};
    check(s.ChatLive_SendMessage('hi', 0) === false && req.length === 0, 'unsafe chatroom id: nothing sent');

    // A Kick chat with linked chats writes to the Kick main chat only
    s.ChatKick_State[0] = {chatroom: 32806, seq: 7};
    s.ChatLive_selectedChannel[0] = 'xqc';
    s.ChatLive_SendMessage('linked', 0);
    check(req.length === 1 && req[0][0].endsWith('/32806') && irc.length === 0, 'linked Twitch chat of a Kick main chat: never written to');

    // CanSend: the Twitch room state does not apply to Kick, the Kick token and chatroom decide
    clears = 0; blocks = 0;
    check(s.ChatLiveControls_CanSend() === true && clears === 1 && blocks === 0, 'CanSend: Kick chat with token and chatroom, Twitch subs-only state ignored');
    token = '';
    check(s.ChatLiveControls_CanSend() === false && s.ChatLiveControls_CanSendText === 'needuser' && blocks === 1, 'CanSend: Kick chat without token blocked with the sign in text');
    token = 'KT'; s.ChatKick_State[0] = {seq: 7};
    check(s.ChatLiveControls_CanSend() === false && s.ChatLiveControls_CanSendText === 'notready', 'CanSend: Kick chat without chatroom is not ready');

    // Twitch chat: IRC as before, Twitch room state still blocks
    req.length = 0; irc.length = 0;
    s.ChatLive_selectedChannel_id[0] = '123'; s.ChatLive_selectedChannel[0] = 'twitchlogin';
    check(s.ChatLive_SendMessage('hello', 0) === true && irc.join() === 'PRIVMSG #twitchlogin :hello' && req.length === 0, 'twitch chat: PRIVMSG over IRC, no Kick request');
    s.ChatLive_socketSend.readyState = 0;
    check(s.ChatLive_SendMessage('hello', 0) === false && irc.length === 1, 'twitch chat not ready: false as before');
    blocks = 0;
    check(s.ChatLiveControls_CanSend() === false && s.ChatLiveControls_CanSendText === 'Chat Subscribers-only mode notsub' && blocks === 1, 'twitch chat: room state unchanged (subs-only blocks)');
    s.ChatLive_RoomState[0] = null;
    check(s.ChatLiveControls_CanSend() === true, 'twitch chat: free room is sendable');

    // Control "Write in chat": the Kick token for a Kick stream, the Twitch authorization for Twitch
    const shownChat = [], c = sandbox();
    let node = null, chatShown = 0, ktok = '';
    UglifyJS.parse(fs.readFileSync('app/specific/PlayEtc.js', 'utf8')).walk(new UglifyJS.TreeWalker(n => {
        if (n instanceof UglifyJS.AST_SimpleStatement && n.body instanceof UglifyJS.AST_Assign && n.body.left.print_to_string() === 'Play_controls[Play_controlsChatSend]') node = n;
    }));
    check(node, 'found the Play_controlsChatSend descriptor');
    Object.assign(c, {Play_controls: [], Play_controlsChatSend: 0, STR_CHAT_WRITE: 'w', Main_values: {Play_ChatForceDisable: false}, STR_CHAT_DISABLE: 'dis', STR_NOKEY_CHAT_WARN: 'twkey', STR_KICK_CHAT_NEEDS_USER: 'needuser',
        Play_showWarningMiddleDialog: m => shownChat.push(m), AddUser_UserIsSet: () => true, AddUser_UsernameArray: [{access_token: ''}], PlayExtra_PicturePicture: false, Play_isFullScreen: true,
        ChatLiveControls_Show: () => chatShown++, ChatLiveControls_ShowChooseChat: () => {}, Play_data: {data: []}});
    vm.runInContext(node.print_to_string(), c);
    const enter = () => c.Play_controls[0].enterKey();
    c.KickApi_IsKickRow = d => d.kick === true;
    c.KickUser_Token = () => ktok;
    c.Play_data = {data: Object.assign([], {kick: true})};
    enter();
    check(shownChat.join() === 'needuser' && chatShown === 0, 'write control, Kick stream without Kick token: sign in warning');
    ktok = 'KT'; shownChat.length = 0;
    enter();
    check(shownChat.length === 0 && chatShown === 1, 'write control, Kick stream with Kick token (no Twitch authorization): chat opens');
    c.Play_data = {data: []};
    enter();
    check(shownChat.join() === 'twkey' && chatShown === 1, 'write control, Twitch stream without Twitch authorization: unchanged warning, a Kick token does not help');
    c.AddUser_UsernameArray[0].access_token = 'tw'; shownChat.length = 0;
    enter();
    check(shownChat.length === 0 && chatShown === 2, 'write control, Twitch stream with authorization: chat opens as before');
}

// Final review I1: starting a Kick chat sends no Kick id to Twitch (channel badges go through BaseXmlHttpGetFull)
{
    const sent = [], errs = [];
    const c = {
        Main_IsOn_OSInterface: true, DefaultHttpGetTimeout: 1, Main_helix_api: 'https://api.twitch.tv/helix/', noop_fun: () => {}, Main_Log: () => {}, Bearer: 'Bearer ',
        OSInterface_XmlHttpGetFull: (...a) => sent.push(a[0]), OSInterface_BaseXmlHttpGet: (...a) => sent.push(a[0]),
        AddUser_UserHasToken: () => true, AddUser_IsUserSet: () => true, AddUser_UsernameArray: [{name: 'me', access_token: 'tw'}],
        Main_Bearer_User_Headers: [['Client-ID', 'c'], ['Authorization', '']], Main_Bearer_Headers: [['Client-ID', 'c']],
        Settings_value: new Proxy({}, {get: () => ({defaultValue: 0})}), KickApi_IsKickId: s.KickApi_IsKickId,
        Chat_loadBadgesGlobal: () => {}, Chat_tagCSS: () => {}, Chat_div: [{}, {}], Chat_CssId: id => id, Chat_GlobalBadges: {0: '.a%x {}'}
    };
    vm.createContext(c);
    vm.runInContext(fs.readFileSync('app/specific/ChatLive.js', 'utf8'), c);
    extract('app/specific/ChatVod.js', ['Chat_loadBadgesGlobalRequest', 'Chat_loadBadgesGlobalRequestWithChannel'], c);
    extract('app/specific/Main.js', ['Main_KickHelixBlocked', 'BaseXmlHttpGet'], c);
    extract('app/specific/ScreensObj.js', ['BaseXmlHttpGetFull'], c);
    const kickToTwitch = () => sent.filter(u => /^https:\/\/api\.twitch\.tv\//.test(u) && /kick(:|%3A)/i.test(u));
    c.ChatLive_SetOptions(0, 'kick:kickname', 'kickname');
    check(kickToTwitch().length === 0, 'kick chat start: no request with a kick id to api.twitch.tv (' + kickToTwitch().join() + ')');
    c.ChatLive_SetOptions(0, '160028137', 'lordboos');
    check(sent.indexOf('https://api.twitch.tv/helix/chat/badges?broadcaster_id=160028137') !== -1, 'twitch chat start still loads its channel badges');
    // the guard sits in the shared transport: every caller of BaseXmlHttpGetFull is covered, the error path runs
    sent.length = 0;
    function bad(check1, checkResult, obj) { errs.push([check1, checkResult, obj.status]); }
    c.BaseXmlHttpGetFull('https://api.twitch.tv/helix/streams?user_id=kick:xqc', true, 7, 'c1', null, null, null, null, c.noop_fun, bad);
    check(sent.length === 0 && JSON.stringify(errs) === '[["c1",7,0]]', 'BaseXmlHttpGetFull: helix with a kick id never leaves the app, error path with status 0');
    c.BaseXmlHttpGetFull('https://api.twitch.tv/helix/streams?user_id=123', true, 7, 'c1', null, null, null, null, c.noop_fun, bad);
    check(sent.length === 1 && errs.length === 1, 'BaseXmlHttpGetFull: twitch id passes');
}

// Final review M1: a Kick only main user sends nothing to Twitch GQL from Following Videos and Following Categories
{
    const s2 = sandbox(), req = [], got = [];
    vm.runInContext(fs.readFileSync('app/specific/Navigation.js', 'utf8'), s2);
    vm.runInContext(fs.readFileSync('app/specific/KickUser.js', 'utf8'), s2);
    Object.assign(s2, {
        FullxmlHttpGet: (...a) => req.push(a), AddUser_UserHasToken: () => !!s2.AddUser_UsernameArray[0].access_token, KickBrowse_On: () => false,
        Main_Bearer_User_Headers: [], Main_Bearer_Headers: [], Main_OAuth_User_Headers: [['Client-ID', 'c'], ['Authorization', 'OAuth tw']], Play_base_backup_headers_Array: [], Main_TwitchV5Flag: '',
        Main_ThumbOpenIsNull: () => false, Screens_addFocus: () => {}, ScreenObj: {}, Main_UserVod: 8, Main_usergames: 2, Main_UserChannels: 7, Main_UserLive: 1,
        Main_getItemBool: () => false, Main_getItemInt: () => 1, userVodQuery: 'VOD %x %t %y', userGameQuery: 'GAMES user(id:\\"%x\\")',
        Screens_assign: (...o) => Object.assign({}, ...o), Screens_ScreenIds: () => [], Base_Vod_obj: {}, Base_Game_obj: {},
        Base_obj: {concatenateAfter(r) { got.push(r); }, loadDataSuccess() { got.push(this.data); }, Set_Scroll() {}}
    });
    extract('app/specific/Screens.js', ['Screens_loadDataRequest', 'Screens_HttpResultStatus', 'Screens_concatenate'], s2);
    extract('app/specific/ScreensObj.js', ['ScreensObj_InitUserVod', 'ScreensObj_InitUserGames'], s2);
    s2.ScreensObj_InitUserVod();
    s2.ScreensObj_InitUserGames();
    // Twitch user: the existing GQL requests
    s2.AddUser_UsernameArray = [{id: '160028137', name: 'lordboos', access_token: 'tw'}];
    s2.Screens_loadDataRequest(8);
    s2.Screens_loadDataRequest(2);
    check(req.length === 2 && req[0][6] === 'POST' && req[0][1] === s2.Main_OAuth_User_Headers && req[1][7].indexOf('user(id:\\"160028137\\")') !== -1, 'twitch user: following videos and categories ask gql as before');
    // Kick only user: no request at all, the empty Twitch page of each screen
    s2.AddUser_UsernameArray = [{id: 'kick:42', name: 'solo', platform: 'kick', access_token: '', kick: {token: 'K', slug: 'solo'}}];
    req.length = 0; got.length = 0;
    s2.Screens_loadDataRequest(8);
    check(req.length === 0 && got.length === 1 && got[0].edges && got[0].edges.length === 0 && s2.ScreenObj[8].dataEnded === true, 'kick only: following videos sends nothing, empty last page');
    s2.Screens_loadDataRequest(2);
    check(req.length === 0 && got.length === 2 && Array.isArray(got[1]) && got[1].length === 0, 'kick only: following categories sends no kick id to gql, empty list');
}

// Final review M2: a Kick VOD card never asks Twitch GQL for an animated preview
{
    const a = sandbox(), req = [];
    Object.assign(a, {FullxmlHttpGet: (...x) => req.push(x), Main_clearInterval: () => {}, Settings_Obj_default: () => 1, Play_PreviewId: 0, Main_getElementById: () => ({style: {}}),
        Play_base_backup_headers_Array: []});
    extract('app/specific/ScreensObj.js', ['ScreensObj_AnimateThumbId', 'ScreensObj_getVodAnimatedUrl', 'ScreensObj_getVodAnimatedUrlResult'], a);
    vm.runInContext('var ScreensObj_getVodAnimatedUrlPost = \'{"query":"{video(id:\\\\"%x\\\\"){animatedPreviewURL}}"}\';', a);
    const kickVod = a.KickApi_VodCell(v, {slug: 'xqc', name: 'xQc'});
    const screen = row => ({posY: 0, posX: 0, ids: ['', '', '', '', '', 'img'], DataObj: {'0_0': row}, screen: 3});
    a.ScreensObj_AnimateThumbId(screen(kickVod));
    check(req.length === 0, 'kick vod card with videos animation on: nothing sent to twitch gql');
    a.ScreensObj_AnimateThumbId(screen(['', '', '', '', '', '', 'a', '123456789', null]));
    check(req.length === 1 && req[0][0] === 'https://gql.twitch.tv/gql' && req[0][7].indexOf('123456789') !== -1, 'twitch vod card: animated preview asked as before');
}

// Task 14 (final review M3): v2/channels often has no thumbnail, a Kick live row without one is still saved to history
{
    const h = sandbox(), store = {live: [], vod: [], clip: [], deleted: {live: {}, vod: {}, clip: {}}};
    Object.assign(h, {AddUser_IsUserSet: () => true, AddUser_UsernameArray: [{id: 'u'}], Main_values_History_data: {u: store}, Screens_checkDeleteObj: () => {},
        Main_setHistoryItem: () => {}, ScreenObj: {21: {histPosX: [0, 0]}}, Main_HistoryLive: 21});
    extract('app/specific/Main.js', ['Main_Set_history', 'Main_history_GetById', 'Main_history_Clean_deleted', 'Main_Slice'], h);
    const kickRow = h.KickApi_ChannelLiveCell(Object.assign({}, chan, {livestream: Object.assign({}, chan.livestream, {thumbnail: null})}));
    check(kickRow[0] === '' && kickRow[19] === 'kick', 'v2/channels live row without a thumbnail');
    h.Main_Set_history('live', kickRow);
    check(store.live.length === 1 && store.live[0].id === kickRow[7], 'kick live row without a thumbnail is saved to history');
    const withThumb = kickRow.slice();
    withThumb[0] = 'https://images.kick.com/video_thumbnails/a/b/720.webp';
    store.live = [];
    h.Main_Set_history('live', withThumb);
    h.Main_Set_history('live', kickRow);
    check(store.live.length === 1 && store.live[0].data[0] === withThumb[0], 'a later save without a thumbnail keeps the saved one');
    h.Main_Set_history('live', ['', 'name', '', '', '', '', 'login', '123', '', '', '', '', '', 5, '9']);
    check(store.live.length === 1, 'twitch row without a thumbnail is still not saved');
}

console.log(checks + ' kick checks passed');
