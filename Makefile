.PHONY: fetch dev build

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
