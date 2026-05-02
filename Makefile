.PHONY: run test lint format template setup

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

template:         ## Generate model_inputs.ods template
	uv run python scripts/create_template.py
