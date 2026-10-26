#!/usr/bin/env python3
"""Read-only Cloudflare Durable Object message inspection (Python 3.11+)."""
import argparse
import json
import os
from pathlib import Path
import sys
import tomllib
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def credentials():
    token = os.environ.get('CLOUDFLARE_API_TOKEN')
    if token:
        return token
    override = os.environ.get('WRANGLER_CONFIG_PATH')
    paths = [Path(override)] if override else [
        Path.home() / 'Library/Preferences/.wrangler/config/default.toml',
        Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / '.wrangler/config/default.toml',
        Path.home() / '.wrangler/config/default.toml',
    ]
    for path in paths:
        if path.is_file():
            token = tomllib.loads(path.read_text()).get('oauth_token')
            if token:
                return token
    raise ValueError('Set CLOUDFLARE_API_TOKEN or run npx wrangler login. Credentials are never printed.')


def api(account, path, token, body=None):
    request = Request(
        f'https://api.cloudflare.com/client/v4/accounts/{account}/{path}',
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    )
    try:
        with urlopen(request, timeout=30) as response:
            data = json.load(response)
    except HTTPError as error:
        # Do not echo remote error bodies: they can contain SQL, data, or credentials.
        raise ValueError(f'Cloudflare HTTP {error.code}. Check account, permissions, object ID, and OAuth expiry.') from None
    except URLError:
        raise ValueError('Could not connect to Cloudflare.') from None
    if not data.get('success'):
        raise ValueError('Cloudflare rejected the query. Use Data Studio to check access and schema.')
    return data


def query(account, namespace, object_id, token, sql):
    # Fixed SELECT/PRAGMA statements only; never accept SQL from CLI input.
    data = api(account, f'workers/durable_objects/namespaces/{namespace}/query', token, {
        'durable_object_id': object_id, 'queries': [{'sql': sql, 'params': []}],
    })
    result = data['result']['results'][0]
    if result.get('meta', {}).get('rows_written', 0) != 0:
        raise ValueError('Unexpected writes reported by the inspection query.')
    return [dict(zip(result['columns'], row)) for row in result['rows']]


def hex_id(length):
    def validate(value):
        if len(value) != length or any(c not in '0123456789abcdef' for c in value):
            raise argparse.ArgumentTypeError(f'Expected a {length}-character lowercase hex ID.')
        return value
    return validate


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account', default=os.environ.get('CLOUDFLARE_ACCOUNT_ID'), type=hex_id(32))
    parser.add_argument('--namespace', type=hex_id(32), help='Omit to discover the namespace for --worker.')
    parser.add_argument('--worker', default='coreink-face-api')
    parser.add_argument('--object', type=hex_id(64), help='Opaque object ID from --list-objects or Data Studio; not a device name.')
    parser.add_argument('--list-objects', action='store_true')
    parser.add_argument('--cursor', type=hex_id(64), help='Next object-list page cursor, if returned.')
    parser.add_argument('--limit', type=int, default=320)
    args = parser.parse_args(argv)
    if not args.account:
        parser.error('Use --account or CLOUDFLARE_ACCOUNT_ID.')
    if not 1 <= args.limit <= 320:
        parser.error('--limit must be between 1 and 320.')
    if args.list_objects == bool(args.object):
        parser.error('Choose exactly one of --list-objects or --object.')
    if args.cursor and not args.list_objects:
        parser.error('--cursor requires --list-objects.')
    token = credentials()
    namespace = args.namespace
    if not namespace:
        matches = []
        page = 1
        while True:
            data = api(args.account, f'workers/durable_objects/namespaces?page={page}&per_page=100', token)
            matches.extend(n['id'] for n in data['result'] if n.get('script') == args.worker and n.get('class') == 'Device')
            info = data.get('result_info') or {}
            if page * info.get('per_page', 100) >= info.get('total_count', len(data['result'])):
                break
            page += 1
        if len(matches) != 1:
            raise ValueError('Expected one Device namespace for this worker. Supply --namespace explicitly.')
        namespace = hex_id(32)(matches[0])
    if args.list_objects:
        suffix = '?' + urlencode({'cursor': args.cursor}) if args.cursor else ''
        data = api(args.account, f'workers/durable_objects/namespaces/{namespace}/objects{suffix}', token)
        print(json.dumps({'namespace': namespace, 'objects': data['result'], 'pagination': data.get('result_info')}, indent=2))
        return
    columns = {row['name'] for row in query(args.account, namespace, args.object, token, 'PRAGMA table_info(messages)')}
    if not {'id', 'message', 'decision', 'delivered'} <= columns:
        raise ValueError('This object has no compatible messages table.')
    optional = ', '.join(name if name in columns else f'NULL AS {name}' for name in ['received_at', 'delivered_at', 'sender'])
    rows = query(args.account, namespace, args.object, token,
                 f'SELECT id, message, delivered, decision, {optional} FROM messages ORDER BY id DESC LIMIT {args.limit}')
    for row in rows:
        row['delivered'] = bool(row['delivered'])
        row['decision'] = json.loads(row['decision'])
        row['sender'] = json.loads(row['sender']) if row['sender'] else None
    print(json.dumps({'namespace': namespace, 'object': args.object, 'messages': rows}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        # Parsing errors can quote input; keep failures free of credentials/message text.
        print(str(error) if type(error) is ValueError else 'Inspection failed: check credentials and response format.', file=sys.stderr)
        sys.exit(1)
