"""Publish a Vite build to the existing Hetzner website using verified FTPS."""

import argparse
import ftplib
import os
from pathlib import Path, PurePosixPath
import ssl
import urllib.request
import uuid


def deploy(check_only=False):
    host = os.environ['HETZNER_FTP_HOST']
    directory = os.environ['HETZNER_FTP_DIR']
    remote = PurePosixPath(directory)
    if not remote.is_absolute() or len(remote.parts) < 2 or '..' in remote.parts:
        raise ValueError('Deployment must target an absolute website subdirectory.')

    build = Path('dist')
    if not check_only and not (build / 'index.html').is_file():
        raise FileNotFoundError('Build the website before uploading it.')

    with ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=120) as ftp:
        ftp.connect(host, 21)
        ftp.login(os.environ['HETZNER_FTP_USER'], os.environ['HETZNER_FTP_PASSWORD'])
        ftp.prot_p()
        ftp.cwd(directory)
        if check_only:
            # A read-only check ensures this account sees the actual live site's folder.
            existing = []
            ftp.retrbinary('RETR index.html', existing.append)
            with urllib.request.urlopen('https://transcribe.lukhausen.de/', timeout=30) as response:
                if b''.join(existing) != response.read():
                    raise ValueError('Deployment directory does not match the live website.')
            print('Verified encrypted login and website directory; no files changed.')
            return

        files = sorted(path for path in build.rglob('*') if path.is_file())
        if any(path.is_symlink() or any(parent.is_symlink() for parent in path.parents) for path in files):
            raise ValueError('Build files must not use symbolic links.')
        # Publish the entry page last, so it cannot reference assets still uploading.
        files.sort(key=lambda path: path == build / 'index.html')
        created = {'.'}
        suffix = uuid.uuid4().hex
        for path in files:
            relative = path.relative_to(build).as_posix()
            for parent in reversed(PurePosixPath(relative).parents):
                name = str(parent)
                if name in created:
                    continue
                try:
                    ftp.mkd(name)
                except ftplib.error_perm:
                    # Ignore only an existing directory, not permission/access failures.
                    ftp.cwd(f'{directory}/{name}')
                    ftp.cwd(directory)
                created.add(name)
            temporary = f'{relative}.upload-{suffix}'
            with path.open('rb') as content:
                ftp.storbinary(f'STOR {temporary}', content)
            ftp.rename(temporary, relative)
            print(f'Uploaded {relative}')

    request = urllib.request.Request('https://transcribe.lukhausen.de/', headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.read() != (build / 'index.html').read_bytes():
            raise RuntimeError('Uploaded entry page does not match the live website.')
    print('Deployment verified at https://transcribe.lukhausen.de/')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check login and target folder without uploading')
    deploy(check_only=parser.parse_args().check)
