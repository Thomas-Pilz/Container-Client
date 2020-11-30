FROM node:14-stretch
COPY package*.json /app/
WORKDIR /app
RUN ["npm", "install"]
COPY . .
WORKDIR /app
ENTRYPOINT ["node"]
CMD ["index.js"]