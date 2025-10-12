# just copy built code to the image
FROM node:24-alpine

WORKDIR /app
COPY .output .

CMD ["node", "server/index.mjs"]
