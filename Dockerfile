FROM node:18-bookworm AS builder

# Create app directory
WORKDIR /app

# Install ffmpeg
RUN apt-get update -y && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Install app dependencies
COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

FROM node:18-bookworm

# Install ffmpeg
RUN apt-get update -y && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package.json ./

RUN npm install --production

COPY --from=builder /app/dist ./dist

EXPOSE 8081
CMD [ "node", "dist/app.js" ]