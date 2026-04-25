ARG BASE_IMAGE
FROM $BASE_IMAGE

RUN apk add --no-cache kubectl helm k9s fzf
