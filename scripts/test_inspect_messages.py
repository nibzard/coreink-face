import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('inspect_messages', Path(__file__).with_name('inspect-messages.py'))
inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)


class InspectionTests(unittest.TestCase):
    def test_full_text_and_legacy_unknown_times_are_preserved(self):
        calls = []

        def query(account, namespace, object_id, token, sql):
            calls.append(sql)
            if sql.startswith('PRAGMA'):
                return [{'name': name} for name in ['id', 'message', 'decision', 'delivered']]
            self.assertIn('NULL AS received_at', sql)
            self.assertIn('NULL AS delivered_at', sql)
            return [{'id': 1, 'message': 'Full message...\n🌱', 'decision': '{"decidedAt":"2020-01-01"}', 'delivered': 1,
                     'received_at': None, 'delivered_at': None, 'sender': None}]

        output = io.StringIO()
        with patch.object(inspection, 'credentials', return_value='not-for-output'), patch.object(inspection, 'query', side_effect=query), contextlib.redirect_stdout(output):
            inspection.main(['--account', 'a' * 32, '--namespace', 'b' * 32, '--object', 'c' * 64])
        data = json.loads(output.getvalue())
        self.assertEqual(data['messages'][0]['message'], 'Full message...\n🌱')
        self.assertIsNone(data['messages'][0]['received_at'])
        self.assertIsNone(data['messages'][0]['delivered_at'])
        self.assertNotIn('not-for-output', output.getvalue())
        self.assertEqual(len(calls), 2)

    def test_query_uses_object_id_and_reports_no_writes(self):
        result = {'result': {'results': [{'columns': ['id'], 'rows': [[1]], 'meta': {'rows_written': 0}}]}}
        with patch.object(inspection, 'api', return_value=result) as api:
            self.assertEqual(inspection.query('a', 'b', 'c', 'token', 'SELECT id FROM messages'), [{'id': 1}])
            body = api.call_args.args[3]
            self.assertEqual(body['durable_object_id'], 'c')
            self.assertNotIn('durable_object_name', body)

    def test_invalid_targets_and_limits_never_make_requests(self):
        with patch.object(inspection, 'credentials') as credentials, contextlib.redirect_stderr(io.StringIO()):
            for args in [[], ['--limit', '321'], ['--object', 'pebble'], ['--object', '../secrets'], ['--list-objects', '--object', 'c' * 64]]:
                with self.assertRaises(SystemExit):
                    inspection.main(['--account', 'a' * 32, *args])
            credentials.assert_not_called()

    def test_namespace_discovery_and_object_listing_do_not_query_messages(self):
        replies = [
            {'result': [{'id': 'b' * 32, 'script': 'coreink-face-api', 'class': 'Device'}], 'result_info': {'per_page': 100, 'total_count': 1}},
            {'result': [{'id': 'c' * 64, 'hasStoredData': True}], 'result_info': {'cursor': 'c' * 64}},
        ]
        with patch.object(inspection, 'credentials', return_value='token'), patch.object(inspection, 'api', side_effect=replies) as api, patch.object(inspection, 'query') as query, contextlib.redirect_stdout(io.StringIO()) as out:
            inspection.main(['--account', 'a' * 32, '--list-objects'])
            self.assertEqual(json.loads(out.getvalue())['objects'][0]['id'], 'c' * 64)
            self.assertEqual(api.call_count, 2)
            query.assert_not_called()


if __name__ == '__main__':
    unittest.main()
