# Zero-dependency emulator: Node strips the TypeScript types at load time,
# so there is no install or build step — copy sources and run.
FROM node:25-alpine

WORKDIR /srv
COPY package.json ./
COPY src ./src

ENV PORT=8790
ENV GOOGLE_DRIVE_API_MOCK_DATA_DIR=/data
EXPOSE 8790
VOLUME /data

CMD ["node", "src/server.ts"]
