import { useEffect, useRef } from 'react';

export function useFocusTrap<T extends HTMLElement = HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  // The element focused before the first render, i.e. before any React
  // `autoFocus` inside a dialog that mounts already active could run.
  const focusBeforeMount = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );

  useEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;

    // Remember where focus came from so it can be restored on close. If a
    // child already took focus (React `autoFocus`), use the pre-mount element.
    const current = document.activeElement as HTMLElement | null;
    previousFocus.current = current && !container.contains(current) ? current : focusBeforeMount.current;

    // Keep focus that a child already claimed (React's `autoFocus` focuses the
    // element without rendering an attribute); otherwise use an explicit
    // [data-autofocus] target, then the first control.
    if (!current || current === document.body || !container.contains(current)) {
      const focusables = getFocusables(container);
      const initialFocus = focusables.find((element) => element.hasAttribute('data-autofocus')) ?? focusables[0];
      initialFocus?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusables = getFocusables(container);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [active]);

  return containerRef;
}

function getFocusables(el: HTMLElement): HTMLElement[] {
  return Array.from(
    el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
}
