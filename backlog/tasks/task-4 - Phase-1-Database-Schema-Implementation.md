---
id: task-4
title: 'Phase 1: Database Schema Implementation'
status: Done
assignee: []
created_date: '2025-12-30 03:23'
completed_date: '2025-12-30'
labels:
  - phase-1
  - database
  - infrastructure
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create database schema for users, characters, sessions with migration system
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Users table synced from Pocket ID
- [x] #2 Characters table with persona/progression split
- [x] #3 Sessions table with status lifecycle
- [x] #4 Session_players junction table
- [x] #5 Migration system with versioning
- [ ] #6 SQLite for dev, PostgreSQL support for prod (deferred)
<!-- AC:END -->

## Implementation Notes

Database files stored in `.data/` for container mounting and backups.

### Files Created
- `packages/server/src/db/schema.ts` - Table definitions
- `packages/server/src/db/migrations.ts` - Version-controlled migrations
- `packages/server/src/db/users.ts` - UserRepository
- `packages/server/src/db/characters.ts` - CharacterRepository
- `packages/server/src/db/sessions.ts` - SessionRepository
- `packages/server/src/db/index.ts` - Database initialization

### Tables
- `users` - Synced from Pocket ID on login
- `characters` - Persona (client-owned) + progression (server-owned)
- `sessions` - Game session lifecycle (lobby/playing/paused/ended)
- `session_players` - Junction table linking users to sessions
- `session_archives` - For replays and statistics
- `saves` - Single-player save slots (legacy support)
