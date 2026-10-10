import argparse


def main():
    parser = argparse.ArgumentParser(description='Immich KI worker (single process)')
    parser.add_argument('--restore-backup', nargs=2, metavar=('BACKUP', 'NEW_DATA_DIRECTORY'))
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=2285)
    args = parser.parse_args()
    if args.restore_backup:
        from pathlib import Path

        from immich_ki.maintenance import restore_backup
        restore_backup(*(Path(p) for p in args.restore_backup))
        print('Backup restored into new data directory; review deployment before starting.')
        return
    import uvicorn
    uvicorn.run('immich_ki.app:create_app', factory=True, host=args.host, port=args.port, workers=1, access_log=False)
