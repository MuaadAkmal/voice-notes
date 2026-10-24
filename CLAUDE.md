# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repository has no application code yet: no build system, tests, or source files. Update this file with build/test commands and architecture once the project is scaffolded.

## Contents

- `.claude/skills/find-skills/`: project-level agent skill (from `vercel-labs/skills`) for discovering and installing other skills.
- `skills-lock.json`: pins installed skills by source and `computedHash`. Keep it in sync when skills are added, updated, or removed. Don't hand-edit the hash.
- Not a git repository yet.
