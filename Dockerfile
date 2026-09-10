FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
COPY client/package*.json ./client/
RUN npm install --omit=dev && npm --prefix client install
COPY . .
RUN npm --prefix client run build
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node","server/index.js"]
