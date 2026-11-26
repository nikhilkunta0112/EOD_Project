import json
from datetime import date, timedelta
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_path = server.DB_PATH
        server.DB_PATH = Path(self.temp.name) / 'eod.sqlite3'
        self.today = date.today()

    def tearDown(self):
        server.DB_PATH = self.original_path
        self.temp.cleanup()

    def state(self):
        days = [(self.today - timedelta(days=n)).isoformat() for n in range(4)]
        return {'settings': {'sender': 'Test', 'zone': 'local'},
                'drafts': {day: {'raw': day, 'updates': []} for day in days},
                'history': {day: {'draft': {'reports': {}}} for day in days}}

    def test_persistence_and_three_calendar_days(self):
        original = self.state()
        server.save_state(original)
        loaded = server.load_state()
        self.assertEqual(loaded['settings'], original['settings'])
        self.assertEqual(len(loaded['drafts']), 3)
        self.assertEqual(len(loaded['history']), 3)
        self.assertNotIn((self.today - timedelta(days=3)).isoformat(), loaded['drafts'])
        with server.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM records').fetchone()[0], 3)

    def test_read_prunes_after_day_rollover_but_keeps_settings(self):
        server.save_state(self.state())
        tomorrow = self.today + timedelta(days=1)
        with patch.object(server, 'window', return_value=((tomorrow - timedelta(days=2)).isoformat(), tomorrow.isoformat())):
            loaded = server.load_state()
        self.assertEqual(len(loaded['drafts']), 2)
        self.assertEqual(loaded['settings']['sender'], 'Test')

    def test_http_and_static_files(self):
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), partial(server.Handler, directory=str(server.ROOT / 'public')))
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}'
        try:
            with urlopen(base + '/') as response:
                self.assertIn(b'app.js', response.read())
            request = Request(base + '/api/state', data=json.dumps(self.state()).encode(), method='PUT', headers={'Content-Type': 'application/json'})
            with urlopen(request) as response:
                self.assertTrue(json.load(response)['saved'])
            with urlopen(base + '/api/state') as response:
                self.assertEqual(len(json.load(response)['history']), 3)
            bad = Request(base + '/api/state', data=b'{}', method='PUT')
            with self.assertRaises(HTTPError) as caught:
                urlopen(bad)
            self.assertEqual(caught.exception.code, 400)
            caught.exception.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
