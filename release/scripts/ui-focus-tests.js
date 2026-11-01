/* Production focus/input helpers, tested without a second implementation or a browser. */
const assert = require('assert');
const s = require('./ui-test-sandbox')();
let checks = 0;
function check(value, message) {
    assert.ok(value, message);
    checks++;
}
for (const count of [0, 1, 2, 3, 4, 6, 7, 30]) {
    for (let i = 0; i < count; i++) {
        for (const direction of ['left', 'right', 'up', 'down']) {
            const next = s.UIFocus_GridNeighbor(i, 3, count, direction);
            check(next >= 0 && next < count, 'valid neighbor ' + [count, i, direction]);
            if (direction === 'right' || direction === 'left') check(Math.floor(next / 3) === Math.floor(i / 3), 'no row wrapping');
        }
    }
}
check(s.UIFocus_GridNeighbor(0, 3, 0, 'right') === -1, 'empty grid has no focus');
check(s.UIFocus_Resolve([{id: 'a'}, {id: 'b'}, {id: 'c'}], 'b', 0) === 1, 'restore identity after reorder');
check(s.UIFocus_Resolve([{id: 'c'}, {id: 'a'}], 'b', 1) === 1, 'nearest surviving index');
check(s.UIFocus_Resolve([{id: 'a'}], 'missing', 90) === 0, 'clamp removed tail');
check(s.UIFocus_Resolve([], 'a', 0) === -1, 'empty recovery');
let child = 0,
    parent = 0,
    cleanup = 0,
    restore = 0,
    prevented = 0,
    stopped = 0;
function event(key) {
    return {keyCode: key, preventDefault: () => prevented++, stopImmediatePropagation: () => stopped++};
}
s.UIFocus_Push({
    id: 'bar',
    handle: () => {
        parent++;
        return true;
    }
});
s.UIFocus_Push({
    id: 'drawer',
    handle: () => {
        child++;
        s.UIFocus_Pop();
        return true;
    },
    cleanup: () => cleanup++,
    restore: () => restore++
});
check(s.UIFocus_Dispatch(event(13), false), 'nested owner handles enter');
check(parent === 0 && child === 1, 'only top owner sees input');
check(cleanup === 1 && restore === 1, 'close cleans timer and restores exactly once');
check(s.UIFocus_Dispatch(event(13), false), 'held Enter cannot escape closed drawer');
check(parent === 0, 'repeat cannot activate parent');
check(s.UIFocus_Dispatch(event(13), true), 'keyup retained by closing owner');
check(parent === 0, 'keyup cannot activate parent');
check(prevented === 3 && stopped === 3, 'handled events cannot reach legacy handlers');
check(s.UIFocus_Suspend('bar', true), 'legacy dialog suspends new owner');
check(!s.UIFocus_Dispatch(event(39), false), 'legacy modal owns its input');
s.UIFocus_Suspend('bar', false);
check(s.UIFocus_Dispatch(event(39), false), 'resume new owner');
s.UIFocus_Clear();
check(s.UIFocus_Dispatch(event(39), true), 'key up still consumed after all owners close');
check(!s.UIFocus_Dispatch(event(38), false), 'legacy handler receives input without overlay');
s.UIFocus_Push({id: 'repeat', handle: () => true, cleanup: () => cleanup++});
s.UIFocus_Push({id: 'repeat', handle: () => true});
check(cleanup === 2 && s.UIFocus_Stack.length === 1, 'reopening cleans previous timer');
s.UIFocus_Clear();
s.UIFocus_Push({id: 'parent', handle: () => true, cleanup: () => cleanup++});
s.UIFocus_Push({id: 'child', handle: () => true, cleanup: () => cleanup++});
s.UIFocus_Push({id: 'parent', handle: () => true});
check(cleanup === 4 && s.UIFocus_Stack.length === 1, 'reopening parent cancels descendants');
s.UIFocus_Clear();
check(!s.UIFocus_Push({id: 'bad'}), 'invalid owner rejected');
s.UIFocus_Clear();
let opened = 0;
const openFromLegacy = s.UIFocus_Listener('keydown', () => {
    s.UIFocus_Push({
        id: 'opened',
        handle: () => {
            opened++;
            return true;
        }
    });
});
openFromLegacy(event(13));
check(s.UIFocus_Dispatch(event(13), false), 'opening legacy Enter repeat consumed');
check(opened === 0, 'held opening Enter cannot activate first drawer row');
s.UIFocus_Dispatch(event(13), true);
s.UIFocus_Dispatch(event(13), false);
check(opened === 1, 'fresh Enter works after opening key released');
s.UIFocus_Dispatch(event(13), true);
s.UIFocus_Clear();

