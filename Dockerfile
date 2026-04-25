FROM python:3.12-alpine

WORKDIR /app

COPY server/ /app/server/
COPY public/ /app/public/
COPY plugins/ /app/plugins/

ENV LGBOARD_PUBLIC=/app/public
ENV LGBOARD_CONFIG=/config
ENV PYTHONUNBUFFERED=1

EXPOSE 8080

CMD ["python", "-u", "-m", "server.server"]
