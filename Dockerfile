FROM node:20-slim

# Install Python 3 and dependencies for scrapers
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy entire repo so Prototypes/ and tools/ are available in the container
COPY . .

# Install Python scraper dependencies in a venv at /app/venv
RUN python3 -m venv /app/venv && \
    /app/venv/bin/pip install --no-cache-dir \
        requests \
        phonenumbers \
        geopy \
        playwright

# Install Node dependencies, generate Prisma client, and build TypeScript
WORKDIR /app/backend
RUN npm ci
RUN npx prisma generate
RUN npm run build

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PYTHON_PATH=/app/venv/bin/python3

EXPOSE 8080

CMD ["node", "dist/server.js"]
