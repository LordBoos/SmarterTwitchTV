/* Presentation focus helpers. No keyboard listener: the current input owner calls Dispatch. */
var UIFocus_Stack = [];
var UIFocus_SuppressedKeys = {};

/* Transfer DOM focus to the restored owner. preventScroll keeps the virtualizer's transform offsets. */
function UIFocus_DomFocus(element) {
    if (!element || !element.focus || document.activeElement === element) return false;
    try {
        element.focus({preventScroll: true}); // Old WebViews ignore the option and still focus.
    } catch (e) {
        element.focus();
    }
    return document.activeElement === element;
}

/* Release DOM focus only when the departing container still holds it; never blur another owner's control. */
function UIFocus_DomRelease(container) {
    var active = document.activeElement;
    if (container && active && active !== document.body && container.contains(active)) {
        active.blur();
        return true;
    }
    return false;
}

function UIFocus_Push(owner) {
    if (!owner || !owner.id || typeof owner.handle !== 'function') return false;
    // Reopening an owner closes descendants and cancels each pending operation once.
    for (var i = 0; i < UIFocus_Stack.length; i++) {
        if (UIFocus_Stack[i].id === owner.id) {
            while (UIFocus_Stack.length > i) UIFocus_Pop(false);
            break;
        }
    }
    UIFocus_Stack.push(owner);
    return true;
}

function UIFocus_Pop(restore) {
    var owner = UIFocus_Stack.pop();
    if (!owner) return null;
    if (owner.cleanup) owner.cleanup();
    if (restore !== false && owner.restore) owner.restore(owner.returnTarget);
    return owner;
}

function UIFocus_Clear() {
    while (UIFocus_Stack.length) UIFocus_Pop(false);
    // Keep key-up suppression until those physical keys are released.
}

function UIFocus_Dispatch(event, isKeyUp) {
    var key = event.keyCode,
        owner = UIFocus_Stack[UIFocus_Stack.length - 1],
        handled = false;
    if (!isKeyUp && UIFocus_SuppressedKeys[key] && UIFocus_SuppressedKeys[key] !== owner) {
        // A held key belongs to the owner that received its initial key-down.
        handled = true;
    } else if (isKeyUp && UIFocus_SuppressedKeys[key]) {
        delete UIFocus_SuppressedKeys[key];
        handled = true;
    } else if (owner && !owner.suspended) {
        handled = owner.handle(event, Boolean(isKeyUp)) === true;
        if (handled && !isKeyUp) UIFocus_SuppressedKeys[key] = owner;
    }
    if (handled) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    return handled;
}

function UIFocus_Suspend(id, suspended) {
    for (var i = UIFocus_Stack.length - 1; i >= 0; i--) {
        if (UIFocus_Stack[i].id === id) {
            UIFocus_Stack[i].suspended = suspended;
            return true;
        }
    }
    return false;
}

function UIFocus_Resolve(items, identity, previousIndex) {
    var i;
    for (i = 0; i < items.length; i++) {
        if (items[i].id === identity) return i;
    }
    if (!items.length) return -1;
    return Math.max(0, Math.min(items.length - 1, Math.floor(Number(previousIndex) || 0)));
}

function UIFocus_GridNeighbor(index, columns, count, direction) {
    if (!count || columns < 1) return -1;
    index = Math.max(0, Math.min(index, count - 1));
    if (direction === 'left') return index % columns ? index - 1 : index;
    if (direction === 'right') return index % columns < columns - 1 && index + 1 < count ? index + 1 : index;
    if (direction === 'up') return index >= columns ? index - columns : index;
    if (direction === 'down') return index + columns < count ? index + columns : index;
    return index;
}

/* Wrap the existing listener rather than registering a competing keyboard listener. */
function UIFocus_Listener(type, handler) {
    if ((type !== 'keydown' && type !== 'keyup') || !handler) return handler;
    var property = type === 'keydown' ? 'uiFocusDown' : 'uiFocusUp';
    if (!handler[property]) {
        handler[property] = function (event) {
            var previous = UIFocus_Stack[UIFocus_Stack.length - 1],
                wasSuspended = !!(previous && previous.suspended);
            if (!UIFocus_Dispatch(event, type === 'keyup')) {
                handler(event);
                var current = UIFocus_Stack[UIFocus_Stack.length - 1];
                if (type === 'keydown' && (current !== previous || (wasSuspended && current && !current.suspended))) {
                    // A legacy key-down that opens an overlay, or resumes the suspended top owner, still owns the held press.
                    // A fresh marker for the resume case keeps the unchanged owner from seeing the auto-repeat.
                    UIFocus_SuppressedKeys[event.keyCode] = current !== previous ? previous || {} : {};
                    // Its default action (Enter activation) must not reach the control the new owner just focused.
                    if (event.preventDefault) event.preventDefault();
                }
            }
        };
    }
    return handler[property];
}
