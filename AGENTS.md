# AI Agent Guide

This repository contains reusable Home Assistant frontend cards and dashboard snippets.

## Rules

- Keep cards generic; never commit credentials, private URLs, or personal entity IDs.
- Put installable JavaScript cards under `cards/<card-name>/`.
- Put copy-and-paste dashboard YAML under `dashboard-snippets/`.
- Document every configurable option and provide an example.
- Preserve backward compatibility unless a major version is documented.
- Validate JavaScript with `node --check` and YAML examples before release.

## Workflow

Read the card README and schema before changing code. Update the changelog and examples with behavior changes. Keep Home Assistant-specific assumptions explicit.
