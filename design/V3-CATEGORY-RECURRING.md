# Category and recurring continuation

Local candidate only. Production and financial records remain unchanged.

- Resolved the independent review's sole blocker: Home Recent activity now sorts descending by date and ID before limiting to six. A real SSR regression failed with the old oldest-first behavior, then passed; it includes eight records, a same-date tie and input-order preservation.
- Category overview uses native shared panels/badges, formatted dates, actual contribution semantics, explicit movement labels, no-posted-activity state, and preserves account scope in month forms and full-register links. Native category loader and financial arithmetic unchanged.
- Recurring amounts use signed, neutral expected-state pills (movement tone for transfers); no forecast receives an earned/received-income state. Native schedule editing/filtering remains intact.
- Fresh suite: 316 pass, 0 fail, 1211 expectations; compiler 0/0. Four Graphite phone/desktop component layout checks passed without overflow/runtime errors. These are partial synthetic checks, not signed-in saves, complete accessibility coverage or theme persistence.
- The prior source review blocked 322831e for Home order; no prior verdict is silently upgraded. Updated exact-source review and final release gates remain required. Remaining route/state coverage, audit, rollback, activation and authenticated acceptance remain open.
