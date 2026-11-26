import { useEffect, useRef, type ReactNode } from "react";
import "./SuggestionMenu.css";

export type Suggestion = {
  id: string;
  /** What gets inserted, shown in blue. */
  label: string;
  /** One short line on what it does. */
  detail?: string;
  /** Something to show before the label, such as an avatar. */
  leading?: ReactNode;
};

type SuggestionMenuProps = {
  items: Suggestion[];
  activeIndex: number;
  onActiveChange: (index: number) => void;
  onPick: (item: Suggestion) => void;
  ariaLabel: string;
  /** The text typed so far; the matching start of each label is set in full strength. */
  typed?: string;
  /** Small line above the list, for menus whose rows need explaining. */
  heading?: string;
  idPrefix?: string;
};

/** Floating list for slash commands and @ mentions, shown above the prompt bar. */
export default function SuggestionMenu({ items, activeIndex, onActiveChange, onPick, ariaLabel, typed = "", heading, idPrefix = "suggest" }: SuggestionMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation moves the highlight; keep it on screen.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items]);

  if (items.length === 0) return null;
  const query = typed.toLowerCase();

  return <div className="luma-suggest-anchor">
    <div className="luma-suggest">
      {heading && <p className="luma-suggest-heading">{heading}</p>}
      <div className="luma-suggest-list" role="listbox" aria-label={ariaLabel} ref={listRef}>
        {items.map((item, index) => {
          const matched = query && item.label.toLowerCase().startsWith(query) ? item.label.slice(0, query.length) : "";
          return <button
            key={item.id}
            id={`${idPrefix}-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            data-active={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActiveChange(index)}
            onClick={() => onPick(item)}
            className="luma-suggest-row"
          >
            {item.leading}
            <span className="luma-suggest-label"><b>{matched}</b>{item.label.slice(matched.length)}</span>
            {item.detail && <span className="luma-suggest-detail">{item.detail}</span>}
          </button>;
        })}
      </div>
      <div className="luma-suggest-footer" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd>Move</span>
        <span><kbd>Tab</kbd>Complete</span>
        <span><kbd>Esc</kbd>Close</span>
      </div>
    </div>
  </div>;
}
