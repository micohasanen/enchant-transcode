FROM node:18-buster as builder

# Create app directory
WORKDIR /app

# Install ffmpeg
RUN apt-get update -y
RUN apt-get dist-upgrade -y
RUN apt-get install ffmpeg -y

# Install app dependencies
COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

FROM node:18-buster

# Install ffmpeg
RUN apt-get update -y
RUN apt-get dist-upgrade -y
RUN apt-get install ffmpeg -y

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package.json ./

RUN npm install --production

COPY --from=builder /app/dist ./dist

EXPOSE 8081
CMD [ "node", "dist/app.js" ]