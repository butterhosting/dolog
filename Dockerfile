FROM --platform=$BUILDPLATFORM oven/bun:alpine AS builder
WORKDIR /app
COPY package.json bun.lock* tsconfig.json bunfig.toml bun-env.d.ts drizzle.config.ts .env.* ./
ARG VERSION=0.0.0
ARG COMMIT=0000000000000000000000000000000000000000
RUN bun -e "const p='./package.json'; const j=await Bun.file(p).json(); j.version='$VERSION'; j.commit='$COMMIT'; await Bun.write(p, JSON.stringify(j, null, 2))"
# bun-plugin-tailwind names the `bun` npm package as a peer; installed, it ships a 340 MB platform binary that shadows
# the real bun on PATH, and the builder's platform is not the target's
RUN bun install --frozen-lockfile --production --omit=peer
COPY src/ src/

FROM oven/bun:alpine
RUN apk add --no-cache bash sqlite su-exec
COPY --chmod=755 deployment/entrypoint.sh /entrypoint.sh
WORKDIR /app
RUN chown bun:bun /app
COPY --from=builder --chown=bun:bun /app .
ARG STAGE=prod
ENV STAGE=$STAGE
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["sh", "-c", "exec bun start:$STAGE"]
