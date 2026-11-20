#!/usr/bin/env bash
set -euo pipefail

# The preview pipeline can append a generated SPA --config argument. This app
# needs the TanStack Start plugin stack from its own config, not an HTML entry.
# Deliberately do not forward those appended arguments.
exec bunx --no-install vite build --mode development --config vite.config.ts