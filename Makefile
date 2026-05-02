.PHONY: run test lint format setup

setup:            ## Install deps and pre-commit hooks
	uv sync
	uv run pre-commit install

run:              ## Start the Streamlit app
	uv run streamlit run budgeteer/app.py

test:             ## Run tests with coverage
	uv run pytest --cov

lint:             ## Run linter checks
	uv run ruff check .
	uv run ruff format --check .

format:           ## Auto-format and fix lint issues
	uv run ruff format .
	uv run ruff check --fix .
