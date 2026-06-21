.PHONY: run test lint format setup

setup:            ## Install web deps (also wires the git hooks via husky)
	cd web && npm install

run:              ## Start the web app (client-side SPA)
	cd web && npm run dev

test:             ## Run tests with coverage
	cd web && npm run coverage

lint:             ## Lint + format check + typecheck + dead-code check
	cd web && npx biome ci . && npm run typecheck && npm run knip

format:           ## Auto-format and fix lint issues
	cd web && npm run check
