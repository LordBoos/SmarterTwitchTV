/* Execute production action descriptors through PlayerUI, with observable bridge/state stubs. */
const fs = require('fs'),
    vm = require('vm'),
    assert = require('assert'),
    UglifyJS = require('uglify-js');
const built = process.argv.includes('--built');
const source = fs.readFileSync(built ? 'release/githubio/js/main_uncompressed.js' : 'app/specific/PlayEtc.js', 'utf8');
const ast = UglifyJS.parse(source);
let maker;
ast.walk(
    new UglifyJS.TreeWalker(node => {
        if (node instanceof UglifyJS.AST_Defun && node.name.name === 'Play_MakeControls') maker = node;
    })
);
const constants = source.slice(source.indexOf('var Play_controls ='), source.indexOf('function Play_MakeControls()'));
const assignments = maker.body.filter(
    node =>
        node instanceof UglifyJS.AST_SimpleStatement &&
        node.body instanceof UglifyJS.AST_Assign &&
        node.body.left.print_to_string().startsWith('Play_controls[')
);
const nodes = new Map(),
    effects = [],
    timers = new Map();
let clock = 0,
    serial = 0,
    checks = 0;
function element(id) {
    if (!nodes.has(id))
        nodes.set(id, {
            id,
            style: {},
            textContent: '',
            classList: {
                classes: new Set(),
                add(c) {
                    this.classes.add(c);
                },
                remove(c) {
                    this.classes.delete(c);
                }
            },
            setAttribute() {},
            removeAttribute() {},
            focus() {},
            querySelector() {
                return null;
            },
            querySelectorAll() {
                return [];
            }
        });
    return nodes.get(id);
}
const s = {
    console,
    Array,
    Math,
    Play_isOn: true,
    PlayVod_isOn: false,
    PlayClip_isOn: false,
    PlayExtra_PicturePicture: false,
    Play_MultiEnable: false,
    Play_isFullScreen: true,
    Play_Multi_MainBig: false,
    Play_ChatEnable: false,
    Play_LowLatency: 0,
    Play_ChatDelayValue: 0,
    Play_ChatPositions: 0,
    Play_ChatSizeValue: 0,
    Play_ChatFullScreenObj: {},
    Play_Status_Visible: 0,
    Main_values: {ChatBackground: 0, Play_ChatForceDisable: false},
    Settings_value: {
        content_lang: {values: ['All', 'English'], defaultValue: 0},
        disabled_shared: {defaultValue: 0},
        show_feed_player: {defaultValue: 0},
        preview_sizes: {defaultValue: 0},
        preview_volume_new: {defaultValue: 0},
        preview_others_volume_new: {defaultValue: 0}
    },
    Main_getElementById: element,
    Main_ShowElement: id => effects.push('show:' + id),
    Main_HideElement: id => effects.push('hide:' + id),
    Main_AddClass: (id, cls) => element(id).classList.add(cls),
    Main_RemoveClass: (id, cls) => element(id).classList.remove(cls),
    Main_addEventListener() {},
    Main_removeEventListener() {},
    Main_isScene2DocVisible: () => true,
    Main_textContent: (id, value) => {
        element(id).textContent = value;
    },
    Main_textContentWithEle: (el, value) => {
        if (el) el.textContent = value;
    },
    Main_setItem: (key, value) => effects.push(['store', key, value]),
    Main_SaveValuesWithTimeout: () => effects.push('save'),
    Main_setTimeout: (fn, delay) => {
        const id = ++serial;
        timers.set(id, {fn, due: clock + delay});
        return id;
    },
    Main_clearTimeout: id => timers.delete(id),
    Play_isEndDialogVisible: () => false,
    Play_StayDialogVisible: () => false,
    Play_isChatShown: () => s.Play_ChatEnable,
    Play_showChat: () => {
        s.Play_ChatEnable = true;
        effects.push('chat:on');
    },
    Play_hideChat: () => {
        s.Play_ChatEnable = false;
        effects.push('chat:off');
    },
    Play_clearHidePanel() {},
    Play_hidePanelFull: mode => effects.push(['hidePanel', mode]),
    OSInterface_setPlaybackSpeed: value => effects.push(['speed', value]),
    Play_ResetSpeed: () => effects.push('speed:reset'),
    Play_ChatPosition: () => effects.push('chatpos'),
    PhoneChat_Show: () => effects.push('phone:show'),
    KickApi_IsKickRow: data => !!data && data[19] === 'kick',
    Play_showWarningMiddleDialog: (text, ms) => effects.push(['warn', text, ms]),
    STR_KICK_NOT_SUPPORTED: 'Not available for Kick streams',
    Play_ResetLowlatency() {},
    PlayVod_ChaptersArray: [],
    Play_HasLive: false,
    PlayClip_HasVOD: false,
    Play_MultiArray: [{data: ['a']}, {data: ['b']}, {data: []}, {data: []}],
    Play_CurrentSpeed: 3,
    Play_FullScreenPosition: 0,
    Play_FullScreenSize: 0,
    Play_ChatFontSize: 0,
    STR_CHAT_BASE_ARRAY: ['right'],
    STR_CHAT_100_ARRAY: ['full'],
    STR_CHAT_SIDE_ARRAY: ['side'],
    Play_PreviewEnable: 0,
    Play_volumes: [100, 50, 100, 100],
    Play_audio_enable: [1, 1, 0, 0],
    Settings_GetVolumes: () => [0, 25, 50, 75, 100],
    Settings_Obj_default: () => 0,
    Main_IsOn_OSInterface: true,
    Main_A_includes_B: (a, b) => String(a).includes(b),
    Play_data: {
        data: [],
        quality: 'Auto',
        qualityPlaying: 'Auto',
        qualityIndex: 1,
        qualities: [
            {id: 'Auto', position: -1},
            {id: '720p', position: 2}
        ]
    },
    Play_data_base: {},
    Play_getQualitiesCount: () => s.Play_data.qualities.length,
    PlayVod_qualities: [{id: 'Auto', position: -1}],
    PlayVod_getQualitiesCount: () => s.PlayVod_qualities.length,
    PlayVod_qualityPlaying: 'Auto',
    PlayVod_qualityIndex: 0,
    PlayClip_qualities: [{id: 'Auto', position: -1}],
    PlayClip_getQualitiesCount: () => s.PlayClip_qualities.length,
    PlayClip_qualityPlaying: 'Auto',
    PlayClip_qualityIndex: 0,
    Play_SetPlayQuality: id => {
        s.Play_data.quality = id;
        effects.push(['select', id]);
    },
    Play_SetHtmlQuality() {},
    Play_info_quality: {},
    OSInterface_SetQuality: position => effects.push(['quality', position]),
    OSInterface_RestartPlayer: (...args) => effects.push(['restart', ...args]),
    Play_qualityIndexReset: () => effects.push('quality:reset'),
    Play_ResetPanel: mode => effects.push(['resetPanel', mode]),
    UIFocus_DomRelease: () => false,
    Play_BottonIcons_Pause: null,
    UIFocus_Suspend() {},
    UIFocus_Stack: [],
    UIFocus_Push: owner => {
        if (!owner || !owner.id || typeof owner.handle !== 'function') return false;
        s.UIFocus_Stack.push(owner);
        return true;
    },
    UIFocus_Pop: () => {
        const owner = s.UIFocus_Stack.pop();
        if (!owner) return null;
        if (owner.cleanup) owner.cleanup();
        return owner;
    },
    Play_ForceShowPannel() {},
    KEY_ENTER: 13,
    KEY_LEFT: 37,
    KEY_UP: 38,
    KEY_RIGHT: 39,
    KEY_DOWN: 40,
    KEY_RETURN: 27,
    KEY_KEYBOARD_BACKSPACE: 8
};
// Labels are fixtures; production descriptors, callbacks, indexes and adapter behavior are not copied.
for (const name of new Set(source.match(/\bSTR_[A-Z_0-9]+\b/g))) if (!(name in s)) s[name] = name;
vm.createContext(s);
vm.runInContext(constants, s);
// Provide only initialization dependencies used by object literals (not callback dependencies).
for (const statement of assignments) {
    const initializers = [];
    statement.body.right.walk(
        new UglifyJS.TreeWalker(function (node) {
            if (node instanceof UglifyJS.AST_Function) return true;
            if (node instanceof UglifyJS.AST_SymbolRef && !(node.name in s)) initializers.push(node.name);
        })
    );
    for (const name of initializers) s[name] = 0;
    vm.runInContext(statement.print_to_string(), s);
}
if (built) {
    const definitions = [];
    ast.walk(
        new UglifyJS.TreeWalker(node => {
            if (node instanceof UglifyJS.AST_Defun && /^PlayerUI_/.test(node.name.name)) definitions.push(node.print_to_string());
            if (node instanceof UglifyJS.AST_Var) {
                const matches = node.definitions.filter(def => /^PlayerUI_/.test(def.name.name));
                if (matches.length) definitions.push(new UglifyJS.AST_Var({definitions: matches}).print_to_string());
            }
        })
    );
    vm.runInContext(definitions.join('\n'), s);
} else vm.runInContext(fs.readFileSync('app/specific/PlayerUI.js', 'utf8'), s);
function check(value, label) {
    assert.ok(value, label);
    checks++;
}
check(Object.keys(s.Play_controls).length === 49, 'all production control declarations loaded');
const mapped = new Set(Object.values(s.PlayerUI_Groups()).flat());
for (const key of Object.keys(s.Play_controls))
    check(
        mapped.has(Number(key)) || [s.Play_controlsBack, s.Play_controlsAudio, s.Play_controlsPreview].includes(Number(key)),
        'every action has a destination: ' + key
    );
