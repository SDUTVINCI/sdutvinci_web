# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build

COPY . .
ENV NODE_ENV=production
RUN npm run build

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates gosu pandoc texlive-xetex fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000

COPY --from=build --chown=node:node /app/.output ./.output
COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/vinci-entrypoint

RUN chmod 0755 /usr/local/bin/vinci-entrypoint \
  && test ! -e /app/content \
  && ! find /app -type f -name '*.md' -print -quit | grep -q .

EXPOSE 3000
ENTRYPOINT ["vinci-entrypoint"]
CMD ["node", ".output/server/index.mjs"]

FROM dependencies AS operations

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY . .
ENV NODE_ENV=production
CMD ["npm", "run", "db:migrate"]