/* A legacy key-down that opens an overlay must not deliver its default action (e.g. Enter click) to it. */
let legacyPrevented = 0;
function legacyEvent(key) {
    return {keyCode: key, preventDefault: () => legacyPrevented++, stopImmediatePropagation: () => {}};
}
const openAndCancelDefault = s.UIFocus_Listener('keydown', () => {
    s.UIFocus_Push({
        id: 'x',
        handle: () => true
    });
});
openAndCancelDefault(legacyEvent(13));
check(legacyPrevented === 1 && s.UIFocus_SuppressedKeys[13], 'opening key-down default action cancelled and suppressed');
s.UIFocus_Clear();
const plainLegacy = s.UIFocus_Listener('keydown', () => {});
plainLegacy(legacyEvent(39));
check(legacyPrevented === 1, 'legacy keys that open nothing keep their default action');
s.UIFocus_Clear();

/* A legacy key-down that resumes the suspended top owner (same object) also refocuses controls: no default action. */
s.UIFocus_Dispatch(legacyEvent(13), true);
let resumePrevented = 0;
function resumeEvent(key) {
    return {keyCode: key, preventDefault: () => resumePrevented++, stopImmediatePropagation: () => {}};
}
const resumeOwner = {id: 'player', handle: () => false, suspended: true};
s.UIFocus_Push(resumeOwner);
resumeOwner.suspended = true;
let resumeHandled = 0;
const resumeListener = s.UIFocus_Listener('keydown', () => {
    resumeOwner.suspended = false;
});
resumeListener(resumeEvent(13));
check(resumePrevented === 1, 'resuming a suspended top owner cancels the key-down default action');
check(s.UIFocus_SuppressedKeys[13], 'resuming key stays suppressed until key-up');
resumeOwner.handle = () => {
    resumeHandled++;
    return true;
};
check(s.UIFocus_Dispatch(resumeEvent(13), false) && resumeHandled === 0, 'held resuming Enter repeat is swallowed');
s.UIFocus_Dispatch(resumeEvent(13), true);
s.UIFocus_Dispatch(resumeEvent(13), false);
check(resumeHandled === 1, 'owner handles keys normally after key-up');
s.UIFocus_Clear();
s.UIFocus_Dispatch(resumeEvent(13), true);
resumePrevented = 0;
const steadyOwner = {id: 'player', handle: () => false, suspended: false};
s.UIFocus_Push(steadyOwner);
s.UIFocus_Listener('keydown', () => {})(resumeEvent(13));
check(resumePrevented === 0 && !s.UIFocus_SuppressedKeys[13], 'handler leaving owner state unchanged keeps default action');
const suspendedOwner = {id: 'player', handle: () => false, suspended: true};
s.UIFocus_Clear();
s.UIFocus_Push(suspendedOwner);
s.UIFocus_Listener('keydown', () => {})(resumeEvent(13));
check(resumePrevented === 0, 'still suspended owner keeps default action');
s.UIFocus_Clear();

/* DOM focus handoff helpers over a minimal document stub: transfer, skip and release rules. */
s.document = {activeElement: null, body: {tagName: 'BODY'}};
function fakeElement(name, inside) {
    return {
        id: name,
        inside: inside,
        focuses: 0,
        lastOptions: undefined,
        blurs: 0,
        blur: function () {
            this.blurs++;
            s.document.activeElement = null;
        },
        focus: function (options) {
            this.focuses++;
            this.lastOptions = options;
            s.document.activeElement = this;
        }
    };
}
const shell = {contains: element => Boolean(element && element.inside)};
const card = fakeElement('card', false);
const railButton = fakeElement('rail-button', true);
const modalInput = fakeElement('modal-input', false);
check(s.UIFocus_DomFocus(card) && card.focuses === 1, 'restored owner takes DOM focus');
check(card.lastOptions && card.lastOptions.preventScroll === true, 'focus requests scroll preservation');
check(!s.UIFocus_DomFocus(card) && card.focuses === 1, 'already focused element is not re-focused');
check(!s.UIFocus_DomFocus(null), 'missing element rejected');
s.document.activeElement = railButton;
check(s.UIFocus_DomRelease(shell) && railButton.blurs === 1, 'departing owner releases its DOM focus');
check(s.document.activeElement === null, 'release leaves DOM focus empty for the next owner');
s.document.activeElement = modalInput;
check(!s.UIFocus_DomRelease(shell) && modalInput.blurs === 0, 'another owner keeps its DOM focus');
s.document.activeElement = s.document.body;
check(!s.UIFocus_DomRelease(shell), 'body focus needs no release');
s.UIFocus_Clear();

/* Settings lists keep the focused row fully inside their clipped view (row geometry measured on the 1080p TV, default font). */
const fs = require('fs'),
    vm = require('vm'),
    UglifyJS = require('uglify-js');
