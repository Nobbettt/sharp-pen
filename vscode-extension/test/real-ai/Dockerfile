# Linux image for `npm run test:ai`: real AI CLIs plus what VS Code needs to run headless.
FROM node:22-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb xauth libasound2 libgbm1 libgtk-3-0 libnss3 libxss1 libxkbfile1 libsecret-1-0 \
  && rm -rf /var/lib/apt/lists/*
# test-ai.mjs passes today's date, so the CLIs are reinstalled at their latest release once a day.
ARG CLI_REFRESH
RUN echo "CLIs as of ${CLI_REFRESH}" && npm install -g --no-audit --no-fund @anthropic-ai/claude-code @openai/codex @github/copilot opencode-ai
COPY container.sh /usr/local/bin/sharp-pen-real-ai
ENTRYPOINT ["bash", "/usr/local/bin/sharp-pen-real-ai"]