for (const key of Object.keys(s.Play_controls)) {
    const control = s.Play_controls[key];
    control.position = Number(key);
    control.doc = element('control-' + key);
    control.doc_title = element('title-' + key);
    control.doc_name = element('value-' + key);
    control.button_text = element('text-' + key);
    control.bottomArrows = () => {};
}
s.PlayerUI_Render = () => effects.push('render');
s.PlayerUI_State.mode = 1;
s.PlayerUI_State.frames = [{group: 'playback', index: 0, entries: [s.Play_controlsSpeed]}];
check(s.PlayerUI_Action(s.Play_controlsSpeed, 1), 'speed adjustment accepted');
check(s.Play_controls[s.Play_controlsSpeed].defaultValue === 4, 'real speed descriptor selects pending value');
s.PlayerUI_Action(s.Play_controlsSpeed, 0);
check(
    effects.some(x => Array.isArray(x) && x[0] === 'speed' && x[1] === 1.05),
    'production callback sets actual playback speed'
);
s.PlayerUI_State.frames = [{group: 'chat', index: 0, entries: [s.Play_controlsChat, s.Play_controlsPhoneChat]}];
s.PlayerUI_Action(s.Play_controlsChat, 0);
check(s.Play_ChatEnable && effects.includes('chat:on'), 'real chat toggle side effect');
check(
    effects.some(x => Array.isArray(x) && x[0] === 'store' && x[1] === 'ChatEnable' && x[2] === 'true'),
    'chat preference preserved'
);
s.PlayerUI_Action(s.Play_controlsPhoneChat, 0);
check(effects.includes('phone:show'), 'existing pairing lifecycle invoked');
s.Play_data.data[19] = 'kick';
effects.length = 0;
s.PlayerUI_Action(s.Play_controlsPhoneChat, 0);
check(!effects.includes('phone:show') && effects.some(x => Array.isArray(x) && x[0] === 'warn' && x[1] === 'Not available for Kick streams'), 'kick stream: phone chat not available');
s.Play_data.data[19] = undefined;
s.PlayerUI_State.mode = 2;
check(!s.PlayerUI_Action(s.Play_controlsPhoneChat, 0), 'phone action rechecks VOD availability at execution');
s.PlayerUI_State.mode = 1;
s.PlayerUI_State.frames = [{group: 'quality', index: 0, entries: [s.Play_controlsQuality]}];
s.PlayerUI_Action(s.Play_controlsQuality, 0);
check(
    effects.some(x => Array.isArray(x) && x[0] === 'quality' && x[1] === 2),
    'quality commits actual bridge position'
);
/* Quality drawer list: one row per rendition; picking the playing one must not restart. */
s.Play_data.qualities = [
    {id: 'Auto', position: -1},
    {id: '720p', position: 2},
    {id: '480p', position: 4}
];
s.Play_data.qualityPlaying = 'Auto';
s.Play_data.qualityIndex = 0;
s.PlayerUI_State.mode = 1;
s.PlayerUI_State.frames = [
    {group: 'bar', index: 2},
    {group: 'quality', index: 0, entries: ['q:Auto', 'q:720p', 'q:480p'], list: true}
];
const commitEffects = () => effects.filter(x => Array.isArray(x) && (x[0] === 'quality' || x[0] === 'restart' || x[0] === 'select')).length;
const commitsBefore = commitEffects();
s.PlayerUI_Handle({keyCode: s.KEY_ENTER}, false);
check(commitEffects() === commitsBefore, 'picking the playing rendition changes nothing');
check(!effects.some(x => Array.isArray(x) && x[0] === 'restart'), 'playing rendition pick never restarts the stream');
check(s.PlayerUI_State.frames.length === 1 && s.PlayerUI_State.frames[0].group === 'bar', 'playing rendition pick returns to the bar');
s.PlayerUI_State.frames = [
    {group: 'bar', index: 2},
    {group: 'quality', index: 1, entries: ['q:Auto', 'q:720p', 'q:480p'], list: true}
];
s.PlayerUI_Handle({keyCode: s.KEY_ENTER}, false);
check(commitEffects() === commitsBefore + 2, 'picking another rendition commits exactly once');
check(s.Play_data.qualityIndex === 1, 'picked rendition index stored');
check(s.PlayerUI_State.frames.length === 1 && s.PlayerUI_State.frames[0].group === 'bar', 'applied pick returns to the bar');
/* A hole in the mode's qualities array must not shift the stored index of the picked rendition. */
s.Play_data.qualities = [{id: 'Auto', position: -1}, null, {id: '720p', position: 2}];
s.Play_data.qualityPlaying = 'Auto';
s.Play_data.qualityIndex = 0;
const holeList = s.PlayerUI_QualityList();
check(holeList.items.length === 2 && holeList.indexes[1] === 2, "list keeps each rendition's array index");
s.PlayerUI_State.frames = [
    {group: 'bar', index: 2},
    {group: 'quality', index: 1, entries: ['q:Auto', 'q:720p'], list: true}
];
s.PlayerUI_Handle({keyCode: s.KEY_ENTER}, false);
check(s.Play_data.qualityIndex === 2, 'picked rendition stores its own array index');
s.Play_data.qualities = [
    {id: 'Auto', position: -1},
    {id: '720p', position: 2},
    {id: '480p', position: 4}
];
/* Spinner rows: Left/Right adjust values through the production updown. */
s.PlayerUI_State.frames = [{group: 'chatSettings', index: 0, entries: [s.Play_controlsChatPos]}];
s.Play_ChatEnable = true;
s.Play_ChatPositions = 0;
s.Play_controls[s.Play_controlsChatPos].defaultValue = 0;
s.PlayerUI_Action(s.Play_controlsChatPos, 1);
check(s.Play_ChatPositions === 1 && effects.includes('chatpos'), 'chat position adjusts with the right key');
s.PlayerUI_Action(s.Play_controlsChatPos, -1);
check(s.Play_ChatPositions === 0, 'chat position adjusts back with the left key');
/* Drawer orientation helpers: per-drawer help line and full cleanup of drawer state. */
s.STR_UI = {playerHelp: 'adjust', playerHelpMenu: 'menu', playerHelpList: 'list', playerHelpAction: 'action'};
check(s.PlayerUI_HelpText({group: 'more'}) === 'menu', 'More menu shows the open help line');
check(s.PlayerUI_HelpText({group: 'quality', list: true}) === 'list', 'quality list shows the select help line');
check(
    s.PlayerUI_HelpText({group: 'playback', index: 0, entries: [s.Play_controlsSpeed]}) === 'adjust',
    'rows with a value range keep the adjust help line'
);
check(s.PlayerUI_HelpText({group: 'playback', index: 0, entries: [s.Play_controlsScreeOff]}) === 'action', 'action rows do not advertise Left/Right');
/* Paused state: every main-player start clears it; the chip is hidden either way. */
s.PlayerUI_State.paused = true;
s.PlayerUI_State.frames = [];
s.PlayerUI_ResetPaused();
check(!s.PlayerUI_State.paused && effects.includes('hide:player-ui-paused'), 'paused state and chip reset on a new playback');
s.document = {activeElement: null, body: {}};
s.PlayerUI_State.frames = [];
s.PlayerUI_Show(1);
element('player-ui').classList.add('player-ui-drawer-open');
element('scene2').classList.add('player-ui-drawer-open');
s.UIFocus_Pop(false);
check(
    !element('player-ui').classList.classes.has('player-ui-drawer-open') && !element('scene2').classList.classes.has('player-ui-drawer-open'),
    'owner cleanup drops the drawer-open state'
);
s.PlayerUI_State.frames = [{group: 'bar', index: 0}];
s.Play_MultiEnable = true;
check(!s.PlayerUI_Available(s.Play_controlsQuality, 'quality'), 'single-stream quality absent in multistream');
check(s.PlayerUI_Available(s.Play_controlsQualityMulti, 'quality'), 'multistream restart remains reachable');
check(s.PlayerUI_Available(s.Play_controlsAudioVol1, 'audio'), 'populated second slot audio visible');
check(!s.PlayerUI_Available(s.Play_controlsAudioVol2, 'audio'), 'empty third slot audio hidden');
s.Play_MultiEnable = false;
s.PlayExtra_PicturePicture = true;
check(s.PlayerUI_Available(s.Play_controlsQualityMini, 'quality'), 'PiP quality/restart remains reachable');
s.PlayExtra_PicturePicture = false;
s.PlayerUI_State.frames = [{group: 'bar', index: 0}];
s.PlayerUI_ScheduleHide();
check(timers.size === 1, 'one bar hide timer');
s.PlayerUI_State.frames.push({group: 'chat', index: 1, entries: [s.Play_controlsPhoneChat]});
s.PlayerUI_ScheduleHide();
check(timers.size === 0, 'drawer suspends hide timer');
s.PlayerUI_SuspendPhone();
check(s.PlayerUI_State.suspended, 'pairing suspends owner');
s.PlayerUI_ResumePhone(false);
check(!s.PlayerUI_State.suspended && s.PlayerUI_State.frames.length === 2, 'pairing restores drawer and row');
check(timers.size === 0, 'pairing return does not hide active drawer');
s.PlayerUI_State.frames = [{group: 'bar', index: 2}];
s.PlayerUI_ScheduleHide();
clock += 5000;
for (const timer of [...timers.values()]) if (timer.due <= clock) timer.fn();
check(
    effects.some(x => Array.isArray(x) && x[0] === 'hidePanel' && x[1] === 1),
    'bar timeout delegates existing hide policy'
);
/* 4-way multistream gate: a device with fewer than 4 hardware decoder instances needs the hybrid HW/SW mode */
const multi = s.Play_controls[s.Play_MultiStream];
Object.assign(s, {
    Play_hidePanel: () => effects.push('hidePanel'),
    OSInterface_EnableMultiStream: (big, offset) => effects.push(['multiOn', big, offset]),
    OSInterface_DisableMultiStream: () => effects.push('multiOff'),
    Play_MultiArray: [{data: []}, {data: []}, {data: []}, {data: []}],
    Play_data_base: {data: []},
    Play_MultiSetInfo() {},
    twemoji: {parse: text => text},
    Play_Multi_SetPanel() {},
    Play_MultiInfoReset() {},
    Play_SetAudioIcon() {},
    Play_Multi_UnSetPanel() {},
    Play_CleanHideExit() {},
    Play_getQualities() {},
    Play_qualityDisplay() {},
    Play_ChatEnable: false,
    Play_MultiEnable: false,
    Play_MaxInstances: 2,
    Play_MultiHybrid: false,
    STR_4_WAY_MULTI_INSTANCES: 'Only %x decoders at once, '
});
// the warning names the real instance count: %x is substituted
const multiWarned = () => effects.some(x => Array.isArray(x) && x[0] === 'warn' && x[1] === 'Only 2 decoders at once, STR_4_WAY_MULTI');
const multiStarted = () => effects.some(x => Array.isArray(x) && x[0] === 'multiOn');
effects.length = 0;
multi.enterKey();
check(!s.Play_MultiEnable && multiWarned() && !multiStarted(), '2 decoder instances without hybrid mode: 4-way blocked with the instances warning');
s.Play_MultiHybrid = true;
effects.length = 0;
multi.enterKey();
check(s.Play_MultiEnable && !multiWarned() && multiStarted(), '2 decoder instances with hybrid mode: 4-way starts');
multi.enterKey();
check(!s.Play_MultiEnable && effects.includes('multiOff'), 'hybrid 4-way can be closed again');
s.Play_MaxInstances = 4;
s.Play_MultiHybrid = false;
effects.length = 0;
multi.enterKey();
check(s.Play_MultiEnable && !multiWarned() && multiStarted(), '4 decoder instances: 4-way starts without hybrid mode (unchanged)');
multi.enterKey();

