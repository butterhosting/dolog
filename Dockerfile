FROM oven/bun:alpine

RUN apk update

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
