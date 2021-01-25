FROM node:alpine as builder

RUN apk add --no-cache build-base python g++ musl-dev cairo-dev jpeg-dev \
  pango-dev giflib-dev pixman-dev librsvg-dev freetype-dev

WORKDIR /app
COPY . /app/
RUN npm i --only=prod

FROM node:alpine
LABEL maintainer="Ferdinand Prantl <prantlf@gmail.com>"

RUN apk add --no-cache cairo jpeg pango giflib pixman librsvg freetype

COPY --from=builder /app /app/

RUN adduser -D app
RUN chown -R app:app /app

USER app
WORKDIR /app

CMD ["node", "server"]
