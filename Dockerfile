FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --registry=https://registry.npmjs.org
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 7860
CMD ["node", "server.js"]
