FROM node:20-alpine

ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL io.hass.version="$BUILD_VERSION" \
      io.hass.type="app" \
      io.hass.arch="$BUILD_ARCH"

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV PORT=8099
EXPOSE 8099

CMD ["node", "src/server.js"]
