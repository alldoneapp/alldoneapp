FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . ./

ENV NODE_ENV=production
CMD ["node", "Assistant/vmCloudRunJob.js"]
