.PHONY: run test lint format setup

setup:            ## Install Python + web deps (web install also wires git hooks)
	uv sync
	cd web && npm install

run:              ## Start the web app (client-side SPA)
	cd web && npm run dev

test:             ## Run the Python reference/ETL tests with coverage
	uv run pytest --cov

lint:             ## Run Python linter checks
	uv run ruff check .
	uv run ruff format --check .

format:           ## Auto-format and fix Python lint issues
	uv run ruff format .
	uv run ruff check --fix .