/* Hybrid setting: values, default, bridge guard and when the row exists */
const settingsAst = UglifyJS.parse(fs.readFileSync('app/specific/Settings.js', 'utf8'));
const osAst = UglifyJS.parse(fs.readFileSync('app/specific/OSInterface.js', 'utf8'));
const defun = (tree, name) => {
    const node = tree.body.find(n => n instanceof UglifyJS.AST_Defun && n.name.name === name);
    assert.ok(node, name + ' exists');
    return node.print_to_string();
};
let hybridProp;
settingsAst.walk(
    new UglifyJS.TreeWalker(node => {
        if (node instanceof UglifyJS.AST_ObjectKeyVal && node.key === 'multi_hybrid') hybridProp = node.value.print_to_string();
    })
);
check(hybridProp, 'multi_hybrid setting declared');
const hybridDefaults = vm.runInNewContext('(' + hybridProp + ')');
check(JSON.stringify(hybridDefaults.values) === '["off","480p","720p"]', 'hybrid setting values: off, 480p, 720p');
check(hybridDefaults.values[hybridDefaults.defaultValue - 1] === '480p', 'hybrid setting default is the measured 480p cap');
const bridge = [];
const st = {
    Main_IsOn_OSInterface: true,
    Android: {},
    Main_A_includes_B: (a, b) => String(a).includes(b),
    Settings_DisableCodecs: ['c2.android.avc.decodervideo/avc'],
    Settings_CodecsValue: [],
    Settings_SetCodecsValue() {},
    Settings_value: {multi_hybrid: {values: hybridDefaults.values, defaultValue: 1}},
    Settings_Obj_default: key => st.Settings_value[key].defaultValue,
    Play_MaxInstances: 0,
    Play_MultiHybrid: false,
    Play_MultiHybridSupported: false
};
const supportBridge = () => (st.Android.SetHybridDecoders = (hw, cap) => (bridge.push([hw, cap]), true));
supportBridge();
vm.createContext(st);
vm.runInContext(
    ['Settings_SetMaxInstances', 'Settings_SetMultiHybrid'].map(n => defun(settingsAst, n)).join('\n') +
        defun(osAst, 'OSInterface_SetHybridDecoders'),
    st
);
const codec = (name, instances) => ({nameType: name + 'video/avc', instances: instances});
const hybridCase = (instances, value) => {
    bridge.length = 0;
    st.Settings_CodecsValue = [codec('OMX.MTK.VIDEO.DECODER.AVC', instances), codec('c2.android.avc.decoder', 32)];
    st.Settings_value.multi_hybrid.defaultValue = value;
    st.Settings_SetMaxInstances();
    return JSON.stringify([st.Play_MaxInstances, st.Play_MultiHybridSupported, st.Play_MultiHybrid, bridge]);
};
check(hybridCase(2, 1) === '[2,true,true,[[2,480]]]', '2 instances, 480p: hybrid on, APK told 2 hardware players and a 480p cap');
check(hybridCase(2, 2) === '[2,true,true,[[2,720]]]', '2 instances, 720p: APK told a 720p cap');
check(hybridCase(2, 0) === '[2,true,false,[[0,480]]]', '2 instances, off: hybrid off in the APK, row still offered');
check(hybridCase(3, 1) === '[3,true,true,[[3,480]]]', '3 instances: hybrid keeps 3 hardware players');
check(hybridCase(4, 1) === '[4,false,false,[]]', '4 instances: no hybrid, the APK is never called (unchanged)');
check(hybridCase(-1, 1) === '[10,false,false,[]]', 'unknown instance limit: no hybrid, the APK is never called');
check(hybridCase(1, 1) === '[1,false,false,[]]', '1 instance: no hybrid (3 software players not measured)');
delete st.Android.SetHybridDecoders;
check(hybridCase(2, 1) === '[2,false,false,[]]', 'released APK without the bridge method: no hybrid, no row, no exception');
supportBridge();
st.Main_IsOn_OSInterface = false;
check(hybridCase(2, 1) === '[2,false,false,[]]', 'browser: no hybrid, Android never called');
st.Main_IsOn_OSInterface = true;

