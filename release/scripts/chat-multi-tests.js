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

console.log(checks + ' merged chat checks passed');
