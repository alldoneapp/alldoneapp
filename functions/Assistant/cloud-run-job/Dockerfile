FROM node:22.23.4-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . ./

ENV NODE_ENV=production
CMD ["node", "Assistant/vmCloudRunJob.js"]
