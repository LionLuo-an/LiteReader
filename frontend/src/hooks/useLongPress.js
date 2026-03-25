
import { useCallback, useRef } from 'react';

const useLongPress = (onLongPress, onClick, { shouldPreventDefault = true, delay = 500 } = {}) => {
    const timeout = useRef();
    const target = useRef();
    const isLongPress = useRef(false);
    const startPos = useRef({ x: 0, y: 0 });

    const start = useCallback((event) => {
        // Prevent default processing for context menu on long press
        if (event.type === 'contextmenu' && shouldPreventDefault) {
            event.preventDefault();
            return;
        }

        // Only listen to left click for mouse
        if (event.type === 'mousedown' && event.button !== 0) return;

        // Store start position to detect movement
        if (event.touches && event.touches[0]) {
            startPos.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        }

        target.current = event.target;
        isLongPress.current = false;

        timeout.current = setTimeout(() => {
            isLongPress.current = true;
            if (navigator.vibrate) navigator.vibrate(50);
            onLongPress(event);
        }, delay);
    }, [onLongPress, delay, shouldPreventDefault]);

    const clear = useCallback((event, shouldTriggerClick = true) => {
        const wasTimerRunning = !!timeout.current;

        if (timeout.current) {
            clearTimeout(timeout.current);
            timeout.current = null;
        }

        // Trigger Click if NOT long press, timer WAS running (so not cancelled), and request says so
        if (shouldTriggerClick && wasTimerRunning && !isLongPress.current && onClick) {
            onClick(event);
        }

        // Reset long press flag
        // We delay resetting long press flag slightly if we need to check it in caller, 
        // but here wrapped in clear is fine.
        isLongPress.current = false;

        return wasTimerRunning;
    }, [onClick]);

    const move = useCallback((event) => {
        if (!timeout.current) return;

        const moveThreshold = 10;
        let x, y;

        if (event.touches && event.touches[0]) {
            x = event.touches[0].clientX;
            y = event.touches[0].clientY;

            if (Math.abs(x - startPos.current.x) > moveThreshold || Math.abs(y - startPos.current.y) > moveThreshold) {
                if (timeout.current) {
                    clearTimeout(timeout.current);
                    timeout.current = null;
                }
            }
        }
    }, []);

    return {
        onMouseDown: start,
        onTouchStart: start,

        onMouseUp: (e) => clear(e),
        onMouseLeave: (e) => clear(e, false),

        onTouchEnd: (e) => {
            // Capture state before clearing
            const wasRunning = !!timeout.current;
            const wasLong = isLongPress.current;

            clear(e);

            // If we handled the event (either as click or longpress), prevent default to stop ghost mouse events
            if ((wasRunning || wasLong) && e.cancelable && shouldPreventDefault) {
                e.preventDefault();
            }
        },
        onTouchMove: move,

        onContextMenu: useCallback((e) => {
            if (shouldPreventDefault) e.preventDefault();
        }, [shouldPreventDefault])
    };
};

export default useLongPress;
