// Run inside the application container. Never return secret values or raw env.
const keys = ['VIP_QUOTA_EXPERIMENT', 'VIP_QUOTA_EXTRA_ATTEMPTS', 'VIP_QUOTA_INCREMENTAL_DAILY_USD', 'VIP_QUOTA_INPUT_USD_PER_MILLION', 'VIP_QUOTA_OUTPUT_USD_PER_MILLION', 'VIP_QUOTA_PRICE_VALID_UNTIL', 'ANTHROPIC_MODEL', 'PAID_ROUTE_PRIMARY_PROVIDER', 'PAID_SPARE_QUOTA_WIDENING', 'API_FOOTBALL_DAILY_LIMIT', 'API_FOOTBALL_DAILY_RESERVE', 'API_FOOTBALL_PAID_RESERVE'];
const out = {};
for (const key of keys) {
  const value = process.env[key];
  const pattern = /ATTEMPTS|USD|MILLION|LIMIT|RESERVE/.test(key) ? /^\d+(?:\.\d+)?$/ : key.endsWith('VALID_UNTIL') ? /^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-][0-9:]+)$/ : /^(?:on|off|shadow|anthropic|gemini|groq|claude-[a-z0-9-]+)$/;
  out[key] = !value ? '(unset)' : pattern.test(value) ? value : '(invalid; value withheld)';
}
out.anthropicKeyPresent = !!process.env.ANTHROPIC_API_KEY;
console.log(JSON.stringify(out));
