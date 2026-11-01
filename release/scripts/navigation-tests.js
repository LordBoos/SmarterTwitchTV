/* Load the real named screen IDs and production routing policy. No app initialization or network. */
const assert = require('assert');
const s = require('./ui-test-sandbox')();
let checks = 0;
function check(value, message) {
    assert.ok(value, message);
    checks++;
}
for (const route of s.Navigation_Destinations()) {
    route.screens.forEach((screen, tab) => {
        const result = s.Navigation_Route(screen);
        check(result.destination === route.id && result.tab === tab, 'round trip ' + route.id + '/' + tab);
        check(s.Navigation_Target(route.id, tab) === screen, 'named screen target');
    });
}
check(s.Navigation_Target('following', 0) === s.Main_UserLive, 'Following starts with live');
check(s.Navigation_Target('following', 1) === s.Main_UserVod, 'Videos second');
check(s.Navigation_Target('following', 2) === s.Main_UserChannels, 'Channels third');
for (const tab of [-1, 99, 0.5, NaN]) check(s.Navigation_Target('following', tab) === null, 'invalid tab rejected');
check(s.Navigation_Route(s.Main_ChannelContent) === null, 'nested screen does not invent origin');
s.Navigation_SetAccount('alex');
s.Navigation_Enter(s.Main_SearchLive);
s.Navigation_Enter(s.Main_ChannelContent, {screen: s.Main_SearchLive, itemId: 'stream-a'});
s.Navigation_Enter(s.Main_aGame, {screen: s.Main_ChannelContent, itemId: 'channel-a'});
check(s.Navigation_State.destination === 'search', 'category from search retains logical destination');
check(s.Navigation_BackOrigin().screen === s.Main_ChannelContent, 'Back closes nested category first');
check(s.Navigation_BackOrigin().screen === s.Main_SearchLive, 'second Back restores search');
check(s.Navigation_BackOrigin() === null, 'origin stack ends');
s.Navigation_SaveBookmark(s.Main_UserLive, 'live', 'b', 3, 200);
check(s.Navigation_Bookmark(s.Main_UserLive, 'live').itemId === 'b', 'bookmark identity');
check(s.Navigation_Bookmark(s.Main_UserLive, 'different-query') === null, 'context-isolated bookmarks');
s.Navigation_SaveBookmark(s.Main_UserLive, 'live', 'c', 1, 20);
check(s.Navigation_State.bookmarks.length === 1, 'bookmark replacement');
let ticket = s.Navigation_Context('live');
check(s.Navigation_IsCurrent(ticket, 'live'), 'current result accepted');
check(!s.Navigation_IsCurrent(ticket, 'videos'), 'different query result rejected');
s.Navigation_Enter(s.Main_Live);
check(!s.Navigation_IsCurrent(ticket, 'live'), 'late route result rejected');
ticket = s.Navigation_Context('live');
s.Navigation_SetAccount('morgan');
check(!s.Navigation_IsCurrent(ticket, 'live'), 'old account callback rejected');
check(s.Navigation_State.bookmarks.length === 0 && s.Navigation_State.origins.length === 0, 'account switch clears scoped state');
for (let i = 0; i < 100; i++) s.Navigation_SaveBookmark(i, 'context', 'id-' + i, i, 0);
check(s.Navigation_State.bookmarks.length === 24, 'bounded bookmarks');
check(!s.Navigation_SetAccount('morgan'), 'same account preserves generation');
const calls = [];
const adapter = {
    valid: screen => screen === s.Main_UserLive,
    capture: () => calls.push('capture'),
    cancelPreview: () => calls.push('cancel'),
    exit: () => calls.push('exit'),
    init: screen => calls.push('init:' + screen)
};
s.UIFocus_Push({id: 'preview', handle: () => true, cleanup: () => calls.push('cleanup')});
check(!s.Navigation_Transition(-1, adapter), 'invalid transition rejected without mutation');
check(calls.length === 0, 'invalid target preserves current screen');
check(s.Navigation_Transition(s.Main_UserLive, adapter), 'valid transition');
check(calls.join(',') === 'capture,cancel,cleanup,exit,init:' + s.Main_UserLive, 'single lifecycle in exact ownership order');
for (const intent of [false, true])
    for (const startUser of [false, true])
        for (const restore of [false, true])
            for (const wasPlaying of [0, 1, 2])
                for (const hasAccount of [false, true]) {
                    const result = s.Navigation_Startup({
                        intent,
                        intentScreen: s.Main_aGame,
                        startUser,
                        restore,
                        wasPlaying,
                        hasAccount,
                        previousScreen: s.Main_Live
                    });
                    const expected = intent
                        ? 'intent'
                        : startUser
                          ? 'screen'
                          : restore && wasPlaying
                            ? 'restore'
                            : hasAccount
                              ? 'screen'
                              : 'onboarding';
                    check(result.action === expected, 'startup combination ' + [intent, startUser, restore, wasPlaying, hasAccount]);
                    if (!intent && !startUser && !(restore && wasPlaying) && hasAccount)
                        check(result.screen === s.Main_UserLive, 'ordinary configured startup');
                }
check(s.Navigation_Startup({explicitScreen: s.Main_Clip, hasAccount: true}).screen === s.Main_Clip, 'explicit screen remains authoritative');
check(s.Navigation_Startup({hasAccount: true, hasToken: false}).screen === s.Main_UserLive, 'username-only account is still an account');
check(s.Navigation_Startup({hasAccount: false}).screen === null, 'onboarding does not invoke account loader');

