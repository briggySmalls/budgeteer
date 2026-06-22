.PHONY: run test lint format setup

setup:            ## Install deps (also wires the git hooks via husky)
	npm install

run:              ## Start the app (client-side SPA)
	npm run dev

test:             ## Run tests with coverage
	npm run coverage

lint:             ## Lint + format check + typecheck + dead-code check
	npx biome ci . && npm run typecheck && npm run knip

format:           ## Auto-format and fix lint issues
	npm run check
