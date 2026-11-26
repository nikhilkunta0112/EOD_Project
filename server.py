"""Local EOD server. Run with: python server.py"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / 'data' / 'eod.sqlite3'


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.execute('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)')
    connection.execute('CREATE TABLE IF NOT EXISTS records (day TEXT PRIMARY KEY, draft TEXT, history TEXT)')
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def window(settings):
    zone = settings.get('zone', 'local')
    try:
        today = datetime.now(ZoneInfo(zone)).date() if zone != 'local' else datetime.now().date()
    except (ZoneInfoNotFoundError, ValueError):
        today = datetime.now().date()
    return (today - timedelta(days=2)).isoformat(), today.isoformat()


def load_state():
    with connect() as db:
        row = db.execute('SELECT value FROM settings WHERE id = 1').fetchone()
        settings = json.loads(row[0]) if row else None
        minimum, maximum = window(settings or {})
        db.execute('DELETE FROM records WHERE day < ? OR day > ?', (minimum, maximum))
        state = {'settings': settings, 'drafts': {}, 'history': {}}
        for day, draft, history in db.execute('SELECT day, draft, history FROM records'):
            if draft is not None:
                state['drafts'][day] = json.loads(draft)
            if history is not None:
                state['history'][day] = json.loads(history)
        return state


def save_state(state):
    if not isinstance(state, dict) or not all(isinstance(state.get(key), dict) for key in ('settings', 'drafts', 'history')):
        raise ValueError('Expected settings, drafts and history objects')
    settings = state['settings']
    if not isinstance(settings.get('zone', 'local'), str):
        raise ValueError('Invalid time zone')
    minimum, maximum = window(settings)
    records = []
    for day in state['drafts'].keys() | state['history'].keys():
        try:
            valid = datetime.strptime(day, '%Y-%m-%d').date().isoformat() == day
        except ValueError:
            valid = False
        if valid and minimum <= day <= maximum:
            records.append((day, json.dumps(state['drafts'][day]) if day in state['drafts'] else None,
                            json.dumps(state['history'][day]) if day in state['history'] else None))
    with connect() as db:
        db.execute('INSERT OR REPLACE INTO settings VALUES (1, ?)', (json.dumps(settings),))
        db.execute('DELETE FROM records')
        db.executemany('INSERT INTO records VALUES (?, ?, ?)', records)


class Handler(SimpleHTTPRequestHandler):
    def respond(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlsplit(self.path).path == '/api/state':
            try:
                self.respond(200, load_state())
            except sqlite3.Error:
                self.respond(500, {'error': 'Database unavailable'})
        else:
            super().do_GET()

    def do_PUT(self):
        if self.path != '/api/state':
            return self.respond(404, {'error': 'Not found'})
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            return self.respond(403, {'error': 'Origin rejected'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 2_000_000:
                return self.respond(413, {'error': 'Invalid payload size'})
            save_state(json.loads(self.rfile.read(size)))
            self.respond(200, {'saved': True})
        except (ValueError, TypeError):
            self.respond(400, {'error': 'Invalid state'})
        except sqlite3.Error:
            self.respond(500, {'error': 'Database unavailable'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=5000)
    args = parser.parse_args()
    load_state()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT / 'public')))
    server.timeout = 60
    print(f'EOD Reporting Desk: http://localhost:{args.port}', flush=True)
    try:
        while True:
            server.handle_request()
            load_state()  # Prune expired days even while the browser is closed.
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