const st = {Math: Math};
vm.createContext(st);
UglifyJS.parse(fs.readFileSync('app/specific/Settings.js', 'utf8')).body.forEach(node => {
    const literal = def => !def.value || def.value instanceof UglifyJS.AST_Constant;
    if (node instanceof UglifyJS.AST_Defun || (node instanceof UglifyJS.AST_Var && node.definitions.every(literal)))
        vm.runInContext(node.print_to_string(), st);
});
const elements = {},
    noop = () => {};
st.Main_getElementById = id => elements[id] || (elements[id] = {style: {}, offsetTop: 0, offsetHeight: 0});
['Main_AddClass', 'Main_RemoveClass', 'Settings_SetarrowsKey', 'Main_innerHTML', 'Main_ShowElement'].forEach(n => (st[n] = noop));
['Main_addEventListener', 'Main_removeEventListener', 'Navigation_Open', 'Settings_DivOptionNoSummary'].forEach(n => (st[n] = noop));
st.Main_isElementShowing = () => false;
st.Settings_Obj_default = () => 0; // animations off: scroll lands at once
Object.assign(st, {
    KEY_KEYBOARD_BACKSPACE: 8,
    KEY_RETURN: 113,
    KEY_LEFT: 37,
    KEY_RIGHT: 39,
    KEY_ENTER: 13,
    KEY_UP: 38,
    KEY_DOWN: 40,
    STR_BR: '',
    STR_CLOSE_THIS: '',
    STR_CLOSE_THIS_BROWSER: '',
    BodyfontSize: 29
});
function settingsRows(prefix, rows) {
    return rows.map((row, i) => {
        elements[prefix + i + '_div'] = {style: {}, offsetTop: row[0], offsetHeight: row[1]};
        return prefix + i;
    });
}
function hiddenWhileWalking(count, press, visible) {
    const hidden = [];
    const step = (key, i) => (press(key), visible(i) || hidden.push(i));
    for (let i = 1; i < count; i++) step(40, i);
    for (let i = count - 2; i >= 0; i--) step(38, i);
    return hidden;
}
// [offsetTop, offsetHeight] of each row
const rowsOf = text => text.split(' ').map(pair => pair.split(',').map(Number));
const mainRows = rowsOf(
    '0,70 70,84 154,70 223,38 262,38 300,38 339,38 377,38 415,38 454,38 492,84 576,70 646,70 757,84 841,70 911,84 995,70 1065,108 1173,84 1257,84 1341,70 1410,84 1495,84 1579,70 1648,70 1718,70 1788,70 1857,38 1896,38 1934,38'
);
let mainTop = 0;
elements.settings_scroll = {
    clientHeight: 734,
    scrollHeight: 1981,
    get scrollTop() {
        return mainTop;
    },
    set scrollTop(value) {
        mainTop = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    }
};
st.Settings_value_keys = settingsRows('main', mainRows);
st.Settings_positions_length = mainRows.length;
st.Settings_cursorY = 0;
st.Settings_ScrollTableReset();
st.Settings_inputFocus(0);
const mainHidden = hiddenWhileWalking(
    mainRows.length,
    key => st.Settings_handleKeyDown({keyCode: key}),
    i => i === st.Settings_cursorY && mainRows[i][0] >= mainTop && mainRows[i][0] + mainRows[i][1] <= mainTop + 734
);
check(mainHidden.length === 0, 'every Settings row is fully visible when focused, hidden: ' + mainHidden);
check(st.Settings_cursorY === 0 && mainTop === 0, 'walking back up returns to the top');

/* Settings_init (also when Main_SwitchScreen returns to Settings) leaves exactly one row highlighted */
const focusedRows = new Set();
st.Main_AddClass = (id, cls) => cls === 'settings_div_focus' && focusedRows.add(id);
st.Main_RemoveClass = (id, cls) => cls === 'settings_div_focus' && focusedRows.delete(id);
['ScreensObj_SetTopLable', 'Main_IconLoad', 'Main_HideElement', 'Navigation_Render', 'Main_textContent'].forEach(n => (st[n] = noop));
Object.assign(st, {Main_values: {Main_Go: 7}, STR_SETTINGS: '', STR_GOBACK: ''});
st.Settings_inputFocus(0);
for (let i = 0; i < 5; i++) st.Settings_handleKeyDown({keyCode: 40});
st.Settings_init();
check(focusedRows.size === 1 && focusedRows.has('main0_div'), 'Settings_init leaves only the first row highlighted, got ' + [...focusedRows]);
['Main_AddClass', 'Main_RemoveClass'].forEach(n => (st[n] = noop));

