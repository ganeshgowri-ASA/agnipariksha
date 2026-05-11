.PHONY: deploy backend frontend stop logs status help clean-frontend

REPO := $(shell pwd)
LOG_DIR := $(REPO)/logs

help:
	@echo 'Agnipariksha — make targets'
	@echo '  make deploy     # one-click: pull, install, restart, smoke-test'
	@echo '  make backend    # restart backend only (no pull / install)'
	@echo '  make frontend   # restart frontend only (no pull / install)'
	@echo '  make stop            # kill recorded backend + frontend pids'
	@echo '  make logs            # tail both logs'
	@echo '  make status          # show pids + ports + last health'
	@echo '  make clean-frontend  # wipe frontend/.next + node_modules + lock, reinstall, rebuild'

deploy:
	@bash $(REPO)/deploy.sh

backend:
	@bash $(REPO)/backend/start.sh

frontend:
	@bash $(REPO)/frontend/start.sh

stop:
	@for f in $(LOG_DIR)/backend.pid $(LOG_DIR)/frontend.pid; do \
	  [ -f "$$f" ] || continue; \
	  pid=$$(cat "$$f" 2>/dev/null || true); \
	  if [ -n "$$pid" ] && kill -0 "$$pid" 2>/dev/null; then \
	    echo "stopping pid $$pid ($$f)"; kill "$$pid" 2>/dev/null || true; \
	  fi; \
	  rm -f "$$f"; \
	done; \
	if [ -d $(REPO)/frontend/node_modules/.bin ]; then \
	  $(REPO)/frontend/node_modules/.bin/kill-port 3000 8000 >/dev/null 2>&1 || true; \
	fi

logs:
	@mkdir -p $(LOG_DIR)
	@touch $(LOG_DIR)/backend.log $(LOG_DIR)/frontend.log
	@tail -n 40 -f $(LOG_DIR)/backend.log $(LOG_DIR)/frontend.log

clean-frontend:
	@bash $(REPO)/frontend/scripts/clean.sh

status:
	@printf 'backend.pid:  '; [ -f $(LOG_DIR)/backend.pid  ] && cat $(LOG_DIR)/backend.pid  || echo '(none)'
	@printf 'frontend.pid: '; [ -f $(LOG_DIR)/frontend.pid ] && cat $(LOG_DIR)/frontend.pid || echo '(none)'
	@echo '--- ports ---'
	@(command -v ss >/dev/null && ss -tlnp | grep -E ':(3000|8000)\b' || \
	  command -v lsof >/dev/null && lsof -nP -iTCP:8000 -iTCP:3000 -sTCP:LISTEN || \
	  netstat -an | grep -E '\.(3000|8000)\b.*LISTEN') 2>/dev/null || true
	@echo '--- backend /health ---'
	@curl -s --max-time 2 http://127.0.0.1:8000/health || echo '(unreachable)'
	@echo
	@echo '--- frontend / ---'
	@curl -s -o /dev/null -w 'HTTP %{http_code}\n' --max-time 2 http://127.0.0.1:3000/ || echo '(unreachable)'
