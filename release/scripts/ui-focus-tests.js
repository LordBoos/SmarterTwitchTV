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
console.log(checks + ' production focus checks passed');