/* A runtime change of the setting reaches the APK and the 4-way gate through the Settings_SetDefault dispatch */
vm.runInContext(defun(settingsAst, 'Settings_SetDefault'), st);
hybridCase(2, 1);
bridge.length = 0;
st.Settings_value.multi_hybrid.defaultValue = 0;
st.Settings_SetDefault('multi_hybrid');
check(JSON.stringify([st.Play_MultiHybrid, bridge]) === '[false,[[0,480]]]', 'setting changed to off at runtime: APK told no hybrid, 4-way gate closed');
st.Settings_value.multi_hybrid.defaultValue = 2;
st.Settings_SetDefault('multi_hybrid');
check(JSON.stringify([st.Play_MultiHybrid, bridge]) === '[true,[[0,480],[2,720]]]', 'setting changed to 720p at runtime: APK told the 720p cap, 4-way gate open');

/* The settings row exists only when the device and the APK support hybrid mode */
const rows = [];
const sv = new Proxy({}, {get: (t, k) => t[k] || (t[k] = {values: ['a', 'b'], defaultValue: 0})});
const ssTarget = {
    Settings_value: sv,
    Settings_Content: key => (rows.push(key), ''),
    Settings_DivTitle: () => '',
    Settings_Seek_Time: [],
    Settings_jumpTimers: [],
    Main_innerHTML() {},
    Settings_GetPreviewDelay: () => [],
    Settings_GetnotificationTime: () => [],
    Main_isTV: true,
    Main_IsOn_OSInterface: true,
    Play_MaxInstances: 2,
    Play_MultiHybridSupported: true
};
const ss = new Proxy(ssTarget, {
    has: (t, k) => k !== Symbol.unscopables,
    get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^STR_/.test(k) ? k : globalThis[k]),
    set: (t, k, v) => ((t[k] = v), true)
});
const setSettings = new Function('sandbox', 'with (sandbox) { ' + defun(settingsAst, 'Settings_SetSettings') + ' Settings_SetSettings(); }');
setSettings(ss);
check(
    rows.indexOf('multi_hybrid') > 0 && rows.indexOf('multi_hybrid') === rows.indexOf('PP_workaround') + 1,
    'hybrid row shown in the player section after the PP workaround'
);
rows.length = 0;
ssTarget.Play_MultiHybridSupported = false;
setSettings(ss);
check(rows.length > 10 && rows.indexOf('multi_hybrid') === -1, 'hybrid row hidden when the device or the APK does not support it');
console.log(checks + ' production player action checks passed');
