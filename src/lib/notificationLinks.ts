const ALLOWED = /^\/(?:predictions(?:\/|$)|following(?:\/|$)|notifications(?:\/|$)|match-insights(?:\/|$)|dashboard(?:\/|$)|pricing(?:\/|$)|track-record(?:\/|$))/;
export function safeNotificationLink(value: string) {
  return value.length <= 500 && ALLOWED.test(value) && !value.startsWith("//") ? value : "/notifications";
}

