FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY views ./views
COPY public ./public

ENV PORT=8080

CMD ["npm", "run", "serve"]
