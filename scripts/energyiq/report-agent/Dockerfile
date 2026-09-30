FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates git ripgrep chromium && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/python && /opt/python/bin/pip install --no-cache-dir pandas==2.3.3 duckdb==1.4.4 openpyxl==3.1.5 python-pptx==1.0.2 pypdf==6.0.0
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2
RUN npm install --prefix /opt/energyiq --ignore-scripts playwright@1.58.2
COPY runner.mjs report-review.mjs report-browser.mjs /opt/energyiq/
ENV PATH="/opt/python/bin:${PATH}"
ENV PI_CODING_AGENT_DIR=/workspace/state/agent
# Start outside tmpfs so Docker does not pre-create a root-owned work directory.
WORKDIR /opt/energyiq
USER node
ENTRYPOINT ["node", "/opt/energyiq/runner.mjs"]
