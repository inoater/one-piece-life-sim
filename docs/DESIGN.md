# Design notes

## Direction

_A ship's log read by lamplight on cool water._ The chronicle is the product, so the interface is quiet
and the type does the work. Colour is cool and used sparingly: **foam** and **ink** for page and writing,
**tide** teal for the one action colour, **brass** only on the Log Pose dial and the decision rule,
**squall** for trouble. Light is the default; dark follows the device and the Menu can override it.

| Role      | Face                                                 | Used for                                                 |
| --------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Reading   | Literata (variable, Latin subset, self-hosted)       | the chronicle, headings, the date, numbers in the header |
| Interface | Hanken Grotesk (variable, Latin subset, self-hosted) | buttons, tabs, tables, labels                            |
| Developer | system monospace                                     | the debug panel only, so it never reads as story         |

## The one memorable element

The Log Pose dial in the masthead. The needle points at the current month (January at the top) and only
ever turns forward; the ring fills as the world travels the 39 years toward the present; the current
month's tick is brass. In the world panel the same progress is a 39-segment tide bar.

## Decisions and their reasons

- **No cards.** The chronicle is a ruled log grouped by month; the side panel is plain lists with rules.
  A coloured rule marks each line's category (personal, family, world, news, system) and screen readers
  get the category as hidden text, so colour is never the only signal.
- **Navigation is real links** (`<a href="#/world">`), so routes are URLs and the Back button works
  without any code of ours.
- **One column on a phone, two from 700px.** On a phone the sections are tabs and one panel shows at a
  time; the footer controls stay at the bottom with 44px targets. From 700px the chronicle and side panel
  sit together and "Feed" is not a tab.
- **Empty states say what to do next**, not "nothing here".
- **Destructive actions ask twice** (a second press, not a native dialog): load, overwrite, delete, reroll.
- **Motion answers an action** (the needle, the ring) and is disabled under `prefers-reduced-motion`.

## Review of the first idea

The first draft was a parchment-and-sepia pirate log: cream ground, serif display, terracotta accent. That
is the stock "cream, serif, terracotta" look with a theme painted on, and it says nothing specific about this
game. It was replaced by the cool palette above, with the dial carrying the identity instead of texture.

## Checked, not assumed

`tests/ui/styles.test.ts` parses `tokens.css` and verifies WCAG contrast in both themes: text at 4.5:1 or
better, and lines and control borders that carry meaning at 3:1. It caught three failures that looked fine
by eye (control borders at about 2.3:1, the brass dial at 2.9:1, the system-line rule at 2.25:1); all were
corrected. It also checks that the automatic dark theme and the explicit one are the same palette (CSS cannot
share them), that no custom property is used without being declared, and that no colour token is dead.
