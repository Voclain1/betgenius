# Cron runner and backups. pg_dump must be at least the server's version.
FROM postgres:17-alpine
RUN apk add --no-cache curl rclone tini
COPY crontab /etc/crontabs/root
COPY cron-call.sh backup.sh restore-test.sh entrypoint.sh /ops/
RUN chmod +x /ops/*.sh
ENTRYPOINT ["/sbin/tini", "--", "/ops/entrypoint.sh"]
