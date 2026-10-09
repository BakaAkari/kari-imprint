import argparse
import secrets


def main():
    parser = argparse.ArgumentParser(description='Immich WM M0 worker (single process)')
    parser.add_argument('--new-token', action='store_true')
    parser.add_argument('--restore-backup', nargs=2, metavar=('BACKUP', 'NEW_DATA_DIRECTORY'))
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=2285)
    args = parser.parse_args()
    if args.restore_backup:
        from pathlib import Path

        from immich_wm.maintenance import restore_backup
        restore_backup(*(Path(p) for p in args.restore_backup))
        print('Backup restored into new data directory; review deployment before starting.')
        return
    if args.new_token:
        print(secrets.token_urlsafe(32))
        return
    import uvicorn
    uvicorn.run('immich_wm.app:create_app', factory=True, host=args.host, port=args.port, workers=1, access_log=False)
