.PHONY: fetch dev build

# GitHub's API allows 60 anonymous requests an hour; use the gh login when there is one (CI sets its own).
export GITHUB_TOKEN ?= $(shell gh auth token 2>/dev/null)

node_modules: package.json
	npm install
	@touch node_modules

# Download/refresh each tool in tools.yaml into public/<slug>/
fetch: node_modules
	node scripts/fetch.mjs

dev: node_modules
	npx vite

build: node_modules
	npx vite build
