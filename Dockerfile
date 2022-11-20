FROM node:16 as builder

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

FROM node:16

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package.json ./

RUN npm install --production

COPY --from=builder /app/dist ./dist

EXPOSE 8081
CMD [ "node", "dist/app.js" ]