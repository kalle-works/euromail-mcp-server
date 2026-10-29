# @euromail/mcp-server

An [MCP](https://modelcontextprotocol.io) server for the [EuroMail](https://euromail.dev) email API. It lets an AI assistant send email, check delivery status, and manage domains, templates, webhooks, contact lists and agent mailboxes. The server calls the EuroMail API over HTTPS, and the API runs in Finland, so your mail stays in the EU.

Requires Node.js 22 or newer and a EuroMail API key. Create one in the [dashboard](https://dashboard.euromail.dev). Give the assistant its own key so you can revoke it without touching your other integrations.

## Setup

### Claude Code

```bash
claude mcp add euromail --env EUROMAIL_API_KEY=em_live_your_key_here -- npx -y @euromail/mcp-server
```

Or add it to a project `.mcp.json`:

```json
{
  "mcpServers": {
    "euromail": {
      "command": "npx",
      "args": ["-y", "@euromail/mcp-server"],
      "env": { "EUROMAIL_API_KEY": "em_live_your_key_here" }
    }
  }
}
```

### Claude Desktop

Add the same block to `claude_desktop_config.json` (on macOS, `~/Library/Application Support/Claude/claude_desktop_config.json`) and restart the app:

```json
{
  "mcpServers": {
    "euromail": {
      "command": "npx",
      "args": ["-y", "@euromail/mcp-server"],
      "env": { "EUROMAIL_API_KEY": "em_live_your_key_here" }
    }
  }
}
```

Cursor and other MCP clients take the same `command`, `args` and `env`.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EUROMAIL_API_KEY` | Yes | | Your API key, sent as `Authorization: Bearer` |
| `EUROMAIL_API_URL` | No | `https://api.euromail.dev` | API base URL |

## Tools

### Emails
- `send_email`: send one email, with a body or a template
- `send_batch_emails`: send up to 100 emails in one request
- `get_email`: get an email and its delivery status
- `list_emails`: list emails, filtered by status and date
- `validate_email`: check syntax, DNS and deliverability of an address

### Templates
- `create_template`, `list_templates`, `get_template`, `update_template`, `delete_template`

### Domains
- `add_domain`: register a domain and get its DNS records
- `list_domains`, `get_domain`, `verify_domain`, `delete_domain`

### Webhooks
- `create_webhook`, `list_webhooks`, `get_webhook`, `update_webhook`, `delete_webhook`

### Suppressions
- `add_suppression`, `list_suppressions`, `remove_suppression`

### Account
- `get_account`: plan, quota and usage

### Contact lists
- `create_contact_list`, `list_contact_lists`, `get_contact_list`, `update_contact_list`, `delete_contact_list`
- `add_contacts`, `list_contacts`, `remove_contact`

### Analytics
- `get_analytics_overview`, `get_analytics_timeseries`, `get_analytics_domains`, `export_analytics_csv`

### Dead letters
- `list_dead_letters`, `retry_dead_letter`, `delete_dead_letter`

### Audit logs and billing
- `list_audit_logs`, `list_billing_plans`, `get_subscription`

### Inbound email
- `list_inbound_emails`, `get_inbound_email`, `delete_inbound_email`
- `create_inbound_route`, `list_inbound_routes`, `get_inbound_route`, `update_inbound_route`, `delete_inbound_route`

### Agent mailboxes
- `create_mailbox`, `list_mailboxes`
- `read_mailbox_messages`, `search_mailbox`, `list_mailbox_threads`
- `reply_to_message`

## Security

Anyone can write the subject and body of an email you receive. Tools that return received mail, such as `read_mailbox_messages`, put a warning in front of the result. The assistant should never follow instructions it finds in a message, and never put secrets in a reply.

Every call runs with your key's permissions. Quota, domain verification and suppression rules apply exactly as they do to a direct API request.

## Development

```bash
npm ci
npm test
```

`npm test` builds the package and runs the tests. A table-driven test checks every tool against the API's OpenAPI document in `test/fixtures/openapi.json`: the endpoint must exist, and every field and query parameter must be one the API accepts.

`npm run check:published` compares that fixture with the document the live API serves, and CI fails when they differ. Check the tools against the API change first, then refresh the fixture:

```bash
npm run check:published -- --write
```

With `--guide`, the check also makes sure the [MCP guide](https://euromail.dev/docs/guides/mcp-server/) lists exactly the tools the server exposes. CI runs that part daily, because the guide is updated after a new tool ships.

Releases publish to npm from CI when the version in `package.json` changes, using npm trusted publishing.

## License

MIT
