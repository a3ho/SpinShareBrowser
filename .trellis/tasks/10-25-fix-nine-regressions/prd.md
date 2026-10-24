# Fix all 9 user-reported regressions with real-app verification

## Goal

User reported 9 issues twice with 'fixes had no effect'. Root causes: (1) login watcher methods deleted in 2.3.3 refactor -> premature timeout; (2) drag-region viewport check killed controls on maximize; (3+4) auto-update checkbox assigned to frozen APP_CONFIG -> silent revert; (5) syncReviewVisibility force-closed 0-review drawers; (6) UA popover sheet inset/margin re-centered account menu + engine document.hidden bail; (7) playlist preload on login; (8) review inline layout; (9) 0-review toggle disabled when signed out. All verified: DOM-precise in browser, pixel-diff in real window, signed-in + signed-out instances, 70s login watch.

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