const chatRows = rowsOf(
    '0,85 85,65 150,36 186,36 223,85 307,36 344,65 409,65 474,65 539,65 604,36 640,36 676,36 713,36 749,36 786,36 822,36 858,36 895,36 931,36 968,85 1052,65 1117,36 1154,36 1190,36 1227,36 1263,36'
);
/* Every dialog is centred on the screen: one taller than the screen gets its list shrunk to the room left (1080 * 0.98 minus
 * 103 px of title and close text here) and scrolls; one that fits keeps its layout. */
st.window = {innerHeight: 1080};
function dialogModel(textId, containerId, contentHeight) {
    const container = (elements[containerId] = {
        style: {},
        get offsetHeight() {
            return this.style.height ? parseFloat(this.style.height) : contentHeight;
        },
        get clientHeight() {
            return this.offsetHeight;
        }
    });
    elements[textId] = {
        parentNode: {
            get offsetHeight() {
                return 103 + container.offsetHeight;
            }
        }
    };
    return container;
}
function shiftOf(element) {
    const m = /translateY\(-?([\d.]+)(em|px)\)/.exec(element.style.transform || '');
    // the old code wrote em of BodyfontSize while the list's own em is 0.88 (Settings dialog) or 0.98 (codecs) of it
    return m ? Number(m[1]) * (m[2] === 'em' ? element.emScale * st.BodyfontSize : 1) : 0;
}
function onScreen(rows, i, element, container) {
    const shift = shiftOf(element),
        view = Math.min(container.offsetHeight, 1080 * 0.98 - 103);
    return rows[i][0] - shift >= -0.5 && rows[i][0] + rows[i][1] - shift <= view + 0.5;
}
// Chat options through its real caller: STR_ names become their own text, every Settings_value entry a two value setting
const showChat = UglifyJS.parse(fs.readFileSync('app/specific/Settings.js', 'utf8')).body.find(
    node => node instanceof UglifyJS.AST_Defun && node.name.name === 'Settings_DialogShowChat'
);
showChat.walk(new UglifyJS.TreeWalker(node => node instanceof UglifyJS.AST_SymbolRef && /^STR_/.test(node.name) && (st[node.name] = node.name)));
const settingsValues = {};
st.Settings_value = new Proxy(settingsValues, {get: (t, k) => t[k] || (t[k] = {values: ['no', 'yes'], defaultValue: 0})});
st.Settings_DivOptionWithSummary = noop;
const chatContainer = dialogModel('dialog_settings_text', 'settings_scroll_container', 1299);
const chatScroll = (elements.settings_scroll_container_scroll = {style: {transform: ''}, emScale: 0.88});
st.Settings_DialogShowChat(false);
check(st.Settings_DialogValue.length === chatRows.length, 'Chat options rows match the measured geometry');
st.Settings_DialogValue.forEach((key, i) => (elements[key + '_div'] = {style: {}, offsetTop: chatRows[i][0], offsetHeight: chatRows[i][1]}));
const chatHidden = hiddenWhileWalking(
    chatRows.length,
    key => st.Settings_DialoghandleKeyDown({keyCode: key}),
    i => i === st.Settings_DialogPos && onScreen(chatRows, i, chatScroll, chatContainer)
);
check(chatHidden.length === 0, 'every Chat options row is fully visible on screen when focused, hidden: ' + chatHidden);

const shortRows = rowsOf('0,85 85,65 150,85');
const shortKeys = settingsRows('short', shortRows),
    shortObj = {};
shortKeys.forEach(key => (shortObj[key] = {title: key, summary: null}));
const shortContainer = dialogModel('dialog_settings_text', 'settings_scroll_container', 235);
st.Settings_DialogShow(shortObj, 'Sync', false);
const shortShifts = [];
for (let i = 0; i < 4; i++) {
    st.Settings_DialoghandleKeyDown({keyCode: 40});
    shortShifts.push(shiftOf(chatScroll));
}
check(!shortContainer.style.height && shortShifts.every(v => v === 0), 'a dialog that fits keeps its layout: ' + shortShifts);

// Blocked codecs at the largest font offset (rows measured on the TV), list container 51vh
const codecRows = rowsOf('0,166 166,166 332,166 498,166 664,166 830,166 996,166');
st.Settings_CodecsValue = settingsRows('codec', codecRows).map(nameType => ({nameType: nameType}));
st.Settings_CodecsPos = 0;
const codecContainer = dialogModel('dialog_codecs_text', 'settings_codec_container', 551);
const codecScroll = (elements.settings_codec_container_scroll = {style: {transform: ''}, emScale: 0.98});
const codecHidden = [];
for (let i = 1; i < codecRows.length; i++) {
    st.Settings_handleKeyDownCodecs({keyCode: 40});
    if (!onScreen(codecRows, i, codecScroll, codecContainer)) codecHidden.push(i);
}
check(codecHidden.length === 0, 'every Blocked codecs row is fully visible when focused, hidden: ' + codecHidden);
console.log(checks + ' production focus checks passed');