/* Rail -> Left -> followed side panel -> Right -> rail -> Right: the keys go back to the screen on view, never to the
 * screen that opened the side panel earlier (that stale handler later switched screens without hiding the visible one). */
const fs = require('fs'),
    vm = require('vm'),
    UglifyJS = require('uglify-js');
vm.runInContext(fs.readFileSync('app/general/TVKeyValue.js', 'utf8'), s);
UglifyJS.parse(fs.readFileSync('app/specific/Sidepannel.js', 'utf8')).body.forEach(node => {
    if (node instanceof UglifyJS.AST_Defun && /^Sidepannel_(Start|StartMain|userLiveKeyRight)$/.test(node.name.name))
        vm.runInContext(node.print_to_string(), s);
});
const keydown = new Set(),
    noop = () => {};
s.Main_addEventListener = (type, fun) => type === 'keydown' && keydown.add(fun);
s.Main_removeEventListener = (type, fun) => type === 'keydown' && keydown.delete(fun);
s.Main_getElementById = () => ({contains: () => false});
s.document = {activeElement: null, body: {}, querySelectorAll: () => []};
['Main_AddClass', 'Main_RemoveClass', 'Main_AddClassWithEle', 'Screens_LoadPreviewSTop', 'Navigation_Render', 'Navigation_Focus'].forEach(
    n => (s[n] = noop)
);
['Sidepannel_HideEle', 'Sidepannel_Hidecenefeed', 'Sidepannel_ShowNoUserWarning'].forEach(n => (s[n] = noop));
s.Sidepannel_StartFeed = () => {
    s.Sidepannel_IsMain = false;
    s.s_feedOpen = true;
    s.Main_addEventListener('keydown', s.Sidepannel_handleKeyDown);
};
s.Sidepannel_handleKeyDown = function Sidepannel_handleKeyDown() {};
s.AddUser_UserHasToken = () => true;
s.KickUser_IsKickOnly = () => false;
s.Settings_isVisible = () => false;
s.Navigation_Tabs = () => ['live', 'front page'];
s.Sidepannel_ThumbDoc = {};
const usersKeys = function Users_handleKeyDown() {},
    browseKeys = function BrowseKeys() {};
s.ScreenObj = {};
s.ScreenObj[s.Main_Live] = {key_fun: browseKeys};
s.Main_values = {Main_Go: s.Main_Live};
s.Navigation_Onboarding = false;
s.Sidepannel_Callback = usersKeys; // the Account screen opened the side panel before the user went to Browse
s.Sidepannel_IsMain = true;
s.Navigation_State.destination = 'browse';
s.UIFocus_Clear();
keydown.add(browseKeys);
const key = code => s.Navigation_Handle({keyCode: code, preventDefault: noop, stopImmediatePropagation: noop}, false);
s.Navigation_Open(browseKeys, 'tabs');
key(s.KEY_LEFT); // tabs -> rail
key(s.KEY_LEFT); // rail -> followed side panel
check(s.s_feedOpen && keydown.has(s.Sidepannel_handleKeyDown), 'Left from the rail opens the followed side panel');
s.Main_removeEventListener('keydown', s.Sidepannel_handleKeyDown);
s.Sidepannel_userLiveKeyRight(); // side panel -> rail
key(s.KEY_RIGHT); // rail closes
check(keydown.has(browseKeys) && !keydown.has(usersKeys), 'closing the rail restores the keys of the screen on view, not a stale one');
check(keydown.size === 1, 'exactly one key handler after the side panel round trip');
s.UIFocus_Clear();

/* Settings and the search form have no grid: returning to them (side panel Back, exit dialog cancel) must not open the
 * grid of Main_Go behind them (it was drawn over Settings and took its keys). */
UglifyJS.parse(fs.readFileSync('app/specific/Main.js', 'utf8')).body.forEach(node => {
    if (node instanceof UglifyJS.AST_Defun && node.name.name === 'Main_SwitchScreen') vm.runInContext(node.print_to_string(), s);
});
const opened = [];
['Main_HideWarningDialog', 'Main_SaveValues'].forEach(n => (s[n] = noop));
s.Settings_init = () => opened.push('settings');
s.Search_init = () => opened.push('search');
s.ScreenObj[s.Main_Live].init_fun = () => opened.push('live grid');
s.ScreenObj[s.Main_UserLive] = {init_fun: () => opened.push('following grid')};
s.Settings_isVisible = () => true;
s.Main_values = {Main_Go: s.Main_UserLive};
s.Main_SwitchScreen();
check(opened.join() === 'settings', 'Settings on view: back to Settings, no grid behind it, got ' + opened);
opened.length = 0;
s.Settings_isVisible = () => false;
let searchOnView = true;
s.Main_isElementShowing = id => id === 'search_scroll' && searchOnView;
s.Main_values = {Main_Go: s.Main_Search};
s.Main_SwitchScreen();
check(opened.join() === 'search', 'search form on view: back to the form, not the Live grid, got ' + opened);
opened.length = 0;
// Account entered from the form keeps Main_Search as its return target while the form is hidden: no form trap
searchOnView = false;
s.Main_values = {Main_Go: s.Main_Search};
s.Main_SwitchScreen();
check(opened.join() === 'live grid', 'stale Main_Search with the form hidden keeps the old Live fallback, got ' + opened);
opened.length = 0;
s.Main_values = {Main_Go: s.Main_UserLive};
s.Main_SwitchScreen();
check(opened.join() === 'following grid', 'a grid screen is still switched to as before');
console.log(checks + ' production navigation checks passed');
