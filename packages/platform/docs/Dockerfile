# just copy built code to the image
FROM oven/bun:1.3-alpine

WORKDIR /app
COPY .output .

CMD ["bun", "server/index.mjs"]
