---
id: task-29
title: 'Client: GameController Multiplayer Refactor'
status: To Do
assignee: []
created_date: '2025-12-30 03:27'
labels:
  - phase-2
  - client
  - game-engine
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refactor GameController to work with server-authoritative state
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Remove local state mutations
- [ ] #2 Send actions via WebSocket instead of local execution
- [ ] #3 Apply state updates from server
- [ ] #4 Handle events for animations
- [ ] #5 My turn detection
- [ ] #6 Waiting state while action processes
<!-- AC:END -->
