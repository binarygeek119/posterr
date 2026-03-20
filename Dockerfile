FROM node:24.1.0-alpine
# tzdata for timezone and net-tools
RUN apk update
RUN apk add tzdata
RUN apk add net-tools

ENV NODE_ENV=production

# Posterr talks to Plex, Jellyfin, Emby, and Kodi over HTTP(S) from settings (no extra image packages).
# In Docker, set the media server "host" to a container name on a shared network, or host.docker.internal
# (see docker-compose.yml extra_hosts and docker-compose.media-servers.example.yml).

WORKDIR /usr/src/app
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install --production --silent && mv node_modules ../

COPY . .
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=15s CMD node healthcheck.js > /dev/null || exit 1
CMD ["node", "index.js"]