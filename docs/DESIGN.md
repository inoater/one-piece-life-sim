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

## What reacts (UI pass after Phase 1)

Motion still only answers something the player did, and `prefers-reduced-motion` turns it off; the
final page is the same either way (`src/ui/motion.ts`).

| Element         | What it does                                                                                                                                                      | Where                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Season band     | A 3px band under the masthead in the season's colour; a wake runs along it while time moves                                                                       | `src/styles/play.css`         |
| Counting vitals | Age and Berries count to their new value; a birthday or a change of money pops                                                                                    | `shell.ts`, `motion.ts`       |
| Chronicle       | New lines ink in one after another; chips filter by kind; "Latest entries (N new)" when scrolled up                                                               | `screens/feed.ts`, `shell.ts` |
| Year rail       | The chronicle's scrollbar, marked in years and dotted with personal, family and news moments; drag, click or use the keys on it; hover says the year and your age | `components/year-rail.ts`     |
| Log card        | After a time skip: months passed, birthdays, stats and money that moved, new lines, decisions waiting                                                             | `components/log-card.ts`      |
| Wanted poster   | The character's portrait: an ink bust from race, age, build, hair and race feature, stamped "Not yet"                                                             | `components/poster.ts`        |
| Stat compass    | The nine stats as a compass rose that morphs between values; dashed potential in omniscient mode                                                                  | `components/stat-chart.ts`    |
| World map       | The Map page (`#/map`, key 6) and the Birthplace chooser                                                                                                          | `src/ui/map/`                 |
| Keyboard        | N, S, E move time; 1 to 6 open sections; L new life; M menu; ? lists them                                                                                         | `shell.ts`                    |

### The life loop (Phase 2)

| Element       | What it does                                                                                              | Where                         |
| ------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Health, Vigor | Two more figures in the masthead, each with a thin bar; squall when low or overspent, label red when hurt | `shell.ts`, `styles/life.css` |
| The planner   | Numbered slots on a tide rule (squall when the slot will be skipped), an effort switch, locks in words    | `screens/actions.ts`          |
| The recap     | A page, not a modal: the life on the left, the ways to carry on on the right, unavailable ones greyed     | `screens/end.ts`              |
| The epilogue  | A ruled passage in the news colour at the foot of the chronicle; a death uses squall                      | `screens/feed.ts`             |

No new colours: Vigor uses the world category's blue, Health the tide, trouble the squall.

Scrollbars are thin and drawn in the page's colours everywhere (`src/styles/map.css`).

### The world map

The map was supplied by the project owner as a single HTML file. Its data (hand-traced islands, the
Red Line, about 150 place names and their notes) is copied verbatim into `src/ui/map/atlas-data.js`
(generated; do not edit by hand); the drawing was ported to `atlas.ts` and draws the same map every
time (it is seeded). Two changes from the original: its Google Font is replaced by the game's own
Literata (the game loads nothing from other servers), and clicks are resolved with point-in-polygon
maths instead of asking the browser, so picking a place is fast and testable. The map keeps its own
palette in both themes, because a chart is a chart; only its frame, pins and notes follow the theme.
It loads the first time it is shown (its own 58 KB chunk), so the game starts as fast as before.

The map is an illustration, not game data: Phase 3's travel graph belongs in `/data`. Birthplaces
carry a `map` position (map units) so their pins land on the right part of the world; a test checks
each one is in its region's sea.

### Checked in a browser

Light and dark, 1024px and a 375px phone. The phone check found a real bug: the year rail, placed
explicitly in the chronicle's grid cell, pushed the auto-placed chronicle into a second column and
crushed the page. The panels are now placed explicitly on phones.
