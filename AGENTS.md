# Architecture rules
- Keep shared typography and palette in src/styles.css, with font links in the root head, so all pages share one theme.
- Use the same public SVG mark for page branding and the favicon so they stay consistent.
- Preserve the existing organization-selection storage key across rebrands so saved selections remain available.
- Pin @tanstack/start-plugin-core via package.json overrides to a release supporting the installed Vite major; newer releases need Vite 8 and break builds with a missing index.html entry.
